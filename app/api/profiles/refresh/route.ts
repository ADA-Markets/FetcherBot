/**
 * Remote Profiles Refresh API
 * POST - Fetch and save profiles from remote server
 */

import { NextResponse } from 'next/server';
import { profileManager } from '@/lib/config/profile-manager';
import { validateProfile } from '@/lib/config/project-profile';

const REMOTE_PROFILES_URL = 'https://miner.ada.markets/api/miner/profiles';

/**
 * POST /api/profiles/refresh - Fetch profiles from remote and save locally
 */
export async function POST() {
  try {
    console.log('[Profiles Refresh] Fetching profiles from remote...');

    const response = await fetch(REMOTE_PROFILES_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // 10 second timeout
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Remote API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.profiles)) {
      throw new Error('Invalid response format from remote API');
    }

    const profiles = data.profiles;
    let savedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const profile of profiles) {
      if (validateProfile(profile)) {
        const success = profileManager.saveRemoteProfile(profile);
        if (success) {
          savedCount++;
        } else {
          failedCount++;
          errors.push(`Failed to save profile: ${profile.id}`);
        }
      } else {
        failedCount++;
        errors.push(`Invalid profile format: ${profile.id || 'unknown'}`);
      }
    }

    // Reload all profiles after saving
    profileManager.reloadProfiles();

    console.log(`[Profiles Refresh] Saved ${savedCount} profiles, ${failedCount} failed`);

    return NextResponse.json({
      success: true,
      message: `Refreshed ${savedCount} profiles from remote`,
      saved: savedCount,
      failed: failedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('[Profiles Refresh] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch profiles from remote',
      },
      { status: 500 }
    );
  }
}
