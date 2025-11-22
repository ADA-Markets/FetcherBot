/**
 * Receipts Logger
 * Logs successful solution receipts and errors to JSONL files
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Receipt {
  ts: string;
  address: string;
  addressIndex?: number; // Address index (0-199)
  challenge_id: string;
  nonce: string;
  hash: string;
  crypto_receipt?: any;
  isDevFee?: boolean; // Flag to mark dev fee solutions
}

// Alias for compatibility with stats module
export type ReceiptEntry = Receipt;

export interface ErrorLog {
  ts: string;
  address: string;
  addressIndex?: number; // Address index (0-199)
  challenge_id: string;
  nonce: string;
  hash: string;
  error: string;
  response?: any;
}

class ReceiptsLogger {
  private receiptsFile: string;
  private errorsFile: string;

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
        console.log(`[Receipts] Found existing receipts in installation folder`);
        console.log(`[Receipts] Using: ${storageDir}`);
      } else {
        // Otherwise use Documents folder (old default)
        storageDir = path.join(newDataDir, 'storage');
        console.log(`[Receipts] Using Documents folder: ${storageDir}`);
      }

      // Ensure storage directory exists
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
    }

    this.receiptsFile = path.join(storageDir, 'receipts.jsonl');
    this.errorsFile = path.join(storageDir, 'errors.jsonl');
  }

  /**
   * Log a successful receipt
   */
  logReceipt(receipt: Receipt): void {
    try {
      const line = JSON.stringify(receipt) + '\n';
      fs.appendFileSync(this.receiptsFile, line, 'utf8');
    } catch (error: any) {
      console.error('[ReceiptsLogger] Failed to log receipt:', error.message);
    }
  }

  /**
   * Log an error
   */
  logError(errorLog: ErrorLog): void {
    try {
      const line = JSON.stringify(errorLog) + '\n';
      fs.appendFileSync(this.errorsFile, line, 'utf8');
    } catch (error: any) {
      console.error('[ReceiptsLogger] Failed to log error:', error.message);
    }
  }

  /**
   * Read all receipts
   */
  readReceipts(): Receipt[] {
    try {
      if (!fs.existsSync(this.receiptsFile)) {
        return [];
      }

      const content = fs.readFileSync(this.receiptsFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.error('[ReceiptsLogger] Failed to parse receipt line:', line);
          return null;
        }
      }).filter(receipt => receipt !== null) as Receipt[];
    } catch (error: any) {
      console.error('[ReceiptsLogger] Failed to read receipts:', error.message);
      return [];
    }
  }

  /**
   * Get the last N receipts
   */
  getRecentReceipts(count: number): Receipt[] {
    try {
      if (!fs.existsSync(this.receiptsFile)) {
        return [];
      }

      const content = fs.readFileSync(this.receiptsFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Get last N lines
      const recentLines = lines.slice(-count);

      return recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.error('[ReceiptsLogger] Failed to parse receipt line:', line);
          return null;
        }
      }).filter(receipt => receipt !== null) as Receipt[];
    } catch (error: any) {
      console.error('[ReceiptsLogger] Failed to read recent receipts:', error.message);
      return [];
    }
  }

  /**
   * Read all errors
   */
  readErrors(): ErrorLog[] {
    try {
      if (!fs.existsSync(this.errorsFile)) {
        return [];
      }

      const content = fs.readFileSync(this.errorsFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.error('[ReceiptsLogger] Failed to parse error line:', line);
          return null;
        }
      }).filter(errorLog => errorLog !== null) as ErrorLog[];
    } catch (error: any) {
      console.error('[ReceiptsLogger] Failed to read errors:', error.message);
      return [];
    }
  }
}

// Singleton instance
export const receiptsLogger = new ReceiptsLogger();
