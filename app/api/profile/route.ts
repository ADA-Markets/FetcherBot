/**
 * Profile API
 * GET - Get active profile
 * POST - Set active profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { profileManager } from '@/lib/config/profile-manager';
import { initializeProfileSystem } from '@/lib/config/initialize-profile';

/**
 * GET /api/profile - Get active profile info
 */
export async function GET() {
  try {
    // Ensure profile system is initialized
    initializeProfileSystem();

    const profile = profileManager.getActiveProfile();

    if (!profile) {
      return NextResponse.json(
        { success: false, error: 'No active profile selected' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      profile: {
        id: profile.id,
        name: profile.name,
        fullName: profile.fullName,
        token: profile.token,
        branding: profile.branding,
        api: { baseUrl: profile.api.baseUrl },
        challenge: profile.challenge, // Include challenge config with historyUrl
      },
    });
  } catch (error: any) {
    console.error('[Profile API] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/profile - Set active profile
 * Body: { profileId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { profileId } = await request.json();

    if (!profileId || typeof profileId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid profileId' },
        { status: 400 }
      );
    }

    const success = profileManager.setActiveProfile(profileId);

    if (!success) {
      return NextResponse.json(
        { success: false, error: `Profile '${profileId}' not found` },
        { status: 404 }
      );
    }

    const profile = profileManager.getActiveProfile();

    return NextResponse.json({
      success: true,
      message: `Active profile set to ${profile?.name}`,
      profile: {
        id: profile?.id,
        name: profile?.name,
        fullName: profile?.fullName,
      },
    });
  } catch (error: any) {
    console.error('[Profile API] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
