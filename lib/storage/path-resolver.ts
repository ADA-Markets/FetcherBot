/**
 * Path Resolver
 * Provides project-specific storage paths
 */

import path from 'path';
import fs from 'fs';
import { profileManager } from '@/lib/config/profile-manager';

class PathResolver {
  private baseDir: string;
  private migrationChecked: Set<string> = new Set(); // Track which profiles we've checked

  constructor() {
    this.baseDir = path.join(
      process.env.USERPROFILE || process.env.HOME || process.cwd(),
      'Documents',
      'FetcherBot'
    );
  }

  /**
   * Migrate data from old flat structure to new project-based structure
   * Old: ~/Documents/FetcherBot/secure/ and ~/Documents/FetcherBot/storage/
   * New: ~/Documents/FetcherBot/projects/{profile-id}/secure/ and storage/
   */
  private migrateFromFlatStructure(profileId: string): void {
    // Only check once per profile per session
    if (this.migrationChecked.has(profileId)) {
      return;
    }
    this.migrationChecked.add(profileId);

    const oldSecureDir = path.join(this.baseDir, 'secure');
    const oldStorageDir = path.join(this.baseDir, 'storage');
    const newSecureDir = path.join(this.baseDir, 'projects', profileId, 'secure');
    const newStorageDir = path.join(this.baseDir, 'projects', profileId, 'storage');

    // Check if old structure exists and new structure is empty
    const oldSecureExists = fs.existsSync(oldSecureDir);
    const oldWalletExists = oldSecureExists && fs.existsSync(path.join(oldSecureDir, 'wallet-seed.json.enc'));
    const newWalletExists = fs.existsSync(path.join(newSecureDir, 'wallet-seed.json.enc'));

    // Only migrate if old wallet exists and new wallet doesn't
    if (oldWalletExists && !newWalletExists) {
      console.log('[PathResolver] Detected old data structure, migrating to project-based structure...');
      console.log(`[PathResolver]   From: ${oldSecureDir}`);
      console.log(`[PathResolver]   To: ${newSecureDir}`);

      try {
        // Ensure new directories exist
        if (!fs.existsSync(newSecureDir)) {
          fs.mkdirSync(newSecureDir, { recursive: true });
        }
        if (!fs.existsSync(newStorageDir)) {
          fs.mkdirSync(newStorageDir, { recursive: true });
        }

        // Copy secure files
        if (oldSecureExists) {
          const secureFiles = fs.readdirSync(oldSecureDir);
          for (const file of secureFiles) {
            const srcPath = path.join(oldSecureDir, file);
            const destPath = path.join(newSecureDir, file);
            // Only copy files, not directories, and only if dest doesn't exist
            if (fs.statSync(srcPath).isFile() && !fs.existsSync(destPath)) {
              fs.copyFileSync(srcPath, destPath);
              console.log(`[PathResolver]   Copied: ${file}`);
            }
          }
        }

        // Copy storage files
        if (fs.existsSync(oldStorageDir)) {
          const storageFiles = fs.readdirSync(oldStorageDir);
          for (const file of storageFiles) {
            const srcPath = path.join(oldStorageDir, file);
            const destPath = path.join(newStorageDir, file);
            // Only copy files, not directories, and only if dest doesn't exist
            if (fs.statSync(srcPath).isFile() && !fs.existsSync(destPath)) {
              fs.copyFileSync(srcPath, destPath);
              console.log(`[PathResolver]   Copied: ${file}`);
            }
          }
        }

        console.log('[PathResolver] ✓ Migration complete! Your wallet data has been moved to the new location.');
        console.log('[PathResolver]   Old files preserved in case of issues. You can delete them later.');
      } catch (error: any) {
        console.error('[PathResolver] ✗ Migration failed:', error.message);
        console.error('[PathResolver]   Please manually copy files from:');
        console.error(`[PathResolver]     ${oldSecureDir} -> ${newSecureDir}`);
        console.error(`[PathResolver]     ${oldStorageDir} -> ${newStorageDir}`);
      }
    }
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

    // Check for and perform migration from old flat structure
    this.migrateFromFlatStructure(profile.id);

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
