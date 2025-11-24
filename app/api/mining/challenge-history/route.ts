/**
 * API endpoint for challenge history operations
 * - GET: Export current challenge history (for serving to other miners)
 * - POST: Seed challenge history from a remote API URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { challengeHistoryLogger } from '@/lib/storage/challenge-history';
import { profileManager } from '@/lib/config/profile-manager';

/**
 * GET - Export challenge history for the current profile
 * Returns all valid (non-expired) challenges
 */
export async function GET() {
  try {
    const profile = profileManager.getActiveProfile();
    const profileId = profile?.id || 'defensio';

    const challenges = challengeHistoryLogger.exportForApi(profileId);

    return NextResponse.json({
      success: true,
      profileId,
      count: challenges.length,
      challenges,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to export challenge history' },
      { status: 500 }
    );
  }
}

/**
 * POST - Seed challenge history from a remote API
 * Body: { url: string } - URL to fetch challenge history from
 */
export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid url parameter' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    const profile = profileManager.getActiveProfile();
    const profileId = profile?.id || 'defensio';

    const imported = await challengeHistoryLogger.seedFromApi(url, profileId);

    // Get current state after import
    const validChallenges = challengeHistoryLogger.getValidChallenges(profileId);
    const easiest = challengeHistoryLogger.getEasiestValidChallenge(profileId, 15);

    return NextResponse.json({
      success: true,
      message: `Imported ${imported} new challenges`,
      imported,
      totalValid: validChallenges.length,
      easiestChallenge: easiest ? {
        challenge_id: easiest.challenge_id,
        difficulty: easiest.difficulty,
        expiresAt: easiest.expiresAt,
        minutesRemaining: Math.floor((new Date(easiest.expiresAt).getTime() - Date.now()) / 60000),
      } : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to seed challenge history' },
      { status: 500 }
    );
  }
}
