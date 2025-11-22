import { NextResponse } from 'next/server';
import { receiptsLogger } from '@/lib/storage/receipts-logger';
import { computeStats, computeHourlyStats, computeLastNHours, fetchRates, getTodayStats, getSolutionsPerHour } from '@/lib/stats/compute';
import { profileManager } from '@/lib/config/profile-manager';

/**
 * Apply token decimals to convert from smallest unit to display unit
 * e.g., 44000000 with 6 decimals = 44.0 tokens
 */
function applyDecimals(value: number, decimals: number): number {
  return value / Math.pow(10, decimals);
}

/**
 * Apply decimals to all DFO values in stats objects
 */
function applyDecimalsToStats(stats: any, decimals: number): any {
  if (!stats) return stats;

  // Apply to grandTotal
  if (stats.grandTotal?.dfo !== undefined) {
    stats.grandTotal.dfo = applyDecimals(stats.grandTotal.dfo, decimals);
  }

  // Apply to days array
  if (stats.days) {
    stats.days = stats.days.map((day: any) => ({
      ...day,
      dfo: applyDecimals(day.dfo, decimals),
    }));
  }

  // Apply to byAddress array
  if (stats.byAddress) {
    stats.byAddress = stats.byAddress.map((addr: any) => ({
      ...addr,
      totalDfo: applyDecimals(addr.totalDfo, decimals),
      days: addr.days?.map((day: any) => ({
        ...day,
        dfo: applyDecimals(day.dfo, decimals),
      })),
    }));
  }

  return stats;
}

/**
 * GET /api/stats - Get mining statistics with token rewards
 */
export async function GET() {
  try {
    // Get API base URL and token decimals from active profile
    const profile = profileManager.getActiveProfile();
    const API_BASE = profile?.api?.baseUrl || 'https://mine.defensio.io/api';
    const tokenDecimals = profile?.token?.decimals ?? 6;

    const allReceipts = receiptsLogger.readReceipts();
    const errors = receiptsLogger.readErrors();

    // Filter out dev fee receipts from user stats
    const receipts = allReceipts.filter(r => !r.isDevFee);

    // Fetch token rates from API (returns values in smallest unit)
    const rates = await fetchRates(API_BASE);

    // Compute stats with token rewards (only user receipts, no dev fee)
    let globalStats = computeStats(receipts, rates);
    let hourlyStats = computeHourlyStats(receipts, rates);
    let last8Hours = computeLastNHours(receipts, rates, 8);
    let todayStats = getTodayStats(receipts, rates);
    const solutionsPerHour24h = getSolutionsPerHour(receipts, 24);
    const solutionsPerHour1h = getSolutionsPerHour(receipts, 1);

    // Apply token decimals to convert to display units
    globalStats = applyDecimalsToStats(globalStats, tokenDecimals);

    if (hourlyStats) {
      hourlyStats.dfo = applyDecimals(hourlyStats.dfo, tokenDecimals);
    }

    last8Hours = last8Hours.map(h => ({
      ...h,
      dfo: applyDecimals(h.dfo, tokenDecimals),
    }));

    if (todayStats) {
      todayStats.dfo = applyDecimals(todayStats.dfo, tokenDecimals);
    }

    return NextResponse.json({
      success: true,
      stats: {
        global: globalStats,
        hourly: hourlyStats,
        last8Hours: last8Hours,
        today: todayStats,
        rate: {
          perHour24h: solutionsPerHour24h,
          perHour1h: solutionsPerHour1h,
        },
        errors: {
          total: errors.length,
        },
        tokenDecimals, // Include for reference
      },
      profile: profile ? {
        id: profile.id,
        name: profile.name,
        ticker: profile.token?.ticker,
        statsUrl: profile.links?.statsUrl,
      } : null,
    });
  } catch (error: any) {
    console.error('[Stats API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
