/**
 * Statistics Computation
 * Calculates mining statistics from receipts including DFO rewards
 */

import 'server-only';
import axios from 'axios';
import { ReceiptEntry } from '../storage/receipts-logger';

export interface DayStats {
  day: number;
  date: string;
  receipts: number;
  addresses?: number;
  dfo: number;
}

export interface HourStats {
  hour: string; // ISO hour string like "2025-10-31T23:00:00"
  receipts: number;
  addresses: number;
  dfo: number;
}

export interface AddressStats {
  address: string;
  days: DayStats[];
  totalReceipts: number;
  totalDfo: number;
  firstSolution?: string;
  lastSolution?: string;
}

export interface GlobalStats {
  totalReceipts: number;
  totalAddresses: number;
  days: DayStats[];
  byAddress: AddressStats[];
  startDate?: string;
  endDate?: string;
  grandTotal: {
    receipts: number;
    dfo: number;
  };
}

/**
 * Fetch DFO rates from the API
 * Returns array where rates[0] is day 1, rates[1] is day 2, etc.
 */
export async function fetchRates(apiBase: string): Promise<number[]> {
  try {
    const response = await axios.get(`${apiBase}/work_to_star_rate`, {
      timeout: 5000,
    });
    return response.data;
  } catch (err: any) {
    console.error('[Stats] Failed to fetch work_to_star_rate:', err.message);
    return [];
  }
}

/**
 * Extract day number from challenge_id
 * Format: **D{day}C{challenge}
 * Example: **D01C10 -> day 1
 */
export function dayFromChallengeId(challengeId: string): number {
  const match = challengeId.match(/\*\*D(\d+)C/);
  if (!match) {
    throw new Error(`Invalid challenge_id format: ${challengeId}`);
  }
  return parseInt(match[1], 10);
}

// Mining start date for Defensio - Day 1 = 2025-11-20
// This is when mining began, not the TGE (token generation event)
const MINING_START_DATE = '2025-11-20';

/**
 * Get date string from challenge_id
 */
function dateFromChallengeId(challengeId: string): string {
  const day = dayFromChallengeId(challengeId);
  const miningStart = new Date(MINING_START_DATE + 'T00:00:00Z');
  const date = new Date(miningStart.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
  return date.toISOString().split('T')[0];
}

/**
 * Get date string from receipt timestamp
 * Returns the local date when the solution was submitted
 */
function dateFromTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toISOString().split('T')[0];
}

/**
 * Get day number from submission date
 * Day 1 = 2025-11-20 (mining start), so we calculate days since mining began
 */
function dayFromSubmissionDate(ts: string): number {
  const miningStart = new Date(MINING_START_DATE + 'T00:00:00Z');
  const submissionDate = new Date(ts);
  const daysSinceMiningStart = Math.floor((submissionDate.getTime() - miningStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return daysSinceMiningStart;
}

/**
 * Compute statistics from receipts with DFO rewards
 * Groups by SUBMISSION DATE (when user submitted), not challenge day
 * DFO rewards are still calculated based on the challenge's day rate
 */
export function computeStats(receipts: ReceiptEntry[], rates: number[]): GlobalStats {
  if (receipts.length === 0) {
    return {
      totalReceipts: 0,
      totalAddresses: 0,
      days: [],
      byAddress: [],
      grandTotal: {
        receipts: 0,
        dfo: 0,
      },
    };
  }

  // Group by address and SUBMISSION day (not challenge day)
  const addressDayMap = new Map<string, Map<number, { count: number; dfo: number }>>();
  const addressTimestamps = new Map<string, string[]>();

  for (const receipt of receipts) {
    const submissionDay = dayFromSubmissionDate(receipt.ts); // Use submission date for grouping AND rate
    const address = receipt.address;

    // Calculate DFO based on SUBMISSION day (rate is tied to when you submitted, not the challenge)
    // Only use rate if it exists - rates for current day won't be available until midnight
    const rateIndex = submissionDay - 1;
    const dfoPerReceipt = (rateIndex >= 0 && rateIndex < rates.length) ? rates[rateIndex] : 0;

    // Count receipts per address per submission day
    if (!addressDayMap.has(address)) {
      addressDayMap.set(address, new Map());
    }
    const dayMap = addressDayMap.get(address)!;
    const existing = dayMap.get(submissionDay) || { count: 0, dfo: 0 };
    dayMap.set(submissionDay, {
      count: existing.count + 1,
      dfo: existing.dfo + dfoPerReceipt,
    });

    // Track timestamps for first/last solution
    if (!addressTimestamps.has(address)) {
      addressTimestamps.set(address, []);
    }
    addressTimestamps.get(address)!.push(receipt.ts);
  }

  // Compute stats per address
  const byAddress: AddressStats[] = [];

  for (const [address, dayMap] of addressDayMap.entries()) {
    const days: DayStats[] = [];
    let totalReceipts = 0;
    let totalDfo = 0;

    for (const [day, stats] of dayMap.entries()) {
      // Calculate date from submission day
      const miningStart = new Date(MINING_START_DATE + 'T00:00:00Z');
      const date = new Date(miningStart.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];

      days.push({
        day,
        date: dateStr,
        receipts: stats.count,
        dfo: stats.dfo,
      });

      totalReceipts += stats.count;
      totalDfo += stats.dfo;
    }

    // Sort days descending (most recent first)
    days.sort((a, b) => b.day - a.day);

    // Get first and last solution timestamps
    const timestamps = addressTimestamps.get(address)!.sort();

    byAddress.push({
      address,
      days,
      totalReceipts,
      totalDfo,
      firstSolution: timestamps[0],
      lastSolution: timestamps[timestamps.length - 1],
    });
  }

  // Sort by total receipts descending
  byAddress.sort((a, b) => b.totalReceipts - a.totalReceipts);

  // Compute global daily stats by SUBMISSION date
  const globalDayMap = new Map<number, { addresses: Set<string>; receipts: number; dfo: number }>();

  for (const receipt of receipts) {
    const submissionDay = dayFromSubmissionDate(receipt.ts);

    // Calculate DFO based on SUBMISSION day (rate is tied to when you submitted, not the challenge)
    // Only use rate if it exists - rates for current day won't be available until midnight
    const rateIndex = submissionDay - 1;
    const dfoPerReceipt = (rateIndex >= 0 && rateIndex < rates.length) ? rates[rateIndex] : 0;

    if (!globalDayMap.has(submissionDay)) {
      globalDayMap.set(submissionDay, { addresses: new Set(), receipts: 0, dfo: 0 });
    }
    const dayStats = globalDayMap.get(submissionDay)!;
    dayStats.addresses.add(receipt.address);
    dayStats.receipts++;
    dayStats.dfo += dfoPerReceipt;
  }

  const days: DayStats[] = [];
  for (const [day, stats] of globalDayMap.entries()) {
    // Calculate date from submission day
    const miningStart = new Date(MINING_START_DATE + 'T00:00:00Z');
    const date = new Date(miningStart.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];

    days.push({
      day,
      date: dateStr,
      receipts: stats.receipts,
      addresses: stats.addresses.size,
      dfo: stats.dfo,
    });
  }

  // Sort days descending (most recent first)
  days.sort((a, b) => b.day - a.day);

  // Grand total
  const grandTotal = {
    receipts: receipts.length,
    dfo: byAddress.reduce((sum, a) => sum + a.totalDfo, 0),
  };

  return {
    totalReceipts: receipts.length,
    totalAddresses: addressDayMap.size,
    days,
    byAddress,
    grandTotal,
    // With descending sort, first is most recent, last is oldest
    startDate: days.length > 0 ? days[days.length - 1].date : undefined,
    endDate: days.length > 0 ? days[0].date : undefined,
  };
}

/**
 * Get stats for today only
 */
export function getTodayStats(receipts: ReceiptEntry[], rates: number[]): DayStats | null {
  const today = new Date().toISOString().split('T')[0];

  // Filter receipts by SUBMISSION date (r.ts), not challenge ID
  const todayReceipts = receipts.filter(r => {
    const submissionDate = dateFromTimestamp(r.ts);
    return submissionDate === today;
  });

  if (todayReceipts.length === 0) {
    return null;
  }

  const addresses = new Set(todayReceipts.map(r => r.address));
  const day = dayFromSubmissionDate(todayReceipts[0].ts); // Use submission date for day number

  // Calculate DFO based on SUBMISSION day (rate is tied to when you submitted, not the challenge)
  // Only use rate if it exists - rates for current day won't be available until midnight
  const rateIndex = day - 1;
  const dfoPerReceipt = (rateIndex >= 0 && rateIndex < rates.length) ? rates[rateIndex] : 0;
  const totalDfo = todayReceipts.length * dfoPerReceipt;

  return {
    day,
    date: today,
    receipts: todayReceipts.length,
    addresses: addresses.size,
    dfo: totalDfo,
  };
}

/**
 * Get solutions per hour rate
 */
export function getSolutionsPerHour(receipts: ReceiptEntry[], hours: number = 24): number {
  if (receipts.length === 0) return 0;

  const now = Date.now();
  const cutoff = now - (hours * 60 * 60 * 1000);

  const recentReceipts = receipts.filter(r => {
    const timestamp = new Date(r.ts).getTime();
    return timestamp >= cutoff;
  });

  return recentReceipts.length / hours;
}

/**
 * Compute statistics for the previous complete hour
 * Example: If current time is 11:22, return stats for 10:00-11:00
 */
export function computeHourlyStats(receipts: ReceiptEntry[], rates: number[]): HourStats | null {
  if (receipts.length === 0) {
    return null;
  }

  const now = new Date();

  // Get the previous complete hour
  // If now is 11:22, we want 10:00-11:00
  const previousHourStart = new Date(now);
  previousHourStart.setHours(now.getHours() - 1, 0, 0, 0);

  const previousHourEnd = new Date(now);
  previousHourEnd.setHours(now.getHours(), 0, 0, 0);

  // Filter receipts within the previous hour
  const hourReceipts = receipts.filter(r => {
    const receiptTime = new Date(r.ts);
    return receiptTime >= previousHourStart && receiptTime < previousHourEnd;
  });

  if (hourReceipts.length === 0) {
    return {
      hour: previousHourStart.toISOString(),
      receipts: 0,
      addresses: 0,
      dfo: 0
    };
  }

  // Count unique addresses
  const uniqueAddresses = new Set(hourReceipts.map(r => r.address));

  // Calculate DFO earnings based on SUBMISSION day
  // Only use rate if it exists - rates for current day won't be available until midnight
  let totalDfo = 0;
  for (const receipt of hourReceipts) {
    const submissionDay = dayFromSubmissionDate(receipt.ts);
    const rateIndex = submissionDay - 1;
    const dfoPerReceipt = (rateIndex >= 0 && rateIndex < rates.length) ? rates[rateIndex] : 0;
    totalDfo += dfoPerReceipt;
  }

  return {
    hour: previousHourStart.toISOString(),
    receipts: hourReceipts.length,
    addresses: uniqueAddresses.size,
    dfo: totalDfo
  };
}

/**
 * Compute statistics for the last N hours
 * Returns an array of hourly stats, ordered from oldest to newest
 * Example: computeLastNHours(receipts, rates, 8) returns last 8 hours of data
 */
export function computeLastNHours(receipts: ReceiptEntry[], rates: number[], hours: number): HourStats[] {
  if (receipts.length === 0 || hours <= 0) {
    return [];
  }

  const now = new Date();
  const result: HourStats[] = [];

  // Compute stats for each of the last N hours
  for (let i = hours - 1; i >= 0; i--) {
    const hourStart = new Date(now);
    hourStart.setHours(now.getHours() - i - 1, 0, 0, 0);

    const hourEnd = new Date(now);
    hourEnd.setHours(now.getHours() - i, 0, 0, 0);

    // Filter receipts within this hour
    const hourReceipts = receipts.filter(r => {
      const receiptTime = new Date(r.ts);
      return receiptTime >= hourStart && receiptTime < hourEnd;
    });

    // Count unique addresses
    const uniqueAddresses = new Set(hourReceipts.map(r => r.address));

    // Calculate DFO earnings based on SUBMISSION day (rate is tied to when you submitted, not the challenge)
    // Only use rate if it exists - rates for current day won't be available until midnight
    let totalDfo = 0;
    for (const receipt of hourReceipts) {
      const submissionDay = dayFromSubmissionDate(receipt.ts);
      const rateIndex = submissionDay - 1;
      const dfoPerReceipt = (rateIndex >= 0 && rateIndex < rates.length) ? rates[rateIndex] : 0;
      totalDfo += dfoPerReceipt;
    }

    result.push({
      hour: hourStart.toISOString(),
      receipts: hourReceipts.length,
      addresses: uniqueAddresses.size,
      dfo: totalDfo
    });
  }

  return result;
}
