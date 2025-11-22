/**
 * Initialize Profile System
 * Sets up default active profile if none exists
 */

import fs from 'fs';
import path from 'path';
import { profileManager } from './profile-manager';

/**
 * Initialize the profile system with a default profile
 * Call this early in app startup
 */
export function initializeProfileSystem(): void {
  console.log('[Profile System] Initializing...');

  const activeProfile = profileManager.getActiveProfile();

  if (!activeProfile) {
    console.log('[Profile System] No active profile found, setting default to Defensio');

    // Set Defensio as default (can be changed to midnight or any other profile)
    const success = profileManager.setActiveProfile('defensio');

    if (success) {
      console.log('[Profile System] ✓ Default profile set to Defensio');
      console.log('[Profile System] Users can change this via project selection screen');
    } else {
      console.error('[Profile System] ✗ Failed to set default profile');
      console.error('[Profile System] Please ensure defensio.json exists in lib/profiles/');
    }
  } else {
    console.log(`[Profile System] ✓ Active profile: ${activeProfile.name} (${activeProfile.id})`);
  }

  // Display available profiles
  const allProfiles = profileManager.getAllProfiles();
  console.log(`[Profile System] Available profiles: ${allProfiles.map(p => p.name).join(', ')}`);
}

/**
 * Get the active profile or throw error
 * Use this in code that requires a profile
 */
export function requireActiveProfile() {
  const profile = profileManager.getActiveProfile();
  if (!profile) {
    throw new Error('No active profile selected. Please select a project to mine.');
  }
  return profile;
}
