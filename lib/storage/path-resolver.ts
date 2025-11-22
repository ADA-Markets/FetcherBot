/**
 * Path Resolver
 * Provides project-specific storage paths
 */

import path from 'path';
import fs from 'fs';
import { profileManager } from '@/lib/config/profile-manager';

class PathResolver {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(
      process.env.USERPROFILE || process.env.HOME || process.cwd(),
      'Documents',
      'FetcherBot'
    );
  }

  /**
   * Get the base directory for all FetcherBot data
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Get project-specific base directory
   */
  getProjectDir(): string {
    const profile = profileManager.getActiveProfile();
    if (!profile) {
      throw new Error('No active profile selected');
    }
    return path.join(this.baseDir, 'projects', profile.id);
  }

  /**
   * Get project-specific secure directory (wallet data)
   */
  getSecureDir(): string {
    const projectDir = this.getProjectDir();
    const secureDir = path.join(projectDir, 'secure');

    // Ensure directory exists
    if (!fs.existsSync(secureDir)) {
      fs.mkdirSync(secureDir, { recursive: true });
    }

    return secureDir;
  }

  /**
   * Get project-specific storage directory (mining data)
   */
  getStorageDir(): string {
    const projectDir = this.getProjectDir();
    const storageDir = path.join(projectDir, 'storage');

    // Ensure directory exists
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    return storageDir;
  }

  /**
   * Get custom profiles directory
   */
  getCustomProfilesDir(): string {
    const profilesDir = path.join(this.baseDir, 'profiles');

    if (!fs.existsSync(profilesDir)) {
      fs.mkdirSync(profilesDir, { recursive: true });
    }

    return profilesDir;
  }

}

// Singleton instance
export const pathResolver = new PathResolver();
