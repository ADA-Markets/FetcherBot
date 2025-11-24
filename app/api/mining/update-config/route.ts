/**
 * API endpoint to update mining orchestrator configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { miningOrchestrator } from '@/lib/mining/orchestrator';

export async function POST(req: NextRequest) {
  try {
    const { workerThreads, batchSize, workerGroupingMode, workersPerAddress, preferEasierChallenges, minChallengeTimeMinutes } = await req.json();

    // Validate workerThreads
    if (workerThreads !== undefined) {
      if (typeof workerThreads !== 'number' || workerThreads < 1 || workerThreads > 256) {
        return NextResponse.json(
          { success: false, error: 'Invalid workerThreads value (must be between 1 and 256)' },
          { status: 400 }
        );
      }
    }

    // Validate batchSize
    if (batchSize !== undefined) {
      if (typeof batchSize !== 'number' || batchSize < 50 || batchSize > 10000) {
        return NextResponse.json(
          { success: false, error: 'Invalid batchSize value (must be between 50 and 10000)' },
          { status: 400 }
        );
      }
    }

    // Validate workerGroupingMode
    if (workerGroupingMode !== undefined) {
      if (!['auto', 'all-on-one', 'grouped'].includes(workerGroupingMode)) {
        return NextResponse.json(
          { success: false, error: 'Invalid workerGroupingMode (must be auto, all-on-one, or grouped)' },
          { status: 400 }
        );
      }
    }

    // Validate workersPerAddress
    if (workersPerAddress !== undefined) {
      if (typeof workersPerAddress !== 'number' || workersPerAddress < 1 || workersPerAddress > 256) {
        return NextResponse.json(
          { success: false, error: 'Invalid workersPerAddress value (must be between 1 and 256)' },
          { status: 400 }
        );
      }
    }

    // Validate preferEasierChallenges
    if (preferEasierChallenges !== undefined) {
      if (typeof preferEasierChallenges !== 'boolean') {
        return NextResponse.json(
          { success: false, error: 'Invalid preferEasierChallenges value (must be boolean)' },
          { status: 400 }
        );
      }
    }

    // Validate minChallengeTimeMinutes
    if (minChallengeTimeMinutes !== undefined) {
      if (typeof minChallengeTimeMinutes !== 'number' || minChallengeTimeMinutes < 5 || minChallengeTimeMinutes > 120) {
        return NextResponse.json(
          { success: false, error: 'Invalid minChallengeTimeMinutes value (must be between 5 and 120)' },
          { status: 400 }
        );
      }
    }

    // Update configuration in the orchestrator
    miningOrchestrator.updateConfiguration({
      workerThreads,
      batchSize,
      workerGroupingMode,
      workersPerAddress,
      preferEasierChallenges,
      minChallengeTimeMinutes,
    });

    // Get updated configuration
    const config = miningOrchestrator.getCurrentConfiguration();

    return NextResponse.json({
      success: true,
      message: 'Configuration updated successfully',
      config,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update configuration' },
      { status: 500 }
    );
  }
}
