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
  private historyFile: string;
  private history: Map<string, ChallengeHistoryEntry> = new Map();
  private initialized = false;

  constructor() {
    // Use profile-aware path resolver if available
    let storageDir: string;

    try {
      // Try to use profile-specific path
      const { pathResolver } = require('@/lib/storage/path-resolver');
      storageDir = pathResolver.getStorageDir();
    } catch (error) {
      // Fallback for legacy support
      const newDataDir = path.join(
        process.env.USERPROFILE || process.env.HOME || process.cwd(),
        'Documents',
        'FetcherBot'
      );
      storageDir = path.join(newDataDir, 'storage');

      // Ensure storage directory exists
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
    }

    this.historyFile = path.join(storageDir, 'challenge-history.json');
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

        for (const entry of entries) {
          this.history.set(entry.challenge_id, entry);
        }

        console.log(`[ChallengeHistory] Loaded ${entries.length} challenges from history`);
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
    const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000).toISOString();

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
}

// Singleton instance
export const challengeHistoryLogger = new ChallengeHistoryLogger();
