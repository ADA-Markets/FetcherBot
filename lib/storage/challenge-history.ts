/**
 * Challenge History Logger
 * Logs all challenges we encounter for future multi-challenge mining support
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ChallengeHistoryEntry {
  // Challenge data (full response from API)
  challenge_id: string;
  difficulty: string;
  no_pre_mine: string;
  latest_submission: string;
  no_pre_mine_hour: string;

  // Metadata
  firstSeenAt: string;        // ISO timestamp when we first saw this challenge
  lastSeenAt: string;         // ISO timestamp when we last saw this challenge
  profileId: string;          // Which profile this challenge is for
  validityHours: number;      // How long this challenge accepts submissions
  expiresAt: string;          // Calculated expiry time (firstSeenAt + validityHours)

  // Stats (updated over time)
  difficultyChanges?: {       // Track difficulty changes within same challenge
    timestamp: string;
    oldDifficulty: string;
    newDifficulty: string;
  }[];
}

class ChallengeHistoryLogger {
  private _historyFile: string | null = null;
  private history: Map<string, ChallengeHistoryEntry> = new Map();
  private initialized = false;

  private get historyFile(): string {
    if (this._historyFile) return this._historyFile;

    let storageDir: string;

    try {
      // Try to use profile-specific path
      const { pathResolver } = require('@/lib/storage/path-resolver');
      storageDir = pathResolver.getStorageDir();
      console.log(`[ChallengeHistory] Using profile-specific path: ${storageDir}`);
    } catch (error: any) {
      // Fallback for legacy support
      const newDataDir = path.join(
        process.env.USERPROFILE || process.env.HOME || process.cwd(),
        'Documents',
        'FetcherBot'
      );
      storageDir = path.join(newDataDir, 'storage');
      console.log(`[ChallengeHistory] Warning: No active profile, using legacy path: ${storageDir}`);

      // Ensure storage directory exists
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
    }

    this._historyFile = path.join(storageDir, 'challenge-history.json');
    return this._historyFile;
  }

  // Reset cached path (call when profile changes)
  resetPath(): void {
    this._historyFile = null;
    this.initialized = false;
    this.history.clear();
    console.log('[ChallengeHistory] Path cache cleared - will re-resolve on next access');
  }

  /**
   * Initialize by loading existing history from disk
   */
  private initialize(): void {
    if (this.initialized) return;

    try {
      if (fs.existsSync(this.historyFile)) {
        const content = fs.readFileSync(this.historyFile, 'utf8');
        const entries: ChallengeHistoryEntry[] = JSON.parse(content);

        let migrated = 0;
        for (const entry of entries) {
          // Migration: Fix entries where expiresAt was incorrectly calculated as firstSeenAt + 24h
          // The actual expiry is latest_submission (the server's deadline)
          if (entry.latest_submission && entry.expiresAt !== entry.latest_submission) {
            entry.expiresAt = entry.latest_submission;
            migrated++;
          }
          this.history.set(entry.challenge_id, entry);
        }

        console.log(`[ChallengeHistory] Loaded ${entries.length} challenges from history`);
        if (migrated > 0) {
          console.log(`[ChallengeHistory] Migrated ${migrated} challenges to use latest_submission as expiry`);
          this.save(); // Save the migrated data
        }
      }
    } catch (error: any) {
      console.error('[ChallengeHistory] Failed to load history:', error.message);
    }

    this.initialized = true;
  }

  /**
   * Save history to disk
   */
  private save(): void {
    try {
      const entries = Array.from(this.history.values());
      fs.writeFileSync(this.historyFile, JSON.stringify(entries, null, 2), 'utf8');
    } catch (error: any) {
      console.error('[ChallengeHistory] Failed to save history:', error.message);
    }
  }

  /**
   * Log a challenge (called when we see a challenge from the API)
   */
  logChallenge(
    challenge: {
      challenge_id: string;
      difficulty: string;
      no_pre_mine: string;
      latest_submission: string;
      no_pre_mine_hour: string;
    },
    profileId: string,
    validityHours: number = 24
  ): ChallengeHistoryEntry {
    this.initialize();

    const now = new Date().toISOString();
    const existing = this.history.get(challenge.challenge_id);

    if (existing) {
      // Update existing entry
      existing.lastSeenAt = now;
      existing.latest_submission = challenge.latest_submission;
      existing.no_pre_mine_hour = challenge.no_pre_mine_hour;

      // Track difficulty changes
      if (challenge.difficulty !== existing.difficulty) {
        if (!existing.difficultyChanges) {
          existing.difficultyChanges = [];
        }
        existing.difficultyChanges.push({
          timestamp: now,
          oldDifficulty: existing.difficulty,
          newDifficulty: challenge.difficulty,
        });
        existing.difficulty = challenge.difficulty;

        console.log(`[ChallengeHistory] Difficulty changed for ${challenge.challenge_id}: ${existing.difficultyChanges[existing.difficultyChanges.length - 1].oldDifficulty} -> ${challenge.difficulty}`);
      }

      this.save();
      return existing;
    }

    // Create new entry
    const firstSeenAt = now;
    // Use latest_submission as the actual expiry time - this is the server's deadline
    // The server rejects solutions after this time with "Challenge window closed"
    const expiresAt = challenge.latest_submission;

    const entry: ChallengeHistoryEntry = {
      challenge_id: challenge.challenge_id,
      difficulty: challenge.difficulty,
      no_pre_mine: challenge.no_pre_mine,
      latest_submission: challenge.latest_submission,
      no_pre_mine_hour: challenge.no_pre_mine_hour,
      firstSeenAt,
      lastSeenAt: firstSeenAt,
      profileId,
      validityHours,
      expiresAt,
    };

    this.history.set(challenge.challenge_id, entry);
    this.save();

    console.log(`[ChallengeHistory] New challenge logged: ${challenge.challenge_id} (expires: ${expiresAt})`);

    return entry;
  }

  /**
   * Get a challenge by ID
   */
  getChallenge(challengeId: string): ChallengeHistoryEntry | undefined {
    this.initialize();
    return this.history.get(challengeId);
  }

  /**
   * Get all challenges for a profile
   */
  getChallengesForProfile(profileId: string): ChallengeHistoryEntry[] {
    this.initialize();
    return Array.from(this.history.values())
      .filter(entry => entry.profileId === profileId)
      .sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());
  }

  /**
   * Get challenges that are still valid (not expired)
   */
  getValidChallenges(profileId: string): ChallengeHistoryEntry[] {
    this.initialize();
    const now = Date.now();

    return Array.from(this.history.values())
      .filter(entry => {
        if (entry.profileId !== profileId) return false;
        const expiresAt = new Date(entry.expiresAt).getTime();
        return expiresAt > now;
      })
      .sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());
  }

  /**
   * Get the easiest valid challenge across all valid challenges
   * Returns the challenge with the highest difficulty hex value (easier = higher hex)
   * Only returns challenges with at least minTimeRemainingMinutes left before expiry
   *
   * @param profileId - Profile to filter by
   * @param minTimeRemainingMinutes - Minimum minutes remaining before expiry (default 15)
   * @returns The easiest valid challenge, or null if none found
   */
  getEasiestValidChallenge(profileId: string, minTimeRemainingMinutes: number = 15): ChallengeHistoryEntry | null {
    this.initialize();
    const now = Date.now();
    const minTimeMs = minTimeRemainingMinutes * 60 * 1000;

    const validChallenges = Array.from(this.history.values())
      .filter(entry => {
        if (entry.profileId !== profileId) return false;
        const expiresAt = new Date(entry.expiresAt).getTime();
        const timeRemaining = expiresAt - now;
        // Must have enough time remaining to be worth mining
        return timeRemaining > minTimeMs;
      });

    if (validChallenges.length === 0) return null;

    // Sort by difficulty (easier first - higher hex value = easier)
    // Then by time remaining (LESS time = better - use expiring challenges first!)
    validChallenges.sort((a, b) => {
      const diffA = parseInt(a.difficulty, 16);
      const diffB = parseInt(b.difficulty, 16);
      if (diffA !== diffB) return diffB - diffA; // Higher = easier

      // If same difficulty, prefer one expiring SOONER (use them before they expire!)
      const expiresA = new Date(a.expiresAt).getTime();
      const expiresB = new Date(b.expiresAt).getTime();
      return expiresA - expiresB; // Earlier expiry = higher priority
    });

    return validChallenges[0];
  }

  /**
   * Get challenges that share the same no_pre_mine (same day)
   * These can potentially be mined together since ROM doesn't need reinitialization
   */
  getSameDayChallenges(noPreMine: string, profileId: string): ChallengeHistoryEntry[] {
    this.initialize();
    const now = Date.now();

    return Array.from(this.history.values())
      .filter(entry => {
        if (entry.profileId !== profileId) return false;
        if (entry.no_pre_mine !== noPreMine) return false;
        const expiresAt = new Date(entry.expiresAt).getTime();
        return expiresAt > now;
      })
      .sort((a, b) => {
        // Sort by difficulty (easier first - higher hex value = easier)
        // Then by firstSeenAt (older first)
        const diffA = parseInt(a.difficulty, 16);
        const diffB = parseInt(b.difficulty, 16);
        if (diffA !== diffB) return diffB - diffA; // Higher = easier
        return new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime();
      });
  }

  /**
   * Get all history entries
   */
  getAllChallenges(): ChallengeHistoryEntry[] {
    this.initialize();
    return Array.from(this.history.values())
      .sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());
  }

  /**
   * Get count of challenges
   */
  getCount(): number {
    this.initialize();
    return this.history.size;
  }

  /**
   * Clean up expired challenges older than N days
   */
  cleanupOldChallenges(daysToKeep: number = 30): number {
    this.initialize();
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [challengeId, entry] of this.history.entries()) {
      const firstSeen = new Date(entry.firstSeenAt).getTime();
      if (firstSeen < cutoff) {
        this.history.delete(challengeId);
        removed++;
      }
    }

    if (removed > 0) {
      this.save();
      console.log(`[ChallengeHistory] Cleaned up ${removed} challenges older than ${daysToKeep} days`);
    }

    return removed;
  }

  /**
   * Seed challenge history from a remote API
   * This allows new users to benefit from easier challenges discovered by the community
   *
   * @param apiUrl - URL to fetch challenge history from
   * @param profileId - Profile ID to associate with seeded challenges
   * @returns Number of challenges imported
   */
  async seedFromApi(apiUrl: string, profileId: string): Promise<number> {
    this.initialize();

    try {
      const axios = require('axios');
      console.log(`[ChallengeHistory] Fetching challenge history from: ${apiUrl}`);

      const response = await axios.get(apiUrl, { timeout: 10000 });

      // Handle both formats:
      // 1. Direct array of challenges
      // 2. Object with { success, challenges: [...] }
      let challenges: ChallengeHistoryEntry[];
      if (Array.isArray(response.data)) {
        challenges = response.data;
      } else if (response.data && Array.isArray(response.data.challenges)) {
        challenges = response.data.challenges;
      } else {
        console.error('[ChallengeHistory] Invalid response format - expected array or { challenges: [...] }');
        return 0;
      }

      let imported = 0;
      const now = Date.now();

      for (const challenge of challenges) {
        // Skip if we already have this challenge
        if (this.history.has(challenge.challenge_id)) {
          continue;
        }

        // Skip if already expired
        const expiresAt = new Date(challenge.expiresAt).getTime();
        if (expiresAt <= now) {
          continue;
        }

        // Import with the specified profile ID
        const entry: ChallengeHistoryEntry = {
          ...challenge,
          profileId: profileId, // Override with local profile
        };

        this.history.set(entry.challenge_id, entry);
        imported++;
      }

      if (imported > 0) {
        this.save();
        console.log(`[ChallengeHistory] Imported ${imported} challenges from remote API`);
      } else {
        console.log('[ChallengeHistory] No new challenges to import');
      }

      return imported;
    } catch (error: any) {
      console.error('[ChallengeHistory] Failed to seed from API:', error.message);
      return 0;
    }
  }

  /**
   * Export challenge history as JSON (for serving via API)
   */
  exportForApi(profileId: string): ChallengeHistoryEntry[] {
    this.initialize();
    const now = Date.now();

    // Only export valid (non-expired) challenges for the profile
    return Array.from(this.history.values())
      .filter(entry => {
        if (entry.profileId !== profileId) return false;
        const expiresAt = new Date(entry.expiresAt).getTime();
        return expiresAt > now;
      })
      .sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());
  }
}

// Singleton instance
export const challengeHistoryLogger = new ChallengeHistoryLogger();
