/**
 * Initialization API
 * Called on app startup to initialize systems
 */

import { NextResponse } from 'next/server';
import { initializeProfileSystem } from '@/lib/config/initialize-profile';
import { profileManager } from '@/lib/config/profile-manager';

/**
 * GET /api/init - Initialize application systems
 */
export async function GET() {
  try {
    console.log('[Init API] Initializing application...');

    // Initialize profile system
    initializeProfileSystem();

    const profile = profileManager.getActiveProfile();

    return NextResponse.json({
      success: true,
      message: 'Application initialized successfully',
      activeProfile: profile ? {
        id: profile.id,
        name: profile.name,
        fullName: profile.fullName,
      } : null,
    });
  } catch (error: any) {
    console.error('[Init API] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
