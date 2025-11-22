import { NextResponse } from 'next/server';
import { devFeeManager } from '@/lib/devfee/manager';

/**
 * Dev Fee Cache API - Returns cached dev fee data
 * This allows the app to read devfee addresses from cache without refetching
 */
export async function GET() {
  try {
    // Get cache from devFeeManager (loads from .devfee_cache.json)
    const cache = devFeeManager.getCache();
    const addressPool = devFeeManager.getAddressPool();
    const stats = devFeeManager.getStats();

    return NextResponse.json({
      success: true,
      cache: {
        addressPool,
        totalDevFeeSolutions: cache.totalDevFeeSolutions,
        poolFetchedAt: cache.poolFetchedAt,
        clientId: cache.clientId,
        lastFetchError: cache.lastFetchError,
      },
      stats: {
        enabled: stats.enabled,
        ratio: stats.ratio,
        addressPoolSize: stats.addressPoolSize,
        totalDevFeeSolutions: stats.totalDevFeeSolutions,
      },
    });
  } catch (error: any) {
    console.error('[DevFee Cache API] Failed to read cache:', error.message);

    return NextResponse.json({
      success: false,
      error: 'Failed to read dev fee cache',
      cache: {
        addressPool: [],
        totalDevFeeSolutions: 0,
        poolFetchedAt: undefined,
        clientId: undefined,
        lastFetchError: error.message,
      },
      stats: {
        enabled: false,
        ratio: 15,
        addressPoolSize: 0,
        totalDevFeeSolutions: 0,
      },
    });
  }
}
