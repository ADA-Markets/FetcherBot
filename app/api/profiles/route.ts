/**
 * Profiles API
 * GET - List all available profiles
 */

import { NextResponse } from 'next/server';
import { profileManager } from '@/lib/config/profile-manager';

/**
 * GET /api/profiles - Get all available profiles
 */
export async function GET() {
  try {
    const profiles = profileManager.getAllProfiles();

    // Return full profile objects with nested structure
    const profileList = profiles.map(profile => ({
      id: profile.id,
      name: profile.name,
      fullName: profile.fullName,
      status: profile.status || 'active',
      token: profile.token,
      api: profile.api,
      branding: profile.branding,
      links: profile.links || {},
      network: profile.network || {},
    }));

    return NextResponse.json({
      success: true,
      profiles: profileList,
      count: profileList.length,
    });
  } catch (error: any) {
    console.error('[Profiles API] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
