/**
 * API endpoint to consolidate rewards from one address to another
 * POST /api/consolidate/donate
 */

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { consolidationLogger } from '@/lib/storage/consolidation-logger';
import { profileManager } from '@/lib/config/profile-manager';

export async function POST(request: NextRequest) {
  try {
    // Get API base URL from active profile
    const profile = profileManager.getActiveProfile();
    const API_BASE = profile?.api?.baseUrl || 'https://mine.defensio.io/api';

    const body = await request.json();
    const { sourceAddress, destinationAddress, signature, sourceIndex, destinationIndex, destinationMode } = body;

    if (!sourceAddress || !destinationAddress || !signature) {
      return NextResponse.json(
        { error: 'Missing required fields: sourceAddress, destinationAddress, signature' },
        { status: 400 }
      );
    }

    // Skip if source and destination are the same
    if (sourceAddress === destinationAddress) {
      return NextResponse.json(
        { error: 'Source and destination cannot be the same' },
        { status: 400 }
      );
    }

    // POST /donate_to/{destination}/{source}/{signature}
    const url = `${API_BASE}/donate_to/${destinationAddress}/${sourceAddress}/${signature}`;

    console.log('[Consolidate API] Making donation request:', {
      url,
      sourceAddress,
      destinationAddress,
    });

    try {
      const response = await axios.post(url, {}, {
        timeout: 30000, // 30 second timeout
        validateStatus: () => true, // Accept all status codes, handle them manually
      });

      console.log('[Consolidate API] Server response:', {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log('[Consolidate API] ✓ Success:', response.data);

        // Log successful consolidation
        consolidationLogger.logConsolidation({
          ts: new Date().toISOString(),
          sourceAddress,
          sourceIndex,
          destinationAddress,
          destinationIndex,
          destinationMode: destinationMode || 'wallet',
          solutionsConsolidated: response.data.solutions_consolidated || 0,
          message: response.data.message || 'Rewards consolidated successfully',
          status: 'success',
        });

        return NextResponse.json({
          success: true,
          message: response.data.message || 'Rewards consolidated successfully',
          solutionsConsolidated: response.data.solutions_consolidated || 0,
          sourceAddress,
          destinationAddress,
        });
      }

      // Handle 409 Conflict - already donated
      else if (response.status === 409) {
        const message = response.data?.message || response.data || 'Address already donated';
        console.log('[Consolidate API] ⚠ Already donated:', message);

        // Log as success with 0 solutions (not a real failure)
        consolidationLogger.logConsolidation({
          ts: new Date().toISOString(),
          sourceAddress,
          sourceIndex,
          destinationAddress,
          destinationIndex,
          destinationMode: destinationMode || 'wallet',
          solutionsConsolidated: 0,
          message: typeof message === 'string' ? message : 'Already donated',
          status: 'success',
        });

        // Return success to client (will be handled as "already consolidated")
        return NextResponse.json({
          success: false,
          error: typeof message === 'string' ? message : 'Already donated to this address',
          alreadyDonated: true,
          sourceAddress,
          destinationAddress,
        });
      }

      // Handle other errors
      else {
        const errorMessage = response.data?.message || response.data || response.statusText || 'Server error';
        console.error('[Consolidate API] ✗ Server rejected consolidation:', {
          status: response.status,
          statusText: response.statusText,
          responseData: response.data,
          message: errorMessage,
        });

        // Log failed consolidation
        consolidationLogger.logConsolidation({
          ts: new Date().toISOString(),
          sourceAddress,
          sourceIndex,
          destinationAddress,
          destinationIndex,
          destinationMode: destinationMode || 'wallet',
          solutionsConsolidated: 0,
          message: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
          status: 'failed',
          error: typeof errorMessage === 'string' ? errorMessage : 'Server rejected consolidation request',
        });

        return NextResponse.json(
          {
            success: false,
            error: typeof errorMessage === 'string' ? errorMessage : 'Server rejected consolidation request',
            status: response.status,
            details: response.data,
          },
          { status: 200 } // Return 200 so client can handle the error gracefully
        );
      }
    } catch (axiosError: any) {
      // Check if it's a timeout
      const isTimeout = axiosError.code === 'ECONNABORTED' || axiosError.message?.includes('timeout');
      const errorMsg = isTimeout
        ? 'Midnight API request timed out after 30 seconds. The API may be slow or unresponsive.'
        : (axiosError.response?.data?.message || axiosError.message);
      const statusCode = axiosError.response?.status || 500;

      console.error('[Consolidate API] ✗ Request failed:', {
        error: axiosError.message,
        code: axiosError.code,
        isTimeout,
        status: statusCode,
        responseData: axiosError.response?.data,
        responseText: axiosError.response?.statusText,
      });

      // Log failed consolidation
      consolidationLogger.logConsolidation({
        ts: new Date().toISOString(),
        sourceAddress,
        sourceIndex,
        destinationAddress,
        destinationIndex,
        destinationMode: destinationMode || 'wallet',
        solutionsConsolidated: 0,
        status: 'failed',
        error: errorMsg,
      });

      return NextResponse.json(
        {
          success: false,
          error: errorMsg,
          isTimeout,
          status: statusCode,
          details: axiosError.response?.data,
        },
        { status: 200 } // Return 200 so client can handle gracefully
      );
    }
  } catch (error: any) {
    console.error('[API] Consolidate donate error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to consolidate rewards' },
      { status: 500 }
    );
  }
}
