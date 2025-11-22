/**
 * Consolidation Logger
 * Logs successful consolidation/donation records to JSONL file
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ConsolidationRecord {
  ts: string; // ISO timestamp
  sourceAddress: string;
  sourceIndex?: number; // Address index if from wallet
  destinationAddress: string;
  destinationIndex?: number; // Destination address index if from wallet
  destinationMode: 'wallet' | 'custom';
  solutionsConsolidated: number;
  message?: string; // Server response message
  status: 'success' | 'failed';
  error?: string; // Error message if failed
}

class ConsolidationLogger {
  private consolidationFile: string;

  constructor() {
    // Use profile-aware path resolver if available
    let storageDir: string;

    try {
      // Try to use profile-specific path
      const { pathResolver } = require('@/lib/storage/path-resolver');
      storageDir = pathResolver.getStorageDir();
    } catch (error) {
      // Fallback for legacy support
      const oldStorageDir = path.join(process.cwd(), 'storage');
      const newDataDir = path.join(
        process.env.USERPROFILE || process.env.HOME || process.cwd(),
        'Documents',
        'FetcherBot'
      );

      // Check if receipts exist in old location (installation folder)
      const oldReceiptsFile = path.join(oldStorageDir, 'receipts.jsonl');
      if (fs.existsSync(oldReceiptsFile)) {
        storageDir = oldStorageDir;
        console.log(`[Consolidation] Using installation folder: ${storageDir}`);
      } else {
        // Otherwise use Documents folder (old default)
        storageDir = path.join(newDataDir, 'storage');
        console.log(`[Consolidation] Using Documents folder: ${storageDir}`);
      }

      // Ensure storage directory exists
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
    }

    this.consolidationFile = path.join(storageDir, 'consolidations.jsonl');
  }

  /**
   * Log a consolidation record (success or failure)
   */
  logConsolidation(record: ConsolidationRecord): void {
    try {
      const line = JSON.stringify(record) + '\n';
      fs.appendFileSync(this.consolidationFile, line, 'utf8');
    } catch (error: any) {
      console.error('[ConsolidationLogger] Failed to log consolidation:', error.message);
    }
  }

  /**
   * Read all consolidation records
   */
  readConsolidations(): ConsolidationRecord[] {
    try {
      if (!fs.existsSync(this.consolidationFile)) {
        return [];
      }

      const content = fs.readFileSync(this.consolidationFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.error('[ConsolidationLogger] Failed to parse consolidation line:', line);
          return null;
        }
      }).filter(record => record !== null) as ConsolidationRecord[];
    } catch (error: any) {
      console.error('[ConsolidationLogger] Failed to read consolidations:', error.message);
      return [];
    }
  }

  /**
   * Get consolidations for a specific source address
   */
  getConsolidationsForAddress(address: string): ConsolidationRecord[] {
    const allRecords = this.readConsolidations();
    return allRecords.filter(record => record.sourceAddress === address);
  }

  /**
   * Get all successful consolidations
   */
  getSuccessfulConsolidations(): ConsolidationRecord[] {
    const allRecords = this.readConsolidations();
    return allRecords.filter(record => record.status === 'success');
  }

  /**
   * Get recent consolidations (last N records)
   */
  getRecentConsolidations(count: number): ConsolidationRecord[] {
    try {
      if (!fs.existsSync(this.consolidationFile)) {
        return [];
      }

      const content = fs.readFileSync(this.consolidationFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Get last N lines
      const recentLines = lines.slice(-count);

      return recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.error('[ConsolidationLogger] Failed to parse consolidation line:', line);
          return null;
        }
      }).filter(record => record !== null) as ConsolidationRecord[];
    } catch (error: any) {
      console.error('[ConsolidationLogger] Failed to read recent consolidations:', error.message);
      return [];
    }
  }

  /**
   * Check if an address has been consolidated to a destination
   */
  hasAddressBeenConsolidated(sourceAddress: string, destinationAddress?: string): boolean {
    const records = this.getConsolidationsForAddress(sourceAddress);
    const successfulRecords = records.filter(r => r.status === 'success');

    if (!destinationAddress) {
      return successfulRecords.length > 0;
    }

    return successfulRecords.some(r => r.destinationAddress === destinationAddress);
  }

  /**
   * Get the latest consolidation for an address
   */
  getLatestConsolidation(sourceAddress: string): ConsolidationRecord | null {
    const records = this.getConsolidationsForAddress(sourceAddress);
    if (records.length === 0) return null;
    return records[records.length - 1];
  }
}

// Singleton instance
export const consolidationLogger = new ConsolidationLogger();
