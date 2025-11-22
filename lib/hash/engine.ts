/**
 * Hash Engine - HTTP client for external Rust hash service
 */

import 'server-only';
import { AshConfig, DEFAULT_ASH_CONFIG, HashEngineStatus } from './types';
import { HashClient } from './client';

class HashEngine {
  private hashClient: HashClient | null = null;
  private romInitialized = false;
  private currentNoPreMine: string | null = null;
  private currentConfig: AshConfig | null = null;

  constructor() {
    // Initialize HashClient connection to external hash server
    const hashServiceUrl = process.env.HASH_SERVICE_URL || 'http://127.0.0.1:9001';
    this.hashClient = new HashClient(hashServiceUrl, {
      maxConnectionsPerUrl: 500, // Supports high-core systems (64+ cores)
      keepAliveTimeout: 60000,
      requestTimeout: 10000,
      maxRetries: 3,
      retryDelayMs: 100,
    });
    console.log('[Hash Engine] Initialized HTTP client for hash service:', hashServiceUrl);
  }

  /**
   * Check if hash service is available
   */
  async isNativeAvailable(): Promise<boolean> {
    if (!this.hashClient) return false;
    return await this.hashClient.healthCheck();
  }

  /**
   * Initialize ROM with challenge-specific no_pre_mine value
   * This sends init request to external Rust hash server
   */
  async initRom(noPreMine: string, config: AshConfig = DEFAULT_ASH_CONFIG): Promise<void> {
    console.log(`[Hash Engine] ═══════════════════════════════════════════════`);
    console.log(`[Hash Engine] ROM INITIALIZATION (via HTTP)`);
    console.log(`[Hash Engine] no_pre_mine (first 8): ${noPreMine.slice(0, 8)}`);
    console.log(`[Hash Engine] no_pre_mine (last 8):  ${noPreMine.slice(-8)}`);
    console.log(`[Hash Engine] Config:`, config);

    if (!this.hashClient) {
      throw new Error('Hash service client not initialized. Mining cannot proceed.');
    }

    try {
      this.romInitialized = false;
      console.log('[Hash Engine] Sending init request to hash service...');

      const initStart = Date.now();
      await this.hashClient.init(noPreMine);

      this.currentNoPreMine = noPreMine;
      this.currentConfig = config;
      this.romInitialized = true;

      const elapsed = ((Date.now() - initStart) / 1000).toFixed(1);
      console.log(`[Hash Engine] ✓ ROM ready in ${elapsed}s`);
      console.log(`[Hash Engine] romReady: ${this.isRomReady()}`);
      console.log(`[Hash Engine] ═══════════════════════════════════════════════`);
    } catch (err: any) {
      console.error(`[Hash Engine] ✗ ROM initialization failed: ${err.message}`);
      throw new Error(`Hash service init_rom failed: ${err.message}`);
    }
  }

  /**
   * Check if ROM is ready
   */
  isRomReady(): boolean {
    return this.romInitialized && this.hashClient?.getRomInitialized() === true;
  }

  /**
   * Compute hash for preimage via HTTP
   * Returns 64-byte (128-char) hex string
   */
  hash(preimage: string): string {
    if (!this.romInitialized) {
      throw new Error('ROM not initialized. Call initRom() first.');
    }

    if (!this.hashClient) {
      throw new Error('Hash service client not available. Cannot compute hash.');
    }

    // Note: hash() is synchronous but hashClient.hash() is async
    // We'll need to handle this differently - see below
    throw new Error('Synchronous hash() not supported with HTTP client. Use hashAsync() instead.');
  }

  /**
   * Compute hash for preimage via HTTP (async version)
   * Returns 64-byte (128-char) hex string
   */
  async hashAsync(preimage: string): Promise<string> {
    if (!this.romInitialized) {
      throw new Error('ROM not initialized. Call initRom() first.');
    }

    if (!this.hashClient) {
      throw new Error('Hash service client not available. Cannot compute hash.');
    }

    try {
      const result = await this.hashClient.hash(preimage);
      if (result.length !== 128) {
        throw new Error(`Invalid hash length: expected 128, got ${result.length}`);
      }
      return result;
    } catch (err: any) {
      throw new Error(`Hash service hash_preimage failed: ${err.message}`);
    }
  }

  /**
   * Compute hashes for multiple preimages in parallel via HTTP batch endpoint
   * Uses Rayon on the Rust side for true parallel processing across all CPU cores
   * Returns array of 64-byte (128-char) hex strings
   */
  async hashBatchAsync(preimages: string[]): Promise<string[]> {
    if (!this.romInitialized) {
      throw new Error('ROM not initialized. Call initRom() first.');
    }

    if (!this.hashClient) {
      throw new Error('Hash service client not available. Cannot compute hash.');
    }

    if (preimages.length === 0) {
      return [];
    }

    try {
      const results = await this.hashClient.hashBatch(preimages);

      // Validate all hash lengths
      for (let i = 0; i < results.length; i++) {
        if (results[i].length !== 128) {
          throw new Error(`Invalid hash length at index ${i}: expected 128, got ${results[i].length}`);
        }
      }

      return results;
    } catch (err: any) {
      throw new Error(`Hash service batch hash_preimage failed: ${err.message}`);
    }
  }

  /**
   * Get current configuration
   */
  getCurrentNoPreMine(): string | null {
    return this.currentNoPreMine;
  }

  getCurrentConfig(): AshConfig | null {
    return this.currentConfig;
  }

  /**
   * Kill all worker threads in the hash service
   * Call this when a new challenge comes in to stop workers processing old challenge
   */
  async killWorkers(): Promise<void> {
    if (!this.hashClient) {
      console.log('[Hash Engine] No hash client available to kill workers');
      return;
    }
    await this.hashClient.killWorkers();
  }

  /**
   * Get engine status
   */
  async getStatus(): Promise<HashEngineStatus> {
    return {
      romInitialized: this.isRomReady(),
      nativeAvailable: await this.isNativeAvailable(),
      config: this.currentConfig,
      no_pre_mine_first8: this.currentNoPreMine ? this.currentNoPreMine.slice(0, 8) : null,
      no_pre_mine_last8: this.currentNoPreMine ? this.currentNoPreMine.slice(-8) : null,
    };
  }
}

// Singleton instance
export const hashEngine = new HashEngine();
