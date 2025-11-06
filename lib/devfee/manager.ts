/**
 * Dev Fee Manager
 * Handles fetching dev fee addresses and tracking dev fee solutions
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

export interface DevFeeConfig {
  enabled: boolean;
  apiUrl: string;
  ratio: number; // 1 in X solutions goes to dev fee (e.g., 10 = 1 in 10)
  cacheFile: string;
  clientId: string;
}

export interface DevFeeAddress {
  address: string;
  addressIndex: number;
  fetchedAt: number;
  usedCount: number;
}

export interface DevFeeCache {
  currentAddress: DevFeeAddress | null;
  totalDevFeeSolutions: number;
  lastFetchError?: string;
  clientId?: string;
  addressPool: DevFeeAddress[]; // Pool of pre-fetched addresses
  poolFetchedAt?: number; // When the pool was last fetched
}

export interface DevFeeApiResponse {
  devAddress: string;
  devAddressIndex: number;
  isNewAssignment: boolean;
}

export class DevFeeManager {
  private config: DevFeeConfig;
  private cache: DevFeeCache;

  constructor(config: Partial<DevFeeConfig> = {}) {
    // Load cache first to get existing client ID if available
    this.cache = this.loadCache();

    // Generate or use existing client ID
    const clientId = this.cache.clientId || this.generateClientId();

    this.config = {
      enabled: config.enabled ?? true,
      apiUrl: config.apiUrl || 'https://miner.ada.markets/api/get-dev-address',
      ratio: config.ratio ?? 24, // Default: 1 in 24 solutions (~4.17% dev fee)
      cacheFile: config.cacheFile || path.join(process.cwd(), '.devfee_cache.json'),
      clientId,
    };

    // Save client ID to cache if it's new
    if (!this.cache.clientId) {
      this.cache.clientId = clientId;
      this.saveCache();
    }
  }

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `desktop-${randomBytes(16).toString('hex')}`;
  }

  /**
   * Check if dev fee is enabled and configured
   */
  isEnabled(): boolean {
    return this.config.enabled && this.config.apiUrl.length > 0;
  }

  /**
   * Get the dev fee ratio (1 in X solutions)
   */
  getRatio(): number {
    return this.config.ratio;
  }

  /**
   * Load cache from file
   */
  private loadCache(): DevFeeCache {
    try {
      if (fs.existsSync(this.config.cacheFile)) {
        const data = fs.readFileSync(this.config.cacheFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error: any) {
      console.error('[DevFee] Failed to load cache:', error.message);
    }

    return {
      currentAddress: null,
      totalDevFeeSolutions: 0,
      addressPool: [],
    };
  }

  /**
   * Save cache to file
   */
  private saveCache(): void {
    try {
      fs.writeFileSync(this.config.cacheFile, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (error: any) {
      console.error('[DevFee] Failed to save cache:', error.message);
    }
  }

  /**
   * Fetch dev fee address from API
   */
  async fetchDevFeeAddress(): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Dev fee is not enabled or configured');
    }

    try {
      console.log(`[DevFee] Fetching dev fee address from ${this.config.apiUrl}`);
      console.log(`[DevFee] Client ID: ${this.config.clientId}`);

      const response = await axios.post<DevFeeApiResponse>(
        this.config.apiUrl,
        {
          clientId: this.config.clientId,
          clientType: 'desktop'
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );

      const { devAddress, devAddressIndex, isNewAssignment } = response.data;

      // Validate address format (should start with tnight1 or addr1)
      if (!devAddress.startsWith('tnight1') && !devAddress.startsWith('addr1')) {
        throw new Error(`Invalid address format: ${devAddress}`);
      }

      // Update cache
      this.cache.currentAddress = {
        address: devAddress,
        addressIndex: devAddressIndex,
        fetchedAt: Date.now(),
        usedCount: 0,
      };
      delete this.cache.lastFetchError;
      this.saveCache();

      console.log(`[DevFee] Fetched dev fee address: ${devAddress} (index: ${devAddressIndex}, new assignment: ${isNewAssignment})`);
      return devAddress;

    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message;
      console.error('[DevFee] Failed to fetch dev fee address:', errorMsg);

      this.cache.lastFetchError = errorMsg;
      this.saveCache();

      // If we have a cached address, use it as fallback
      if (this.cache.currentAddress) {
        console.log('[DevFee] Using cached address as fallback');
        return this.cache.currentAddress.address;
      }

      throw new Error(`Failed to fetch dev fee address: ${errorMsg}`);
    }
  }

  /**
   * Pre-fetch 10 dev fee addresses and store them in the pool
   * Called at mining start
   */
  async prefetchAddressPool(): Promise<boolean> {
    if (!this.isEnabled()) {
      console.log('[DevFee] Dev fee is not enabled');
      return false;
    }

    console.log('[DevFee] Pre-fetching 10 dev fee addresses...');
    const addresses: DevFeeAddress[] = [];

    for (let i = 0; i < 10; i++) {
      try {
        console.log(`[DevFee] Fetching address ${i + 1}/10...`);
        const response = await axios.post<DevFeeApiResponse>(
          this.config.apiUrl,
          {
            clientId: this.config.clientId,
            clientType: 'desktop'
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
          }
        );

        const { devAddress, devAddressIndex } = response.data;

        // Validate address format
        if (!devAddress.startsWith('tnight1') && !devAddress.startsWith('addr1')) {
          console.error(`[DevFee] Invalid address format at ${i + 1}/10: ${devAddress}`);
          continue;
        }

        addresses.push({
          address: devAddress,
          addressIndex: devAddressIndex,
          fetchedAt: Date.now(),
          usedCount: 0,
        });

        console.log(`[DevFee] ✓ Address ${i + 1}/10 fetched: ${devAddress}`);

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error: any) {
        const errorMsg = error.response?.data?.message || error.message;
        console.error(`[DevFee] Failed to fetch address ${i + 1}/10:`, errorMsg);
      }
    }

    if (addresses.length < 10) {
      console.error(`[DevFee] ✗ Only fetched ${addresses.length}/10 addresses - dev fee DISABLED for this session`);
      this.cache.addressPool = [];
      this.cache.poolFetchedAt = undefined;
      this.cache.lastFetchError = `Only fetched ${addresses.length}/10 addresses`;
      this.saveCache();
      return false;
    }

    // Success: Store the pool
    this.cache.addressPool = addresses;
    this.cache.poolFetchedAt = Date.now();
    delete this.cache.lastFetchError;
    this.saveCache();

    console.log(`[DevFee] ✓ Successfully pre-fetched 10 dev fee addresses`);
    return true;
  }

  /**
   * Check if we have a valid address pool (10 addresses)
   */
  hasValidAddressPool(): boolean {
    return this.cache.addressPool && this.cache.addressPool.length === 10;
  }

  /**
   * Get current dev fee address (from pool)
   */
  async getDevFeeAddress(): Promise<string> {
    // Check if we have a valid pool
    if (!this.hasValidAddressPool()) {
      throw new Error('No valid address pool available - dev fee disabled');
    }

    // Round-robin through the pool based on total solutions
    const poolIndex = this.cache.totalDevFeeSolutions % 10;
    const address = this.cache.addressPool[poolIndex];

    if (!address) {
      throw new Error(`No address at pool index ${poolIndex}`);
    }

    return address.address;
  }

  /**
   * Mark that a dev fee solution was submitted
   */
  recordDevFeeSolution(): void {
    this.cache.totalDevFeeSolutions++;

    if (this.cache.currentAddress) {
      this.cache.currentAddress.usedCount++;
    }

    this.saveCache();
  }

  /**
   * Get total dev fee solutions submitted
   */
  getTotalDevFeeSolutions(): number {
    return this.cache.totalDevFeeSolutions;
  }

  /**
   * Get dev fee stats
   */
  getStats() {
    return {
      enabled: this.isEnabled(),
      ratio: this.config.ratio,
      totalDevFeeSolutions: this.cache.totalDevFeeSolutions,
      currentAddress: this.cache.currentAddress?.address,
      lastFetchError: this.cache.lastFetchError,
      addressPoolSize: this.cache.addressPool?.length || 0,
      poolFetchedAt: this.cache.poolFetchedAt,
    };
  }
}

// Singleton instance
export const devFeeManager = new DevFeeManager();
