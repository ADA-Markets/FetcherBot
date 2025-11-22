/**
 * Retry All Failed Submissions API
 * POST /api/mining/retry-all
 *
 * Attempts to resubmit all failed solutions from the last 24 hours
 */

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { profileManager } from '@/lib/config/profile-manager';
import { receiptsLogger } from '@/lib/storage/receipts-logger';

interface RetryResult {
  address: string;
  challengeId: string;
  nonce: string;
  success: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Get API base URL from active profile
    const profile = profileManager.getActiveProfile();
    if (!profile) {
      return NextResponse.json(
        { error: 'No active profile configured' },
        { status: 400 }
      );
    }

    const apiBase = profile.api?.baseUrl;
    if (!apiBase) {
      return NextResponse.json(
        { error: 'No API base URL configured for active profile' },
        { status: 400 }
      );
    }

    // Read all errors
    const rawErrors = receiptsLogger.readErrors();
    const receipts = receiptsLogger.readReceipts();

    // Get successful solutions to exclude
    const successfulSolutions = new Set(
      receipts.map(r => `${r.address}:${r.challenge_id}:${r.nonce}`)
    );

    // Deduplicate errors and filter to last 24 hours
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    const errorMap = new Map<string, typeof rawErrors[0]>();

    rawErrors.forEach(error => {
      const key = `${error.address}:${error.challenge_id}:${error.nonce}`;

      // Skip if already succeeded
      if (successfulSolutions.has(key)) return;

      // Keep most recent error for each unique solution
      if (!errorMap.has(key) || new Date(error.ts) > new Date(errorMap.get(key)!.ts)) {
        errorMap.set(key, error);
      }
    });

    // Filter to last 24 hours
    const recentErrors = Array.from(errorMap.values()).filter(
      error => new Date(error.ts).getTime() > twentyFourHoursAgo
    );

    if (recentErrors.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No failures to retry in the last 24 hours',
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 }
      });
    }

    console.log(`[Retry All API] Attempting to retry ${recentErrors.length} failed solutions...`);

    const results: RetryResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process each error with a small delay between requests
    for (const error of recentErrors) {
      try {
        const url = `${apiBase}/solution/${error.address}/${error.challenge_id}/${error.nonce}`;

        const response = await axios.post(url, {}, {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' },
        });

        console.log(`[Retry All API] ✓ Success: ${error.address.slice(0, 20)}...`);

        // Log successful receipt
        receiptsLogger.logReceipt({
          ts: new Date().toISOString(),
          address: error.address,
          addressIndex: error.addressIndex,
          challenge_id: error.challenge_id,
          nonce: error.nonce,
          hash: error.hash || '',
          crypto_receipt: response.data?.crypto_receipt,
          isDevFee: false,
        });

        // Remove from errors file
        receiptsLogger.removeError(error.address, error.challenge_id, error.nonce);

        results.push({
          address: error.address,
          challengeId: error.challenge_id,
          nonce: error.nonce,
          success: true,
        });
        succeeded++;

      } catch (err: any) {
        const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message;
        console.log(`[Retry All API] ✗ Failed: ${error.address.slice(0, 20)}... - ${errorMessage}`);

        results.push({
          address: error.address,
          challengeId: error.challenge_id,
          nonce: error.nonce,
          success: false,
          error: errorMessage,
        });
        failed++;
      }

      // Small delay between requests to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[Retry All API] Complete: ${succeeded} succeeded, ${failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Retried ${recentErrors.length} solutions: ${succeeded} succeeded, ${failed} failed`,
      results,
      summary: {
        total: recentErrors.length,
        succeeded,
        failed,
      }
    });

  } catch (error: any) {
    console.error('[Retry All API] Error:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
