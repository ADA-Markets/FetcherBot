import axios, { AxiosInstance } from 'axios';
import http from 'http';

interface ConnectionPoolConfig {
  maxConnectionsPerUrl?: number;
  keepAliveTimeout?: number;
  requestTimeout?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class HashClient {
  private baseUrl: string;
  private axiosInstance: AxiosInstance;
  private keepAliveAgent: http.Agent;
  private maxRetries: number;
  private retryDelayMs: number;
  private romInitialized = false;

  constructor(baseUrl: string = 'http://127.0.0.1:9001', poolConfig?: ConnectionPoolConfig) {
    this.baseUrl = baseUrl;

    const maxConnectionsPerUrl = poolConfig?.maxConnectionsPerUrl || 50;
    const keepAliveTimeout = poolConfig?.keepAliveTimeout || 60000;
    const requestTimeout = poolConfig?.requestTimeout || 10000;
    this.maxRetries = poolConfig?.maxRetries || 3;
    this.retryDelayMs = poolConfig?.retryDelayMs || 100;

    this.keepAliveAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: keepAliveTimeout,
      maxSockets: maxConnectionsPerUrl,
      maxFreeSockets: maxConnectionsPerUrl,
      timeout: keepAliveTimeout,
    });

    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      timeout: requestTimeout,
      httpAgent: this.keepAliveAgent,
      headers: {
        'Connection': 'keep-alive',
      },
      maxContentLength: 50 * 1024 * 1024, // 50MB for batch requests
      maxBodyLength: 50 * 1024 * 1024, // 50MB for batch requests
    });

    console.log(`[HashClient] Connection pool initialized: ${maxConnectionsPerUrl} connections to ${baseUrl}`);
  }

  async init(noPreMine: string): Promise<void> {
    console.log(`[HashClient] Initializing ROM on hash service...`);
    console.log(`[HashClient] no_pre_mine=${noPreMine.slice(0,16)}...`);

    const initPayload = {
      no_pre_mine: noPreMine,
      ashConfig: {
        nbLoops: 8,
        nbInstrs: 256,
        pre_size: 16777216,
        rom_size: 1073741824,
        mixing_numbers: 4
      }
    };

    try {
      const response = await axios.post(`${this.baseUrl}/init`, initPayload, {
        timeout: 120000,
        httpAgent: new http.Agent({ keepAlive: false }),
        headers: { 'Connection': 'close' }
      });

      const workerPid = response.data.worker_pid;
      console.log(`[HashClient] ✓ Hash server initialized (PID ${workerPid})`);
      console.log(`[HashClient] ✓ ROM ready with 8 actix-web workers + rayon thread pool`);

      this.romInitialized = true;
    } catch (err: any) {
      console.error(`[HashClient] Init failed:`, err.message);
      throw new Error(`Failed to initialize hash service: ${err.message}`);
    }
  }

  async hash(preimage: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.axiosInstance.post('/hash', { preimage });
        return response.data.hash;
      } catch (err: any) {
        lastError = err;

        // Don't retry on certain errors
        if (err.response?.status === 400 || err.response?.status === 404) {
          throw new Error(`Failed to hash: ${err.response.data?.error || err.message}`);
        }

        // Retry on connection issues, timeouts, or 503 (service unavailable)
        const isRetriable =
          err.code === 'ECONNREFUSED' ||
          err.code === 'ECONNRESET' ||
          err.code === 'ETIMEDOUT' ||
          err.message.includes('socket hang up') ||
          err.response?.status === 503;

        if (!isRetriable || attempt === this.maxRetries - 1) {
          break;
        }

        // Exponential backoff
        const delay = this.retryDelayMs * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    if (lastError) {
      const errMsg = (lastError as any).response?.data?.error || (lastError as any).message || 'Unknown error';
      throw new Error(`Failed to hash after ${this.maxRetries} attempts: ${errMsg}`);
    }

    throw new Error('Failed to hash: Unknown error');
  }

  /**
   * Hash multiple preimages in parallel using the hash service's batch endpoint
   * This uses rayon on the Rust side for true parallel processing
   */
  async hashBatch(preimages: string[]): Promise<string[]> {
    if (preimages.length === 0) {
      return [];
    }

    let lastError: Error | null = null;

    // Longer timeout for batch operations (scales with batch size)
    // ~10-20ms per hash in batch, so 5000 hashes = ~100 seconds max
    const batchTimeout = Math.max(30000, preimages.length * 20);

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.axiosInstance.post('/hash-batch',
          { preimages },
          {
            timeout: batchTimeout,
            // Don't use keep-alive agent for large batch requests to avoid connection reuse issues
            httpAgent: new (require('http').Agent)({ keepAlive: false })
          }
        );
        return response.data.hashes;
      } catch (err: any) {
        lastError = err;

        // Don't retry on certain errors
        if (err.response?.status === 400 || err.response?.status === 404) {
          throw new Error(`Failed to batch hash: ${err.response.data?.error || err.message}`);
        }

        // Retry on connection issues, timeouts, or 503/408 (service unavailable/timeout)
        const isRetriable =
          err.code === 'ECONNREFUSED' ||
          err.code === 'ECONNRESET' ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'ECONNABORTED' ||
          err.message.includes('socket hang up') ||
          err.response?.status === 503 ||
          err.response?.status === 408; // Request Timeout

        if (!isRetriable || attempt === this.maxRetries - 1) {
          break;
        }

        // Exponential backoff with jitter
        const delay = this.retryDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        await this.sleep(delay);
      }
    }

    if (lastError) {
      const errMsg = (lastError as any).response?.data?.error || (lastError as any).message || 'Unknown error';
      throw new Error(`Failed to batch hash after ${this.maxRetries} attempts: ${errMsg}`);
    }

    throw new Error('Failed to batch hash: Unknown error');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get('/health');
      return response.data.status === 'ok';
    } catch {
      return false;
    }
  }

  async isRomReady(): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get('/health');
      const ready = response.data.status === 'ok' && response.data.romInitialized === true;
      return ready;
    } catch (err: any) {
      console.error(`[HashClient] Health check failed: ${err.message}`);
      return false;
    }
  }

  getRomInitialized(): boolean {
    return this.romInitialized;
  }

  /**
   * Kill all worker threads in the hash service
   * Call this when a new challenge comes in to stop workers processing old challenge
   */
  async killWorkers(): Promise<void> {
    try {
      console.log('[HashClient] Sending kill-workers request to hash service...');
      const response = await this.axiosInstance.post('/kill-workers', {}, {
        timeout: 5000,
        httpAgent: new http.Agent({ keepAlive: false }),
        headers: { 'Connection': 'close' }
      });
      console.log(`[HashClient] ✓ Workers killed: ${response.data.message || 'Success'}`);
    } catch (err: any) {
      // Don't throw error if endpoint doesn't exist yet (backwards compatibility)
      if (err.response?.status === 404) {
        console.log('[HashClient] Kill-workers endpoint not available (older hash service version)');
      } else {
        console.error(`[HashClient] Failed to kill workers: ${err.message}`);
      }
    }
  }

  destroy(): void {
    this.keepAliveAgent.destroy();
  }
}
