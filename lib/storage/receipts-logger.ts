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
  private _storageDir: string | null = null;
  private _receiptsFile: string | null = null;
  private _errorsFile: string | null = null;

  private getStorageDir(): string {
    if (this._storageDir) return this._storageDir;

    try {
      // Try to use profile-specific path
      const { pathResolver } = require('@/lib/storage/path-resolver');
      const resolvedDir = pathResolver.getStorageDir();
      this._storageDir = resolvedDir;
      console.log(`[Receipts] Using profile-specific path: ${resolvedDir}`);
      return resolvedDir;
    } catch (error: any) {
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
        this._storageDir = oldStorageDir;
        console.log(`[Receipts] Found existing receipts in installation folder`);
        console.log(`[Receipts] Using: ${this._storageDir}`);
      } else {
        // Otherwise use Documents folder (old default)
        this._storageDir = path.join(newDataDir, 'storage');
        console.log(`[Receipts] Warning: No active profile, using legacy path: ${this._storageDir}`);
        console.log(`[Receipts] Error was: ${error.message}`);
      }

      // Ensure storage directory exists
      if (!fs.existsSync(this._storageDir)) {
        fs.mkdirSync(this._storageDir, { recursive: true });
      }
      return this._storageDir;
    }
  }

  get receiptsFile(): string {
    if (!this._receiptsFile) {
      this._receiptsFile = path.join(this.getStorageDir(), 'receipts.jsonl');
    }
    return this._receiptsFile;
  }

  get errorsFile(): string {
    if (!this._errorsFile) {
      this._errorsFile = path.join(this.getStorageDir(), 'errors.jsonl');
    }
    return this._errorsFile;
  }

  // Reset cached paths (call when profile changes)
  resetPaths(): void {
    this._storageDir = null;
    this._receiptsFile = null;
    this._errorsFile = null;
    console.log('[Receipts] Path cache cleared - will re-resolve on next access');
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
   * Get receipts for a specific challenge ID
   * Returns all receipts matching the challenge, limited to the most recent 'count' entries
   */
  getReceiptsForChallenge(challengeId: string, count?: number): Receipt[] {
    try {
      if (!fs.existsSync(this.receiptsFile)) {
        return [];
      }

      const content = fs.readFileSync(this.receiptsFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Parse all receipts and filter by challenge ID
      const allReceipts = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      }).filter(receipt => receipt !== null && receipt.challenge_id === challengeId) as Receipt[];

      // Return limited count if specified, otherwise return all
      if (count !== undefined && count > 0) {
        return allReceipts.slice(-count);
      }

      return allReceipts;
    } catch (error: any) {
      console.error('[ReceiptsLogger] Failed to read receipts for challenge:', error.message);
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

  /**
   * Remove an error entry (called when retry is successful)
   * Removes all errors matching the address, challengeId, and nonce
   */
  removeError(address: string, challengeId: string, nonce: string): void {
    try {
      if (!fs.existsSync(this.errorsFile)) {
        return;
      }

      const content = fs.readFileSync(this.errorsFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Filter out the matching error(s)
      const remainingLines = lines.filter(line => {
        try {
          const errorLog = JSON.parse(line);
          // Remove if address, challenge_id, and nonce all match
          const shouldRemove =
            errorLog.address === address &&
            errorLog.challenge_id === challengeId &&
            errorLog.nonce === nonce;
          return !shouldRemove;
        } catch (e) {
          // Keep malformed lines
          return true;
        }
      });

      // Rewrite the errors file
      const newContent = remainingLines.length > 0
        ? remainingLines.join('\n') + '\n'
        : '';
      fs.writeFileSync(this.errorsFile, newContent, 'utf8');

      console.log(`[ReceiptsLogger] Removed error for ${address.slice(0, 20)}... (challenge: ${challengeId.slice(0, 16)}...)`);
    } catch (error: any) {
      console.error('[ReceiptsLogger] Failed to remove error:', error.message);
    }
  }
}

// Singleton instance
export const receiptsLogger = new ReceiptsLogger();
