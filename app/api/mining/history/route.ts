import { NextResponse } from 'next/server';
import { receiptsLogger } from '@/lib/storage/receipts-logger';

interface UniqueError {
  ts: string;
  address: string;
  addressIndex?: number;
  challenge_id: string;
  nonce: string;
  hash: string;
  error: string;
  retryCount: number; // How many times this solution was attempted
  lastAttempt: string;
}

interface AddressHistory {
  addressIndex: number;
  address: string;
  challengeId: string;
  successCount: number;
  failureCount: number;
  totalAttempts: number;
  status: 'success' | 'failed' | 'pending';
  lastAttempt: string;
  failures: Array<{
    ts: string;
    nonce: string;
    hash: string;
    error: string;
  }>;
  successTimestamp?: string;
}

export async function GET() {
  try {
    const receipts = receiptsLogger.readReceipts();
    const rawErrors = receiptsLogger.readErrors();

    // Sort by timestamp descending (most recent first)
    receipts.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    rawErrors.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    // Deduplicate errors: group by address+challenge+nonce (unique solution)
    // Multiple retries of the same solution should count as ONE failure
    const errorMap = new Map<string, UniqueError>();
    rawErrors.forEach(error => {
      const key = `${error.address}:${error.challenge_id}:${error.nonce}`;

      if (!errorMap.has(key)) {
        errorMap.set(key, {
          ts: error.ts,
          address: error.address,
          addressIndex: error.addressIndex,
          challenge_id: error.challenge_id,
          nonce: error.nonce,
          hash: error.hash,
          error: error.error,
          retryCount: 1,
          lastAttempt: error.ts,
        });
      } else {
        const existing = errorMap.get(key)!;
        existing.retryCount++;
        // Keep the most recent error message and timestamp
        if (new Date(error.ts) > new Date(existing.lastAttempt)) {
          existing.lastAttempt = error.ts;
          existing.error = error.error;
        }
        // Keep the earliest timestamp as the original failure time
        if (new Date(error.ts) < new Date(existing.ts)) {
          existing.ts = error.ts;
        }
      }
    });

    // Convert deduplicated errors to array
    const uniqueErrors = Array.from(errorMap.values());

    // Remove errors that have a matching successful receipt (solution was eventually successful)
    const successfulSolutions = new Set(
      receipts.map(r => `${r.address}:${r.challenge_id}:${r.nonce}`)
    );

    const failedErrors = uniqueErrors.filter(error => {
      const key = `${error.address}:${error.challenge_id}:${error.nonce}`;
      return !successfulSolutions.has(key);
    });

    // Sort failed errors by last attempt (most recent first)
    failedErrors.sort((a, b) => new Date(b.lastAttempt).getTime() - new Date(a.lastAttempt).getTime());

    // Group by address index and challenge for addressHistory
    const addressHistoryMap = new Map<string, AddressHistory>();

    // Process unique failed errors
    failedErrors.forEach(error => {
      const key = `${error.addressIndex ?? '?'}:${error.challenge_id}`;

      if (!addressHistoryMap.has(key)) {
        addressHistoryMap.set(key, {
          addressIndex: error.addressIndex ?? -1,
          address: error.address,
          challengeId: error.challenge_id,
          successCount: 0,
          failureCount: 0,
          totalAttempts: 0,
          status: 'pending',
          lastAttempt: error.lastAttempt,
          failures: [],
        });
      }

      const history = addressHistoryMap.get(key)!;
      history.failureCount++;
      history.totalAttempts++;
      history.failures.push({
        ts: error.ts,
        nonce: error.nonce,
        hash: error.hash,
        error: error.error,
      });

      // Update last attempt if this is more recent
      if (new Date(error.lastAttempt) > new Date(history.lastAttempt)) {
        history.lastAttempt = error.lastAttempt;
      }
    });

    // Process successes
    receipts.forEach(receipt => {
      const key = `${receipt.addressIndex ?? '?'}:${receipt.challenge_id}`;

      if (!addressHistoryMap.has(key)) {
        addressHistoryMap.set(key, {
          addressIndex: receipt.addressIndex ?? -1,
          address: receipt.address,
          challengeId: receipt.challenge_id,
          successCount: 0,
          failureCount: 0,
          totalAttempts: 0,
          status: 'pending',
          lastAttempt: receipt.ts,
          failures: [],
        });
      }

      const history = addressHistoryMap.get(key)!;
      history.successCount++;
      history.totalAttempts++;
      history.status = 'success';
      history.successTimestamp = receipt.ts;

      // Update last attempt if this is more recent
      if (new Date(receipt.ts) > new Date(history.lastAttempt)) {
        history.lastAttempt = receipt.ts;
      }
    });

    // Update status for entries with only failures
    addressHistoryMap.forEach(history => {
      if (history.successCount === 0 && history.failureCount > 0) {
        history.status = 'failed';
      }
    });

    // Convert to array and sort by last attempt (most recent first)
    const addressHistory = Array.from(addressHistoryMap.values())
      .sort((a, b) => new Date(b.lastAttempt).getTime() - new Date(a.lastAttempt).getTime());

    // Calculate unique failure count (deduplicated, excluding those that succeeded later)
    const uniqueFailureCount = failedErrors.length;

    // Calculate success rate based on unique solutions
    const totalUniqueSolutions = receipts.length + uniqueFailureCount;
    const successRate = totalUniqueSolutions > 0
      ? ((receipts.length / totalUniqueSolutions) * 100).toFixed(2) + '%'
      : '0%';

    // Count failures in the last 24 hours (for retry all button)
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    const recentFailures = failedErrors.filter(e =>
      new Date(e.lastAttempt).getTime() > twentyFourHoursAgo
    );

    return NextResponse.json({
      success: true,
      receipts,
      errors: failedErrors, // Return deduplicated, non-succeeded errors
      addressHistory,
      summary: {
        totalSolutions: receipts.length,
        totalErrors: uniqueFailureCount, // Unique failed solutions only
        totalRetryAttempts: rawErrors.length, // Raw retry attempts for reference
        successRate,
        recentFailureCount: recentFailures.length, // Failures in last 24h
      }
    });
  } catch (error: any) {
    console.error('[API] Mining history error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mining history' },
      { status: 500 }
    );
  }
}
