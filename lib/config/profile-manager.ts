/**
 * Profile Manager
 * Loads and manages project profiles
 */

import fs from 'fs';
import path from 'path';
import { ProjectProfile, validateProfile } from './project-profile';

class ProfileManager {
  private activeProfile: ProjectProfile | null = null;
  private builtInProfiles: Map<string, ProjectProfile> = new Map();
  private customProfiles: Map<string, ProjectProfile> = new Map();
  private activeProfilePath: string;

  constructor() {
    // Path to store active profile selection
    this.activeProfilePath = path.join(
      process.env.USERPROFILE || process.env.HOME || process.cwd(),
      'Documents',
      'FetcherBot',
      'active-profile.json'
    );

    // Load built-in profiles
    this.loadBuiltInProfiles();

    // Load custom profiles
    this.loadCustomProfiles();

    // Load last selected profile
    this.loadActiveProfile();
  }

  /**
   * Load built-in profiles from lib/profiles/
   */
  private loadBuiltInProfiles(): void {
    try {
      const profilesDir = path.join(process.cwd(), 'lib', 'profiles');

      if (!fs.existsSync(profilesDir)) {
        console.warn('[ProfileManager] Built-in profiles directory not found');
        return;
      }

      const files = fs.readdirSync(profilesDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(profilesDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const profile = JSON.parse(content);

          if (validateProfile(profile)) {
            this.builtInProfiles.set(profile.id, profile);
            console.log(`[ProfileManager] Loaded built-in profile: ${profile.name}`);
          } else {
            console.warn(`[ProfileManager] Invalid profile format: ${file}`);
          }
        } catch (error: any) {
          console.error(`[ProfileManager] Failed to load profile ${file}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('[ProfileManager] Failed to load built-in profiles:', error.message);
    }
  }

  /**
   * Load custom profiles from Documents/FetcherBot/profiles/
   */
  private loadCustomProfiles(): void {
    try {
      const customProfilesDir = path.join(
        process.env.USERPROFILE || process.env.HOME || process.cwd(),
        'Documents',
        'FetcherBot',
        'profiles'
      );

      if (!fs.existsSync(customProfilesDir)) {
        return; // No custom profiles yet
      }

      const files = fs.readdirSync(customProfilesDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(customProfilesDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const profile = JSON.parse(content);

          if (validateProfile(profile)) {
            this.customProfiles.set(profile.id, profile);
            console.log(`[ProfileManager] Loaded custom profile: ${profile.name}`);
          } else {
            console.warn(`[ProfileManager] Invalid custom profile format: ${file}`);
          }
        } catch (error: any) {
          console.error(`[ProfileManager] Failed to load custom profile ${file}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('[ProfileManager] Failed to load custom profiles:', error.message);
    }
  }

  /**
   * Load last selected profile
   */
  private loadActiveProfile(): void {
    try {
      if (fs.existsSync(this.activeProfilePath)) {
        const content = fs.readFileSync(this.activeProfilePath, 'utf-8');
        const data = JSON.parse(content);

        if (data.profileId) {
          const profile = this.getProfileById(data.profileId);
          if (profile) {
            this.activeProfile = profile;
            console.log(`[ProfileManager] Loaded active profile: ${profile.name}`);
          }
        }
      }
    } catch (error: any) {
      console.error('[ProfileManager] Failed to load active profile:', error.message);
    }
  }

  /**
   * Save active profile selection
   */
  private saveActiveProfile(): void {
    try {
      const dir = path.dirname(this.activeProfilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        profileId: this.activeProfile?.id || null,
        lastUpdated: new Date().toISOString(),
      };

      fs.writeFileSync(this.activeProfilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error: any) {
      console.error('[ProfileManager] Failed to save active profile:', error.message);
    }
  }

  /**
   * Get profile by ID
   */
  private getProfileById(id: string): ProjectProfile | null {
    return this.builtInProfiles.get(id) || this.customProfiles.get(id) || null;
  }

  /**
   * Get all available profiles
   * Custom profiles override built-in profiles with the same ID
   */
  getAllProfiles(): ProjectProfile[] {
    // Use a Map to deduplicate by ID, custom profiles take priority
    const profileMap = new Map<string, ProjectProfile>();

    // Add built-in profiles first
    for (const profile of this.builtInProfiles.values()) {
      profileMap.set(profile.id, profile);
    }

    // Custom profiles override built-in profiles with same ID
    for (const profile of this.customProfiles.values()) {
      profileMap.set(profile.id, profile);
    }

    return Array.from(profileMap.values());
  }

  /**
   * Get active profile
   */
  getActiveProfile(): ProjectProfile | null {
    return this.activeProfile;
  }

  /**
   * Set active profile
   */
  setActiveProfile(profileId: string): boolean {
    const profile = this.getProfileById(profileId);
    if (!profile) {
      console.error(`[ProfileManager] Profile not found: ${profileId}`);
      return false;
    }

    this.activeProfile = profile;
    this.saveActiveProfile();
    console.log(`[ProfileManager] Active profile set to: ${profile.name}`);
    return true;
  }

  /**
   * Clear active profile (for project selection screen)
   */
  clearActiveProfile(): void {
    this.activeProfile = null;
    this.saveActiveProfile();
  }

  /**
   * Add custom profile
   */
  addCustomProfile(profilePath: string): boolean {
    try {
      const content = fs.readFileSync(profilePath, 'utf-8');
      const profile = JSON.parse(content);

      if (!validateProfile(profile)) {
        console.error('[ProfileManager] Invalid profile format');
        return false;
      }

      // Copy to custom profiles directory
      const customProfilesDir = path.join(
        process.env.USERPROFILE || process.env.HOME || process.cwd(),
        'Documents',
        'FetcherBot',
        'profiles'
      );

      if (!fs.existsSync(customProfilesDir)) {
        fs.mkdirSync(customProfilesDir, { recursive: true });
      }

      const targetPath = path.join(customProfilesDir, `${profile.id}.json`);
      fs.copyFileSync(profilePath, targetPath);

      this.customProfiles.set(profile.id, profile);
      console.log(`[ProfileManager] Added custom profile: ${profile.name}`);
      return true;
    } catch (error: any) {
      console.error('[ProfileManager] Failed to add custom profile:', error.message);
      return false;
    }
  }

  /**
   * Save a profile from remote source
   * This saves it to the custom profiles directory
   */
  saveRemoteProfile(profile: ProjectProfile): boolean {
    try {
      if (!validateProfile(profile)) {
        console.error('[ProfileManager] Invalid profile format');
        return false;
      }

      const customProfilesDir = path.join(
        process.env.USERPROFILE || process.env.HOME || process.cwd(),
        'Documents',
        'FetcherBot',
        'profiles'
      );

      if (!fs.existsSync(customProfilesDir)) {
        fs.mkdirSync(customProfilesDir, { recursive: true });
      }

      const targetPath = path.join(customProfilesDir, `${profile.id}.json`);
      fs.writeFileSync(targetPath, JSON.stringify(profile, null, 2), 'utf-8');

      this.customProfiles.set(profile.id, profile);
      console.log(`[ProfileManager] Saved remote profile: ${profile.name}`);
      return true;
    } catch (error: any) {
      console.error('[ProfileManager] Failed to save remote profile:', error.message);
      return false;
    }
  }

  /**
   * Reload all profiles (useful after fetching from remote)
   */
  reloadProfiles(): void {
    this.builtInProfiles.clear();
    this.customProfiles.clear();
    this.loadBuiltInProfiles();
    this.loadCustomProfiles();
    // Re-set active profile if it exists
    if (this.activeProfile) {
      const refreshedProfile = this.getProfileById(this.activeProfile.id);
      if (refreshedProfile) {
        this.activeProfile = refreshedProfile;
      }
    }
  }
}

// Singleton instance
export const profileManager = new ProfileManager();
