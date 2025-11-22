/**
 * Mining Orchestrator
 * Manages mining process, challenge polling, and worker coordination
 */

import axios from 'axios';
import { EventEmitter } from 'events';
import { ChallengeResponse, MiningStats, MiningEvent, Challenge, WorkerStats } from './types';
import { hashEngine } from '@/lib/hash/engine';
import { WalletManager, DerivedAddress } from '@/lib/wallet/manager';
import Logger from '@/lib/utils/logger';
import { matchesDifficulty, getDifficultyZeroBits } from './difficulty';
import { receiptsLogger } from '@/lib/storage/receipts-logger';
import { configManager } from '@/lib/storage/config-manager';
import { challengeHistoryLogger } from '@/lib/storage/challenge-history';
import { generateNonce } from './nonce';
import { buildPreimage } from './preimage';
import { devFeeManager } from '@/lib/devfee/manager';
import * as os from 'os';

interface SolutionTimestamp {
  timestamp: number;
}

class MiningOrchestrator extends EventEmitter {
  private isRunning = false;
  private currentChallengeId: string | null = null;
  private apiBase: string;
  private pollInterval = 2000; // 2 seconds - frequent polling to keep latest_submission fresh (it updates with every network solution)
  private pollTimer: NodeJS.Timeout | null = null;
  private walletManager: WalletManager | null = null;
  private isDevFeeMining = false; // Flag to prevent multiple simultaneous dev fee mining operations
  private addresses: DerivedAddress[] = [];
  private solutionsFound = 0;
  private startTime: number | null = null;
  private isMining = false;
  private currentChallenge: Challenge | null = null;
  private totalHashesComputed = 0;
  private lastHashRateUpdate = Date.now();
  private cpuUsage = 0;
  private lastCpuCheck: { idle: number; total: number } | null = null;
  private lastCpuCalculation = 0; // Timestamp of last CPU calculation
  private readonly CPU_UPDATE_INTERVAL = 10000; // Update CPU reading every 10 seconds
  private cpuReadings: number[] = []; // Store last N CPU readings for smoothing
  private readonly CPU_SMOOTHING_WINDOW = 5; // Number of readings to average
  private addressesProcessedCurrentChallenge = new Set<number>(); // Track which address indexes have processed current challenge
  private solutionTimestamps: SolutionTimestamp[] = []; // Track all solution timestamps for hourly/daily stats
  private workerThreads = 11; // Number of parallel mining threads
  private submittedSolutions = new Set<string>(); // Track submitted solution hashes to avoid duplicates
  private solvedAddressChallenges = new Map<string, Set<string>>(); // Map: address -> Set of solved challenge_ids
  private userSolutionsCount = 0; // Track non-dev-fee solutions for dev fee trigger
  private submittingAddresses = new Set<string>(); // Track addresses currently submitting solutions (address+challenge key)
  private pausedAddresses = new Set<string>(); // Track addresses that are paused while submission is in progress
  private workerStats = new Map<number, WorkerStats>(); // Track stats for each worker (workerId -> WorkerStats)
  private hourlyRestartTimer: NodeJS.Timeout | null = null; // Timer for hourly restart
  private watchdogTimer: NodeJS.Timeout | null = null; // Timer for watchdog monitoring
  private stoppedWorkers = new Set<number>(); // Track workers that should stop immediately
  private addressSubmissionFailures = new Map<string, number>(); // Track submission failures per address (address+challenge key)
  private customBatchSize: number | null = null; // Custom batch size override
  private workerGroupingMode: 'auto' | 'all-on-one' | 'grouped' = 'auto'; // Worker distribution strategy
  private workersPerAddress: number = 5; // Minimum workers per address (used in grouped mode)
  private currentProfileId: string = 'defensio'; // Track current profile ID
  private challengeValidityHours: number = 24; // How long challenges remain valid (from profile)
  private previousChallenge: Challenge | null = null; // Previous challenge for graceful handover
  private previousChallengeId: string | null = null; // Previous challenge ID
  private gracefulHandoverInProgress = false; // Flag to indicate workers are finishing old challenge
  private romReinitializationInProgress = false; // Flag to prevent multiple simultaneous ROM reinitializations

  constructor() {
    super();

    // Load API base URL and challenge validity from active profile
    try {
      const { profileManager } = require('@/lib/config/profile-manager');
      const profile = profileManager.getActiveProfile();
      this.apiBase = profile?.api?.baseUrl || 'https://mine.defensio.io/api';
      this.currentProfileId = profile?.id || 'defensio';
      this.challengeValidityHours = profile?.challenge?.validityHours || 24;
      console.log(`[Orchestrator] Using API: ${this.apiBase} (Profile: ${this.currentProfileId})`);
      console.log(`[Orchestrator] Challenge validity: ${this.challengeValidityHours} hours`);
    } catch (error) {
      // Fallback if profile system not initialized
      this.apiBase = 'https://mine.defensio.io/api';
      this.currentProfileId = 'defensio';
      this.challengeValidityHours = 24;
      console.warn('[Orchestrator] Profile manager not available, using default API');
    }

    // Load saved configuration from disk
    const savedConfig = configManager.loadConfig();
    this.workerThreads = savedConfig.workerThreads;
    this.customBatchSize = savedConfig.batchSize;
    this.workerGroupingMode = savedConfig.workerGroupingMode;
    this.workersPerAddress = savedConfig.workersPerAddress;
    console.log('[Orchestrator] Initialized with saved configuration:', savedConfig);
  }

  /**
   * Update orchestrator configuration dynamically
   */
  updateConfiguration(config: {
    workerThreads?: number;
    batchSize?: number;
    workerGroupingMode?: 'auto' | 'all-on-one' | 'grouped';
    workersPerAddress?: number;
  }): void {
    if (config.workerThreads !== undefined) {
      console.log(`[Orchestrator] Updating workerThreads: ${this.workerThreads} -> ${config.workerThreads}`);
      this.workerThreads = config.workerThreads;
    }
    if (config.batchSize !== undefined) {
      console.log(`[Orchestrator] Updating batchSize: ${this.customBatchSize || 'default'} -> ${config.batchSize}`);
      this.customBatchSize = config.batchSize;
    }
    if (config.workerGroupingMode !== undefined) {
      console.log(`[Orchestrator] Updating workerGroupingMode: ${this.workerGroupingMode} -> ${config.workerGroupingMode}`);
      this.workerGroupingMode = config.workerGroupingMode;
    }
    if (config.workersPerAddress !== undefined) {
      console.log(`[Orchestrator] Updating workersPerAddress: ${this.workersPerAddress} -> ${config.workersPerAddress}`);
      this.workersPerAddress = Math.max(1, config.workersPerAddress);
    }

    // Save updated configuration to disk
    configManager.saveConfig({
      workerThreads: this.workerThreads,
      batchSize: this.customBatchSize,
      workerGroupingMode: this.workerGroupingMode,
      workersPerAddress: this.workersPerAddress,
    });
  }

  /**
   * Get current configuration
   */
  getCurrentConfiguration(): {
    workerThreads: number;
    batchSize: number;
    workerGroupingMode: 'auto' | 'all-on-one' | 'grouped';
    workersPerAddress: number;
  } {
    return {
      workerThreads: this.workerThreads,
      batchSize: this.getBatchSize(),
      workerGroupingMode: this.workerGroupingMode,
      workersPerAddress: this.workersPerAddress,
    };
  }

  /**
   * Get current batch size (custom or default)
   */
  private getBatchSize(): number {
    return this.customBatchSize || 300; // Default BATCH_SIZE
  }

  /**
   * Estimate hashes needed based on difficulty
   * Uses the full difficulty mask, not just zero-bits counting
   */
  private estimateHashesNeeded(difficulty: string): number {
    // Convert difficulty hex to number
    // The ShadowHarvester check (hash | mask) === mask is the real constraint
    // Expected hashes = 2^32 / difficulty_value
    const diffValue = parseInt(difficulty.slice(0, 8), 16);
    if (diffValue === 0) {
      return 1; // Edge case
    }
    // Approximate expected hashes: 2^32 / difficulty
    return Math.floor(0x100000000 / diffValue);
  }

  /**
   * Determine minimum workers per address based on mode and difficulty
   */
  private getMinWorkersPerAddress(totalWorkers: number, difficulty: string): number {
    if (this.workerGroupingMode === 'grouped') {
      return this.workersPerAddress; // User-specified minimum
    }

    if (this.workerGroupingMode === 'all-on-one') {
      return totalWorkers; // All workers on first address
    }

    // Auto mode: Use balanced distribution for parallelization
    // Small systems (<=4 workers) use all workers on one address for simplicity
    // Larger systems distribute workers across multiple addresses

    if (totalWorkers <= 4) {
      return totalWorkers; // Small system - all on one
    }

    // For normal systems: use 3-5 workers per address for good balance
    // This maximizes parallelization while maintaining reasonable solving speed per address
    return Math.max(3, Math.min(5, Math.floor(totalWorkers / 4)));
  }

  /**
   * Distribute workers into groups with minimum worker guarantee
   * If we can't meet minimum for a new group, redistribute those workers to existing groups
   */
  private calculateWorkerGroups(
    addresses: DerivedAddress[],
    availableWorkers: number,
    difficulty: string
  ): Array<{ address: DerivedAddress; workerIds: number[] }> {

    const minWorkersPerAddress = this.getMinWorkersPerAddress(availableWorkers, difficulty);

    console.log(`[Orchestrator] ╔═══════════════════════════════════════════════════════════╗`);
    console.log(`[Orchestrator] ║ WORKER DISTRIBUTION CALCULATION                           ║`);
    console.log(`[Orchestrator] ╠═══════════════════════════════════════════════════════════╣`);
    console.log(`[Orchestrator] ║ Mode: ${this.workerGroupingMode.padEnd(48)} ║`);
    console.log(`[Orchestrator] ║ Available workers: ${availableWorkers.toString().padStart(2)}                                 ║`);
    console.log(`[Orchestrator] ║ Min per address: ${minWorkersPerAddress.toString().padStart(2)}                                   ║`);

    // Calculate how many full groups we can create
    const maxGroups = Math.floor(availableWorkers / minWorkersPerAddress);
    const actualGroupCount = Math.min(maxGroups, addresses.length);

    if (actualGroupCount === 0) {
      // Edge case: Not enough workers to meet minimum
      // Solution: Create 1 group with all available workers
      console.log(`[Orchestrator] ║ ⚠️  Only ${availableWorkers} workers (< min ${minWorkersPerAddress})                       ║`);
      console.log(`[Orchestrator] ║ Creating 1 group with all ${availableWorkers} workers                       ║`);
      console.log(`[Orchestrator] ╚═══════════════════════════════════════════════════════════╝`);

      return [{
        address: addresses[0],
        workerIds: Array.from({ length: availableWorkers }, (_, i) => i)
      }];
    }

    // Distribute workers evenly across groups
    const baseWorkersPerGroup = Math.floor(availableWorkers / actualGroupCount);
    const extraWorkers = availableWorkers % actualGroupCount;

    console.log(`[Orchestrator] ║ Groups to create: ${actualGroupCount.toString().padStart(2)}                                  ║`);
    console.log(`[Orchestrator] ║ Base workers per group: ${baseWorkersPerGroup.toString().padStart(2)}                           ║`);
    console.log(`[Orchestrator] ║ Extra workers to distribute: ${extraWorkers.toString().padStart(2)}                        ║`);
    console.log(`[Orchestrator] ╠═══════════════════════════════════════════════════════════╣`);

    const groups: Array<{ address: DerivedAddress; workerIds: number[] }> = [];
    let workerIdCounter = 0;

    for (let i = 0; i < actualGroupCount; i++) {
      // First 'extraWorkers' groups get 1 additional worker
      const workersForThisGroup = baseWorkersPerGroup + (i < extraWorkers ? 1 : 0);

      const workerIds = Array.from(
        { length: workersForThisGroup },
        (_, j) => workerIdCounter++
      );

      groups.push({
        address: addresses[i],
        workerIds
      });

      console.log(`[Orchestrator] ║ Group ${(i+1).toString().padStart(2)}: Address #${addresses[i].index.toString().padStart(3)} → ${workersForThisGroup.toString().padStart(2)} workers (${workerIds.join(',').padEnd(20).slice(0, 20)}) ║`);
    }

    console.log(`[Orchestrator] ╚═══════════════════════════════════════════════════════════╝`);

    return groups;
  }

  /**
   * Start mining with loaded wallet
   */
  async start(password: string): Promise<void> {
    if (this.isRunning) {
      console.log('[Orchestrator] Mining already running, returning current state');
      return; // Just return without error if already running
    }

    // Load wallet
    this.walletManager = new WalletManager();
    this.addresses = await this.walletManager.loadWallet(password);

    console.log('[Orchestrator] Loaded wallet with', this.addresses.length, 'addresses');

    // Load previously submitted solutions from receipts file
    this.loadSubmittedSolutions();

    // Register addresses that aren't registered yet
    await this.ensureAddressesRegistered();

    // Check if we already have 10 dev fee addresses in cache, otherwise fetch
    console.log('[Orchestrator] Checking dev fee address pool...');
    let devFeeReady = devFeeManager.hasValidAddressPool();

    if (devFeeReady) {
      console.log('[Orchestrator] ✓ Dev fee enabled with 10 addresses (loaded from cache)');
    } else {
      console.log('[Orchestrator] No cached addresses found, fetching 10 dev fee addresses from API...');
      devFeeReady = await devFeeManager.prefetchAddressPool();
      if (devFeeReady) {
        console.log('[Orchestrator] ✓ Dev fee enabled with 10 addresses (fetched from API)');
      } else {
        console.log('[Orchestrator] ✗ Dev fee DISABLED - failed to fetch 10 addresses');
      }
    }

    // Dev fee will be checked after each solution submission (not on startup)

    this.isRunning = true;
    this.startTime = Date.now();
    this.solutionsFound = 0;

    // Start polling
    this.pollLoop();

    // Schedule hourly restart to clean workers and reset state
    this.scheduleHourlyRestart(password);

    // Start watchdog monitor to detect stuck/idle workers
    this.startWatchdog();

    this.emit('status', {
      type: 'status',
      active: true,
      challengeId: this.currentChallengeId,
    } as MiningEvent);
  }

  /**
   * Stop mining
   */
  stop(): void {
    this.isRunning = false;
    this.isMining = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Clear hourly restart timer
    if (this.hourlyRestartTimer) {
      clearTimeout(this.hourlyRestartTimer);
      this.hourlyRestartTimer = null;
    }

    // Stop watchdog monitor
    this.stopWatchdog();

    this.emit('status', {
      type: 'status',
      active: false,
      challengeId: null,
    } as MiningEvent);
  }

  /**
   * Reinitialize the orchestrator - called when start button is clicked
   * This ensures fresh state and kicks off mining again
   */
  async reinitialize(password: string): Promise<void> {
    console.log('[Orchestrator] Reinitializing orchestrator...');

    // Stop current mining if running
    if (this.isRunning) {
      console.log('[Orchestrator] Stopping current mining session...');
      this.stop();
      await this.sleep(1000); // Give time for cleanup
    }

    // Reset state
    this.currentChallengeId = null;
    this.currentChallenge = null;
    this.isMining = false;
    this.addressesProcessedCurrentChallenge.clear();

    console.log('[Orchestrator] Reinitialization complete, starting fresh mining session...');

    // Start fresh
    await this.start(password);
  }

  /**
   * Calculate CPU usage percentage
   */
  private calculateCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;

    if (this.lastCpuCheck) {
      const idleDiff = idle - this.lastCpuCheck.idle;
      const totalDiff = total - this.lastCpuCheck.total;

      // Only calculate if there's meaningful difference (avoid division by zero or near-zero)
      if (totalDiff > 0) {
        const cpuPercentage = 100 - (100 * idleDiff / totalDiff);

        // Ensure value is valid (not NaN or Infinity) and within bounds
        if (isFinite(cpuPercentage)) {
          const validCpu = Math.max(0, Math.min(100, cpuPercentage));

          // Add to rolling window for smoothing
          this.cpuReadings.push(validCpu);

          // Keep only the last N readings
          if (this.cpuReadings.length > this.CPU_SMOOTHING_WINDOW) {
            this.cpuReadings.shift();
          }

          // Calculate smoothed average
          const sum = this.cpuReadings.reduce((acc, val) => acc + val, 0);
          this.cpuUsage = Math.round(sum / this.cpuReadings.length);
        }
        // If invalid, keep previous value (don't update)
      }
    } else {
      // First measurement - set to 0 as baseline
      this.cpuUsage = 0;
    }

    this.lastCpuCheck = { idle, total };
    return this.cpuUsage;
  }

  /**
   * Calculate solutions for time periods
   * Reads from receipts.jsonl to get accurate counts even after restart
   */
  private calculateTimePeriodSolutions(): {
    thisHour: number;
    previousHour: number;
    today: number;
    yesterday: number;
  } {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const currentHourStart = Math.floor(now / oneHour) * oneHour;
    const previousHourStart = currentHourStart - oneHour;

    // Get start of today and yesterday (midnight local time)
    const nowDate = new Date(now);
    const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);

    let thisHour = 0;
    let previousHour = 0;
    let today = 0;
    let yesterday = 0;

    // Read all receipts from file (filters out dev fees automatically)
    const allReceipts = receiptsLogger.readReceipts();
    const receipts = allReceipts.filter(r => !r.isDevFee);

    for (const receipt of receipts) {
      const ts = new Date(receipt.ts).getTime();

      // Count this hour
      if (ts >= currentHourStart) {
        thisHour++;
      }
      // Count previous hour
      else if (ts >= previousHourStart && ts < currentHourStart) {
        previousHour++;
      }

      // Count today
      if (ts >= todayStart) {
        today++;
      }
      // Count yesterday
      else if (ts >= yesterdayStart && ts < todayStart) {
        yesterday++;
      }
    }

    return { thisHour, previousHour, today, yesterday };
  }

  /**
   * Get current mining stats
   */
  getStats(): MiningStats {
    // Calculate hash rate
    const now = Date.now();
    const elapsedSeconds = (now - this.lastHashRateUpdate) / 1000;
    const hashRate = elapsedSeconds > 0 ? this.totalHashesComputed / elapsedSeconds : 0;

    // Update CPU usage - throttled to every 3 seconds to prevent flickering
    const timeSinceLastCpuCalc = now - this.lastCpuCalculation;
    if (timeSinceLastCpuCalc >= this.CPU_UPDATE_INTERVAL) {
      this.calculateCpuUsage();
      this.lastCpuCalculation = now;
    }
    // Otherwise, return cached cpuUsage value (no flicker!)

    // Calculate time period solutions
    const timePeriodSolutions = this.calculateTimePeriodSolutions();

    // Calculate unique addresses with receipts (no overhead - receipts already loaded)
    const allReceipts = receiptsLogger.readReceipts();
    const uniqueAddressesWithReceipts = new Set(
      allReceipts.filter(r => !r.isDevFee).map(r => r.address)
    ).size;

    return {
      active: this.isRunning,
      challengeId: this.currentChallengeId,
      solutionsFound: this.solutionsFound,
      registeredAddresses: this.addresses.filter(a => a.registered).length,
      totalAddresses: this.addresses.length,
      addressesWithReceipts: uniqueAddressesWithReceipts,
      hashRate,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      startTime: this.startTime,
      cpuUsage: this.cpuUsage,
      addressesProcessedCurrentChallenge: this.addressesProcessedCurrentChallenge.size,
      solutionsThisHour: timePeriodSolutions.thisHour,
      solutionsPreviousHour: timePeriodSolutions.previousHour,
      solutionsToday: timePeriodSolutions.today,
      solutionsYesterday: timePeriodSolutions.yesterday,
      workerThreads: this.workerThreads,
      config: this.getCurrentConfiguration(),
    };
  }

  /**
   * Get address data including solved status for current challenge
   */
  getAddressesData() {
    if (!this.isRunning || this.addresses.length === 0) {
      return null;
    }

    return {
      addresses: this.addresses,
      currentChallengeId: this.currentChallengeId,
      solvedAddressChallenges: this.solvedAddressChallenges,
    };
  }

  /**
   * Main polling loop
   */
  private async pollLoop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.pollAndMine();
    } catch (error: any) {
      Logger.error('mining', 'Poll error', error);
      this.emit('error', {
        type: 'error',
        message: error.message,
      } as MiningEvent);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.pollLoop(), this.pollInterval);
  }

  /**
   * Poll challenge and start mining if new challenge
   */
  private async pollAndMine(): Promise<void> {
    const challenge = await this.fetchChallenge();

    // Determine challenge status - handle both Midnight and Defensio formats
    // Midnight uses: { code: 'active' | 'before' | 'after', challenge: {...} }
    // Defensio uses: { challenge: {...}, starts_at: "...", next_challenge_starts_at: "..." } (no code field)
    const hasActiveChallenge = challenge.challenge && challenge.challenge.challenge_id;
    const isBeforeMining = challenge.code === 'before';
    const isAfterMining = challenge.code === 'after';
    // Active if explicitly 'active' OR if no code field but has valid challenge data
    const isActiveMining = challenge.code === 'active' || (!challenge.code && hasActiveChallenge);

    if (isBeforeMining) {
      console.log('[Orchestrator] Mining not started yet. Starts at:', challenge.starts_at);
      return;
    }

    if (isAfterMining) {
      console.log('[Orchestrator] Mining period ended');
      this.stop();
      return;
    }

    if (isActiveMining && challenge.challenge) {
      const challengeId = challenge.challenge.challenge_id;

      // Log challenge to history for future multi-challenge mining support
      challengeHistoryLogger.logChallenge(
        challenge.challenge,
        this.currentProfileId,
        this.challengeValidityHours
      );

      // New challenge detected
      if (challengeId !== this.currentChallengeId) {
        console.log('[Orchestrator] ========================================');
        console.log('[Orchestrator] NEW CHALLENGE DETECTED:', challengeId);
        console.log('[Orchestrator] Challenge data:', JSON.stringify(challenge.challenge, null, 2));
        console.log('[Orchestrator] ========================================');

        // Check if no_pre_mine changed (indicates new day - ROM must be reinitialized)
        const noPreMine = challenge.challenge.no_pre_mine;
        const currentNoPreMine = this.currentChallenge?.no_pre_mine;
        const noPreMineChanged = currentNoPreMine !== undefined && currentNoPreMine !== noPreMine;

        // GRACEFUL HANDOVER: Allow workers to finish current batch before switching
        // Workers can continue on old challenge if no_pre_mine is same (same ROM)
        if (this.currentChallengeId && this.currentChallenge) {
          console.log('[Orchestrator] 🔄 GRACEFUL HANDOVER: Workers will finish current batch');
          console.log(`[Orchestrator]    Old challenge: ${this.currentChallengeId}`);
          console.log(`[Orchestrator]    New challenge: ${challengeId}`);
          console.log(`[Orchestrator]    no_pre_mine changed: ${noPreMineChanged}`);

          // Store previous challenge for workers that are finishing up
          this.previousChallengeId = this.currentChallengeId;
          this.previousChallenge = JSON.parse(JSON.stringify(this.currentChallenge)); // Deep copy

          if (noPreMineChanged) {
            // Day changed - ROM will be different, must stop workers immediately
            console.log('[Orchestrator] ⚠️  no_pre_mine changed (new day) - workers CANNOT continue old challenge');
            console.log('[Orchestrator] 🛑 Stopping all workers for ROM reinitialization');

            // Stop mining (this will cause all workers to exit their loops)
            this.isMining = false;

            // Kill workers in the hash service
            try {
              console.log('[Orchestrator] Killing workers in hash service...');
              await hashEngine.killWorkers();
              console.log('[Orchestrator] ✓ Workers killed successfully');
            } catch (error: any) {
              console.error('[Orchestrator] Failed to kill workers:', error.message);
            }

            // Clear worker stats
            this.workerStats.clear();
            console.log('[Orchestrator] ✓ Worker stats cleared');

            // Reset state
            this.addressesProcessedCurrentChallenge.clear();
            this.pausedAddresses.clear();
            this.submittingAddresses.clear();
            console.log('[Orchestrator] ✓ State reset complete');

            // Wait a bit for workers to fully stop
            await this.sleep(1000);
          } else {
            // Same day - workers CAN finish their current batch and submit
            console.log('[Orchestrator] ✓ Same no_pre_mine (same day) - workers can finish current batch');
            console.log('[Orchestrator] ✓ Old workers will complete their batch and submit before exiting');
            console.log('[Orchestrator] ✓ New workers will start on new challenge in parallel');
            this.gracefulHandoverInProgress = true;

            // DON'T kill workers in hash service - let old workers finish naturally
            // But DO set isMining = false so startMining() can start new workers
            // Old workers will continue because isValidChallenge() allows previous challenge with same no_pre_mine
            this.isMining = false;

            // Clear processed addresses for new challenge
            this.addressesProcessedCurrentChallenge.clear();

            // Note: Don't clear workerStats - old workers are still tracked there
            // They'll update their status to 'idle' when they finish
          }
        }

        // Only reinitialize ROM if no_pre_mine changed (new day) or ROM not ready
        if (noPreMineChanged || !hashEngine.isRomReady()) {
          console.log('[Orchestrator] ROM initialization required');
          console.log(`[Orchestrator]   no_pre_mine: ${currentNoPreMine} -> ${noPreMine}`);
          console.log(`[Orchestrator]   Reason: ${noPreMineChanged ? 'no_pre_mine changed (new day)' : 'ROM not ready'}`);

          await hashEngine.initRom(noPreMine);

          // Wait for ROM to be ready
          const maxWait = 60000;
          const startWait = Date.now();

          while (!hashEngine.isRomReady() && (Date.now() - startWait) < maxWait) {
            await this.sleep(500);
          }

          if (!hashEngine.isRomReady()) {
            throw new Error('ROM initialization timeout');
          }

          console.log('[Orchestrator] ROM ready');
        } else {
          console.log('[Orchestrator] Skipping ROM reinitialization (same no_pre_mine, ROM already ready)');
          console.log(`[Orchestrator]   no_pre_mine: ${noPreMine} (unchanged)`);
        }

        // Update to new challenge
        this.currentChallengeId = challengeId;
        this.currentChallenge = challenge.challenge;

        // Load challenge state from receipts (restore progress, solutions count, etc.)
        this.loadChallengeState(challengeId);

        // Emit status
        this.emit('status', {
          type: 'status',
          active: true,
          challengeId,
        } as MiningEvent);

        // Restart mining for new challenge
        console.log('[Orchestrator] 🚀 Starting mining for new challenge...');

        // Dev fee is now handled in batch rotation - no special resume needed
        this.startMining();

        // Clear graceful handover flag after starting new challenge
        this.gracefulHandoverInProgress = false;
      } else {
        // Same challenge, but update dynamic fields (latest_submission, no_pre_mine_hour)
        // These change frequently as solutions are submitted across the network

        // Check if difficulty changed (happens hourly on no_pre_mine_hour updates)
        if (this.currentChallenge && challenge.challenge.difficulty !== this.currentChallenge.difficulty) {
          const oldDifficulty = this.currentChallenge.difficulty;
          const newDifficulty = challenge.challenge.difficulty;
          const oldZeroBits = getDifficultyZeroBits(oldDifficulty);
          const newZeroBits = getDifficultyZeroBits(newDifficulty);

          console.log('[Orchestrator] ⚠ DIFFICULTY CHANGED ⚠');
          console.log(`[Orchestrator] Old difficulty: ${oldDifficulty} (${oldZeroBits} zero bits)`);
          console.log(`[Orchestrator] New difficulty: ${newDifficulty} (${newZeroBits} zero bits)`);

          if (newZeroBits > oldZeroBits) {
            console.log('[Orchestrator] ⚠ Difficulty INCREASED - solutions in progress may be rejected!');
          } else {
            console.log('[Orchestrator] ✓ Difficulty DECREASED - solutions in progress remain valid');
          }
        }

        this.currentChallenge = challenge.challenge;
      }
    }
  }

  /**
   * Start mining loop for current challenge
   */
  private async startMining(): Promise<void> {
    if (this.isMining || !this.currentChallenge || !this.currentChallengeId) {
      return;
    }

    this.isMining = true;
    const logMsg = `Starting mining with ${this.workerThreads} parallel workers on ${this.addresses.filter(a => a.registered).length} addresses`;
    console.log(`[Orchestrator] ${logMsg}`);

    // Emit to UI log
    this.emit('status', {
      type: 'status',
      active: true,
      challengeId: this.currentChallengeId,
    } as MiningEvent);

    // Reset hash rate tracking
    this.totalHashesComputed = 0;
    this.lastHashRateUpdate = Date.now();

    const registeredAddresses = this.addresses.filter(a => a.registered);
    const currentChallengeId = this.currentChallengeId;

    console.log(`[Orchestrator] ╔═══════════════════════════════════════════════════════════╗`);
    console.log(`[Orchestrator] ║ ADDRESS FILTERING FOR MINING                              ║`);
    console.log(`[Orchestrator] ╠═══════════════════════════════════════════════════════════╣`);
    console.log(`[Orchestrator] ║ Total addresses loaded:        ${this.addresses.length.toString().padStart(3, ' ')}                       ║`);
    console.log(`[Orchestrator] ║ Registered addresses:          ${registeredAddresses.length.toString().padStart(3, ' ')}                       ║`);
    console.log(`[Orchestrator] ║ Challenge ID:                  ${currentChallengeId?.slice(0, 10)}...            ║`);
    console.log(`[Orchestrator] ╚═══════════════════════════════════════════════════════════╝`);

    // Filter out addresses that have already solved this challenge
    const addressesToMine = registeredAddresses.filter(addr => {
      const solvedChallenges = this.solvedAddressChallenges.get(addr.bech32);
      const alreadySolved = solvedChallenges && solvedChallenges.has(currentChallengeId!);

      if (alreadySolved) {
        console.log(`[Orchestrator]   → Address #${addr.index} already solved ${currentChallengeId} - SKIPPING`);
      }

      return !alreadySolved;
    });

    console.log(`[Orchestrator] ╔═══════════════════════════════════════════════════════════╗`);
    console.log(`[Orchestrator] ║ FILTERING RESULTS                                         ║`);
    console.log(`[Orchestrator] ╠═══════════════════════════════════════════════════════════╣`);
    console.log(`[Orchestrator] ║ Addresses to mine:             ${addressesToMine.length.toString().padStart(3, ' ')}                       ║`);
    console.log(`[Orchestrator] ║ Already solved this challenge: ${(registeredAddresses.length - addressesToMine.length).toString().padStart(3, ' ')}                       ║`);
    console.log(`[Orchestrator] ╚═══════════════════════════════════════════════════════════╝`);

    if (addressesToMine.length === 0) {
      console.log(`[Orchestrator] ⚠️  NO ADDRESSES TO MINE!`);
      console.log(`[Orchestrator]     - All ${registeredAddresses.length} registered addresses have already solved challenge ${currentChallengeId}`);
      console.log(`[Orchestrator]     - This could mean:`);
      console.log(`[Orchestrator]       1. All addresses successfully solved this challenge`);
      console.log(`[Orchestrator]       2. Receipts were loaded incorrectly`);
      console.log(`[Orchestrator]       3. Challenge state wasn't reset properly`);
      console.log(`[Orchestrator]     - Stopping mining until new challenge arrives`);
      this.isMining = false;
      return;
    }

    console.log(`[Orchestrator] Mining for ${addressesToMine.length} addresses (${registeredAddresses.length - addressesToMine.length} already solved)`);

    // Calculate available workers (use all workers - no permanent reservation)
    const availableWorkers = this.workerThreads;
    const MAX_SUBMISSION_FAILURES = 6;

    // Mine in batches: continuously mine groups of addresses until challenge changes
    // After each batch, check if dev fee is needed
    // Loop continuously - when we reach the end of addresses, start over
    let currentAddressPointer = 0; // Points to actual address in addressesToMine, not filtered array

    while (this.isRunning && this.isMining && this.currentChallengeId === currentChallengeId) {
      // Refilter addresses to exclude newly solved ones
      const unsolved = addressesToMine.filter(addr => {
        const solvedChallenges = this.solvedAddressChallenges.get(addr.bech32);
        return !solvedChallenges || !solvedChallenges.has(currentChallengeId!);
      });

      if (unsolved.length === 0) {
        console.log(`[Orchestrator] ✓ All ${addressesToMine.length} addresses solved for challenge ${currentChallengeId}`);
        console.log(`[Orchestrator] Waiting for new challenge...`);
        this.isMining = false;
        return;
      }

      // Calculate how many addresses we can mine in parallel based on worker grouping
      const minWorkersPerAddress = this.getMinWorkersPerAddress(availableWorkers, this.currentChallenge!.difficulty);
      const maxGroups = Math.floor(availableWorkers / minWorkersPerAddress);
      const batchSize = Math.max(1, maxGroups); // At least 1 group

      // Collect next batch of unsolved addresses from addressesToMine starting at currentAddressPointer
      const batchAddresses: DerivedAddress[] = [];
      let checked = 0;

      // CHECK IF DEV FEE IS DUE - pass batchSize to account for in-flight workers
      // This prevents overshooting (e.g., 12 solutions + 20 workers = 32 before next check)
      if (this.shouldMineDevFeeNow(batchSize)) {
        const devFeeAddr = await this.getDevFeeAddressForBatch();
        if (devFeeAddr) {
          batchAddresses.push(devFeeAddr);
          this.isDevFeeMining = true; // Mark as mining to prevent duplicate adds
          console.log(`[Orchestrator] 💰 Dev fee address added to batch rotation`);
        }
      }

      // Add user addresses to fill the rest of the batch
      for (let i = currentAddressPointer; i < addressesToMine.length && batchAddresses.length < batchSize; i++) {
        const addr = addressesToMine[i];
        const solvedChallenges = this.solvedAddressChallenges.get(addr.bech32);
        const isSolved = solvedChallenges && solvedChallenges.has(currentChallengeId!);

        if (!isSolved) {
          batchAddresses.push(addr);
        }
        checked++;
      }

      // If we didn't get a full batch and haven't checked all addresses, we reached the end
      if (batchAddresses.length < batchSize && currentAddressPointer + checked >= addressesToMine.length) {
        console.log(`[Orchestrator] 🔄 Reached end of address list, looping back to beginning`);
        console.log(`[Orchestrator]    ${unsolved.length} addresses still unsolved, continuing...`);
        currentAddressPointer = 0;
        continue; // Restart loop to collect batch from beginning
      }

      if (batchAddresses.length === 0) {
        // All remaining addresses solved, loop back
        console.log(`[Orchestrator] 🔄 All remaining addresses solved, looping back to beginning`);
        currentAddressPointer = 0;
        continue;
      }

      console.log(`[Orchestrator] ╔═══════════════════════════════════════════════════════════╗`);
      console.log(`[Orchestrator] ║ MINING BATCH                                              ║`);
      console.log(`[Orchestrator] ║ Unsolved: ${unsolved.length} addresses                                     ║`);
      console.log(`[Orchestrator] ║ Batch size: ${batchAddresses.length} addresses                                  ║`);
      console.log(`[Orchestrator] ╚═══════════════════════════════════════════════════════════╝`);

      // Calculate worker groups for this batch
      const groups = this.calculateWorkerGroups(
        batchAddresses,
        availableWorkers,
        this.currentChallenge!.difficulty
      );

      // Clear stopped workers set for this batch (fresh start)
      this.stoppedWorkers.clear();

      // Mine all groups in this batch in parallel
      const groupPromises = groups.map(async (group) => {
        if (!this.isRunning || !this.isMining || this.currentChallengeId !== currentChallengeId) {
          return;
        }

        console.log(`[Orchestrator] ========================================`);
        console.log(`[Orchestrator] Group mining address ${group.address.index}`);
        console.log(`[Orchestrator] Address: ${group.address.bech32.slice(0, 20)}...`);
        console.log(`[Orchestrator] Workers: ${group.workerIds.length} (IDs: ${group.workerIds.join(',')})`);
        console.log(`[Orchestrator] Max allowed failures: ${MAX_SUBMISSION_FAILURES}`);
        console.log(`[Orchestrator] ========================================`);

        // Detect if this is a dev fee address (index === -1)
        const isDevFee = group.address.index === -1;

        // Launch workers for this address
        const workerPromises = group.workerIds.map(workerId =>
          this.mineForAddress(group.address, isDevFee, workerId, MAX_SUBMISSION_FAILURES)
        );

        // Wait for all workers in this group to complete
        await Promise.all(workerPromises);

        // Check if address was solved
        const solvedChallenges = this.solvedAddressChallenges.get(group.address.bech32);
        const addressSolved = solvedChallenges?.has(currentChallengeId!) || false;

        if (addressSolved) {
          const prefix = isDevFee ? '[DEV FEE]' : '';
          console.log(`[Orchestrator] ${prefix} ✓ Address ${group.address.index} SOLVED!`);
        } else {
          const prefix = isDevFee ? '[DEV FEE]' : '';
          console.log(`[Orchestrator] ${prefix} ✗ Address ${group.address.index} FAILED after max attempts`);
        }

        // Reset dev fee mining flag if this was a dev fee address
        if (isDevFee) {
          this.isDevFeeMining = false;
          console.log(`[Orchestrator] [DEV FEE] Dev fee mining completed, flag reset`);
        }
      });

      // Wait for all groups in this batch to complete
      await Promise.all(groupPromises);

      console.log(`[Orchestrator] Batch complete.`);

      // Dev fee is handled in batch rotation alongside user addresses
      // No separate parallel mining needed - keeps all workers busy

      // Move pointer forward by number of addresses checked (solved + unsolved)
      currentAddressPointer += checked;
    }

    // Only reach here if mining was stopped or challenge changed
    console.log(`[Orchestrator] Mining loop exited`);
    console.log(`[Orchestrator]   isRunning: ${this.isRunning}`);
    console.log(`[Orchestrator]   isMining: ${this.isMining}`);
    console.log(`[Orchestrator]   currentChallengeId: ${this.currentChallengeId}`);

    // Don't set isMining = false here - it will be set by caller after dev fee (if needed)
  }

  /**
   * Check if we should mine dev fee now (ready to be added to batch)
   * @param batchSize - The number of addresses that will be mined in this batch (to account for in-flight)
   */
  private shouldMineDevFeeNow(batchSize: number = 1): boolean {
    // Only check if dev fee is enabled
    if (!devFeeManager.isEnabled() || !devFeeManager.hasValidAddressPool()) {
      return false;
    }

    // Check if dev fee is already mining
    if (this.isDevFeeMining) {
      return false;
    }

    // Dev fee ratio: 1 in 15 solutions goes to dev (14 user, 1 dev)
    // We check GLOBAL receipts (across all challenges) since low-performance systems
    // might take multiple challenges to accumulate 14 user solutions
    const ratio = devFeeManager.getRatio(); // 15
    const userSolutionsNeeded = ratio - 1; // 14 user solutions before dev fee

    // Get recent receipts (enough to check the pattern)
    const lastReceipts = receiptsLogger.getRecentReceipts(ratio);
    const hasDevFeeInLastN = lastReceipts.some(r => r.isDevFee);
    const userSolutionsSinceLastDevFee = lastReceipts.filter(r => !r.isDevFee).length;

    // If there's already a dev fee in the last N receipts, we don't need another yet
    if (hasDevFeeInLastN) {
      return false;
    }

    // Account for in-flight workers: if current user solutions + batch size would exceed threshold,
    // we should add dev fee to this batch to prevent overshooting
    // Example: 12 user solutions, batch of 20 = could end up at 32 before next check
    // So if userSolutions + batchSize > threshold, add dev fee now
    const wouldOvershootWithBatch = (userSolutionsSinceLastDevFee + batchSize) > userSolutionsNeeded;

    // Trigger dev fee if:
    // 1. We already have enough user solutions (>= 14), OR
    // 2. This batch would overshoot the threshold
    return userSolutionsSinceLastDevFee >= userSolutionsNeeded || wouldOvershootWithBatch;
  }

  /**
   * Get dev fee address object for batch rotation
   * Returns null if dev fee cannot be obtained or is already solved
   */
  private async getDevFeeAddressForBatch(): Promise<DerivedAddress | null> {
    if (!this.currentChallengeId || !this.currentChallenge) {
      return null;
    }

    // Fetch dev fee address
    let devFeeAddress: string;
    try {
      devFeeAddress = await devFeeManager.getDevFeeAddress(this.currentChallengeId);
    } catch (error: any) {
      console.error(`[Orchestrator] [DEV FEE] ✗ Failed to get dev fee address: ${error.message}`);
      return null;
    }

    // Validate address format
    if (!devFeeAddress || (!devFeeAddress.startsWith('addr1') && !devFeeAddress.startsWith('tnight1'))) {
      console.error(`[Orchestrator] [DEV FEE] ✗ Invalid address format: ${devFeeAddress}`);
      return null;
    }

    // Check if already solved
    const solvedChallenges = this.solvedAddressChallenges.get(devFeeAddress);
    if (solvedChallenges && solvedChallenges.has(this.currentChallengeId)) {
      console.log(`[Orchestrator] [DEV FEE] Address already solved current challenge, skipping...`);
      return null;
    }

    console.log(`[Orchestrator] [DEV FEE] 💰 Adding dev fee address to batch: ${devFeeAddress}`);

    // Create dev fee address object
    return {
      index: -1,
      bech32: devFeeAddress,
      publicKeyHex: '',
      registered: true,
    };
  }

  /**
   * Mine dev fee if needed (called after all user groups complete)
   * DEPRECATED: Dev fee is now handled in batch rotation, not as separate operation
   */
  private async mineDevFeeIfNeeded(): Promise<void> {
    if (!this.currentChallengeId || !this.currentChallenge) {
      return;
    }

    this.isDevFeeMining = true;

    try {
      console.log(`[Orchestrator] [DEV FEE] Mining dev fee with full worker allocation...`);

      // Fetch dev fee address
      let devFeeAddress: string;
      try {
        devFeeAddress = await devFeeManager.getDevFeeAddress(this.currentChallengeId);
      } catch (error: any) {
        console.error(`[Orchestrator] [DEV FEE] ✗ Failed to get dev fee address: ${error.message}`);
        return;
      }

      // Validate address format
      if (!devFeeAddress || (!devFeeAddress.startsWith('addr1') && !devFeeAddress.startsWith('tnight1'))) {
        console.error(`[Orchestrator] [DEV FEE] ✗ Invalid address format: ${devFeeAddress}`);
        return;
      }

      // Check if already solved
      const solvedChallenges = this.solvedAddressChallenges.get(devFeeAddress);
      if (solvedChallenges && solvedChallenges.has(this.currentChallengeId)) {
        console.log(`[Orchestrator] [DEV FEE] Address already solved current challenge, skipping...`);
        return;
      }

      console.log(`[Orchestrator] [DEV FEE] Mining for address: ${devFeeAddress}`);

      // Create dev fee address object
      const devFeeAddr: DerivedAddress = {
        index: -1,
        bech32: devFeeAddress,
        publicKeyHex: '',
        registered: true,
      };

      // Use ALL workers for dev fee (no conflicts, all user groups are done)
      // This ensures no idle workers - all 18 workers mine dev fee for faster completion
      const devFeeWorkerCount = this.workerThreads;

      const devFeeWorkerIds: number[] = [];
      for (let i = 0; i < devFeeWorkerCount; i++) {
        devFeeWorkerIds.push(i);
      }

      console.log(`[Orchestrator] [DEV FEE] Using ${devFeeWorkerCount} workers (IDs: ${devFeeWorkerIds.join(',')}) for dev fee`);

      // Track if solution was found before mining
      const devFeeAddressBefore = devFeeAddress;
      const challengeIdBefore = this.currentChallengeId;
      const solvedBefore = this.solvedAddressChallenges.get(devFeeAddressBefore)?.has(challengeIdBefore) || false;

      // Launch workers for dev fee
      const workers = devFeeWorkerIds.map(workerId =>
        this.mineForAddress(devFeeAddr, true, workerId, 6)
      );

      await Promise.all(workers);

      // Check if solution was actually found (marked as solved)
      const solvedAfter = this.solvedAddressChallenges.get(devFeeAddressBefore)?.has(challengeIdBefore) || false;
      const solutionFound = !solvedBefore && solvedAfter;

      if (solutionFound) {
        console.log(`[Orchestrator] [DEV FEE] ✓ Dev fee solution mined successfully`);
      } else {
        console.log(`[Orchestrator] [DEV FEE] ⏸ Dev fee mining exited without finding solution`);
      }

    } catch (error: any) {
      console.error(`[Orchestrator] [DEV FEE] ✗ Failed:`, error.message);
    } finally {
      this.isDevFeeMining = false;
    }
  }

  /**
   * Mine for a specific address
   * Note: This should only be called for address+challenge combinations that haven't been solved yet
   * @param addr - The address to mine for
   * @param isDevFee - Whether this is a dev fee mining operation (default: false)
   * @param workerId - Unique worker ID (0-9) to ensure different nonce generation per worker (default: 0)
   * @param maxFailures - Maximum number of submission failures allowed for this address (default: 10)
   */
  private async mineForAddress(
    addr: DerivedAddress,
    isDevFee: boolean = false,
    workerId: number = 0,
    maxFailures: number = 10,
    specificChallengeId?: string, // Allow mining a specific challenge (for graceful handover)
    specificChallenge?: Challenge
  ): Promise<void> {
    // Use specific challenge if provided, otherwise use current
    const challengeToUse = specificChallenge || this.currentChallenge;
    const challengeIdToUse = specificChallengeId || this.currentChallengeId;

    if (!challengeToUse || !challengeIdToUse) return;

    // Note: Removed currentMiningAddress check - parallel groups now mine different addresses simultaneously
    // Each worker is assigned to a specific address via group allocation

    // Capture challenge details at START to prevent race conditions
    // CRITICAL: Make a DEEP COPY of the challenge object to prevent the polling loop
    // from updating our captured challenge data while we're mining
    const challengeId = challengeIdToUse;
    const challenge = JSON.parse(JSON.stringify(challengeToUse)); // Deep copy to freeze challenge data
    const difficulty = challenge.difficulty;

    // ROM should already be ready from pollAndMine - quick check only
    if (!hashEngine.isRomReady()) {
      console.error(`[Orchestrator] ROM not ready for address ${addr.index}`);
      return;
    }

    // Mark this address as having processed the current challenge
    this.addressesProcessedCurrentChallenge.add(addr.index);

    // Initialize worker stats
    const workerStartTime = Date.now();
    this.workerStats.set(workerId, {
      workerId,
      addressIndex: addr.index,
      address: addr.bech32,
      hashesComputed: 0,
      hashRate: 0,
      solutionsFound: 0,
      startTime: workerStartTime,
      lastUpdateTime: workerStartTime,
      status: 'mining',
      currentChallenge: challengeId,
    });

    // Log difficulty for debugging
    const requiredZeroBits = getDifficultyZeroBits(difficulty);
    const startMsg = `Worker ${workerId} for Address ${addr.index}: Starting to mine (requires ${requiredZeroBits} leading zero bits)`;
    console.log(`[Orchestrator] ${startMsg}`);

    // Emit mining start event
    this.emit('mining_start', {
      type: 'mining_start',
      address: addr.bech32,
      addressIndex: addr.index,
      challengeId,
    } as MiningEvent);

    const BATCH_SIZE = this.getBatchSize(); // Use dynamic batch size (custom or default 300)
    const PROGRESS_INTERVAL = 1; // Emit progress every batch for updates
    let hashCount = 0;
    let batchCounter = 0;
    let lastProgressTime = Date.now();

    // Sequential nonce range for this worker (like midnight-scavenger-bot)
    const NONCE_RANGE_SIZE = 1_000_000_000; // 1 billion per worker
    const nonceStart = workerId * NONCE_RANGE_SIZE;
    const nonceEnd = nonceStart + NONCE_RANGE_SIZE;
    let currentNonce = nonceStart;

    // Mine continuously with sequential nonces using BATCH processing
    // Check if challenge is valid (current OR graceful handover with same no_pre_mine)
    const isValidChallenge = () => {
      if (challengeId === this.currentChallengeId) return true;
      // Allow graceful handover: previous challenge with same no_pre_mine
      if (this.previousChallengeId === challengeId &&
          this.previousChallenge?.no_pre_mine === this.currentChallenge?.no_pre_mine) {
        return true;
      }
      return false;
    };

    while (this.isRunning && this.isMining && isValidChallenge() && currentNonce < nonceEnd) {
      // Check if max submission failures reached for this address
      const submissionKey = `${addr.bech32}:${challengeId}`;
      const failureCount = this.addressSubmissionFailures.get(submissionKey) || 0;
      if (failureCount >= maxFailures) {
        console.log(`[Orchestrator] Worker ${workerId}: Max failures (${maxFailures}) reached for address ${addr.index}, stopping`);
        return;
      }

      // Check if address is already solved
      const solvedChallenges = this.solvedAddressChallenges.get(addr.bech32);
      if (solvedChallenges?.has(challengeId)) {
        console.log(`[Orchestrator] Worker ${workerId}: Address ${addr.index} already solved, stopping`);
        return;
      }

      // Check if this worker should stop immediately (another worker found solution)
      if (this.stoppedWorkers.has(workerId)) {
        console.log(`[Orchestrator] Worker ${workerId}: Stopped by solution from another worker`);
        // Update worker status to idle
        const workerData = this.workerStats.get(workerId);
        if (workerData) {
          workerData.status = 'idle';
          // Emit final worker update
          this.emit('worker_update', {
            type: 'worker_update',
            workerId,
            addressIndex: addr.index,
            address: addr.bech32,
            hashesComputed: workerData.hashesComputed,
            hashRate: 0,
            solutionsFound: workerData.solutionsFound,
            startTime: workerData.startTime,
            status: 'idle',
            currentChallenge: challengeId,
          } as MiningEvent);
        }
        return;
      }

      // Pause this worker if address is being submitted by another worker
      const pauseKey = `${addr.bech32}:${challengeId}`;
      if (this.pausedAddresses.has(pauseKey)) {
        // Wait a bit and check again
        await this.sleep(20);
        continue;
      }

      batchCounter++;

      // Generate batch of sequential nonces and preimages (like midnight-scavenger-bot)
      const batchData: Array<{ nonce: string; preimage: string }> = [];
      for (let i = 0; i < BATCH_SIZE && (currentNonce + i) < nonceEnd; i++) {
        // Check if this worker should stop immediately
        if (this.stoppedWorkers.has(workerId)) {
          console.log(`[Orchestrator] Worker ${workerId}: Stopped during batch generation (another worker found solution)`);
          return;
        }

        if (!this.isRunning || !this.isMining || !isValidChallenge()) {
          break;
        }

        // Check if paused during batch generation
        if (this.pausedAddresses.has(pauseKey)) {
          break;
        }

        const nonceNum = currentNonce + i;
        const nonceHex = nonceNum.toString(16).padStart(16, '0'); // Sequential nonce
        const preimage = buildPreimage(
          nonceHex,
          addr.bech32,
          challenge, // Use captured challenge to prevent race condition
          hashCount === 0 && i === 0 // Debug first hash
        );

        batchData.push({ nonce: nonceHex, preimage });
      }

      // Advance nonce counter for next batch
      currentNonce += batchData.length;

      if (batchData.length === 0) break;

      try {
        // Send entire batch to Rust service for PARALLEL processing
        const preimages = batchData.map(d => d.preimage);
        const hashes = await hashEngine.hashBatchAsync(preimages);

        // Check if challenge is still current OR if graceful handover allows completion
        const isChallengeStillCurrent = challengeId === this.currentChallengeId;
        const canContinueWithOldChallenge = !isChallengeStillCurrent &&
          this.previousChallengeId === challengeId &&
          this.previousChallenge?.no_pre_mine === this.currentChallenge?.no_pre_mine;

        if (!isChallengeStillCurrent && !canContinueWithOldChallenge) {
          console.log(`[Orchestrator] Worker ${workerId}: Challenge no longer valid during hash computation`);
          console.log(`[Orchestrator]   Worker challenge: ${challengeId.slice(0, 8)}...`);
          console.log(`[Orchestrator]   Current: ${this.currentChallengeId?.slice(0, 8) || 'none'}`);
          console.log(`[Orchestrator]   Discarding batch and stopping worker`);
          return; // Stop mining for this address, challenge is too old
        }

        if (canContinueWithOldChallenge) {
          console.log(`[Orchestrator] Worker ${workerId}: Graceful handover - continuing with old challenge ${challengeId.slice(0, 8)}...`);
        }

        this.totalHashesComputed += hashes.length;
        hashCount += hashes.length;

        // Log first hash for debugging (only once per address)
        if (hashCount === hashes.length) {
          console.log(`[Orchestrator] Sample hash for address ${addr.index}:`, hashes[0].slice(0, 16) + '...');
          console.log(`[Orchestrator] Target difficulty:                     ${difficulty.slice(0, 16)}...`);
          console.log(`[Orchestrator] Preimage (first 120 chars):`, batchData[0].preimage.slice(0, 120));
          const meetsTarget = matchesDifficulty(hashes[0], difficulty);
          console.log(`[Orchestrator] Hash meets difficulty? ${meetsTarget}`);
        }

        // Check all hashes for solutions
        for (let i = 0; i < hashes.length; i++) {
          const hash = hashes[i];
          const { nonce, preimage } = batchData[i];

          if (matchesDifficulty(hash, difficulty)) {
            // Check if we already submitted this exact hash
            if (this.submittedSolutions.has(hash)) {
              console.log('[Orchestrator] Duplicate solution found (already submitted), skipping:', hash.slice(0, 16) + '...');
              continue;
            }

            // Check if another worker is already submitting for this address+challenge
            const submissionKey = `${addr.bech32}:${challengeId}`;
            if (this.submittingAddresses.has(submissionKey)) {
              console.log(`[Orchestrator] Worker ${workerId}: Another worker is already submitting for this address, stopping this worker`);
              return; // Exit this worker - another worker is handling submission
            }

            // Mark as submitting to prevent other workers from submitting
            this.submittingAddresses.add(submissionKey);

            // IMMEDIATELY stop all other workers MINING THE SAME ADDRESS to save CPU
            // With worker grouping, only stop workers on the SAME ADDRESS, not all workers
            console.log(`[Orchestrator] Worker ${workerId}: Solution found! Stopping other workers on Address #${addr.index}`);

            // Find all workers mining the same address and stop them
            for (const [otherWorkerId, stats] of this.workerStats.entries()) {
              if (otherWorkerId !== workerId &&
                  stats.addressIndex === addr.index &&
                  stats.status === 'mining') {
                this.stoppedWorkers.add(otherWorkerId);
                console.log(`[Orchestrator] Worker ${workerId}: Stopping Worker ${otherWorkerId} (also on Address #${addr.index})`);
              }
            }

            // PAUSE all workers for this address while we submit
            this.pausedAddresses.add(submissionKey);
            console.log(`[Orchestrator] Worker ${workerId}: Pausing all workers for this address while submitting`);

            // Update worker status to submitting
            const workerData = this.workerStats.get(workerId);
            if (workerData) {
              workerData.status = 'submitting';
              workerData.solutionsFound++;
            }

            // Solution found!
            console.log('[Orchestrator] ========== SOLUTION FOUND ==========');
            console.log('[Orchestrator] Worker ID:', workerId);
            console.log('[Orchestrator] Address:', addr.bech32);
            console.log('[Orchestrator] Nonce:', nonce);
            console.log('[Orchestrator] Challenge ID (captured):', challengeId);
            console.log('[Orchestrator] Challenge ID (current):', this.currentChallengeId);
            console.log('[Orchestrator] Difficulty (captured):', difficulty);
            console.log('[Orchestrator] Difficulty (current):', this.currentChallenge?.difficulty);
            console.log('[Orchestrator] Required zero bits:', getDifficultyZeroBits(difficulty));
            console.log('[Orchestrator] Hash:', hash.slice(0, 32) + '...');
            console.log('[Orchestrator] Full hash:', hash);
            console.log('[Orchestrator] Full preimage:', preimage);
            console.log('[Orchestrator] ====================================');

            // Mark as submitted before submitting to avoid race conditions
            this.submittedSolutions.add(hash);

            // DON'T mark as solved yet - only mark after successful submission
            // This allows retry if submission fails

            // Emit solution submit event
            this.emit('solution_submit', {
              type: 'solution_submit',
              address: addr.bech32,
              addressIndex: addr.index,
              challengeId,
              nonce,
              preimage: preimage.slice(0, 50) + '...',
            } as MiningEvent);

            // CRITICAL: Double-check challenge is still valid OR graceful handover allows submission
            const isStillCurrentChallenge = challengeId === this.currentChallengeId;
            const canSubmitOldChallenge = !isStillCurrentChallenge &&
              this.previousChallengeId === challengeId &&
              this.previousChallenge?.no_pre_mine === this.currentChallenge?.no_pre_mine;

            if (!isStillCurrentChallenge && !canSubmitOldChallenge) {
              console.log(`[Orchestrator] Worker ${workerId}: Challenge no longer valid (${challengeId.slice(0, 8)}... not current), discarding solution`);
              console.log(`[Orchestrator]   Current: ${this.currentChallengeId?.slice(0, 8) || 'none'}`);
              this.pausedAddresses.delete(submissionKey);
              this.submittingAddresses.delete(submissionKey);
              return; // Don't submit solution for invalidated challenge
            }

            if (canSubmitOldChallenge) {
              console.log(`[Orchestrator] Worker ${workerId}: 🔄 GRACEFUL HANDOVER - Submitting solution for OLD challenge ${challengeId.slice(0, 8)}...`);
              console.log(`[Orchestrator]   Same no_pre_mine allows submission after challenge changed`);
            }

            console.log(`[Orchestrator] Worker ${workerId}: Captured challenge data during mining:`);
            console.log(`[Orchestrator]   latest_submission: ${challenge.latest_submission}`);
            console.log(`[Orchestrator]   no_pre_mine_hour: ${challenge.no_pre_mine_hour}`);
            console.log(`[Orchestrator]   difficulty: ${challenge.difficulty}`);

            // CRITICAL VALIDATION: Verify the server will compute the SAME hash we did
            // Server rebuilds preimage from nonce using ITS challenge data, then validates
            // If server's challenge data differs from ours, it computes a DIFFERENT hash!
            console.log(`[Orchestrator] Worker ${workerId}: Validating solution will pass server checks...`);

            // Use appropriate challenge for validation:
            // - If submitting for current challenge, use currentChallenge
            // - If submitting for old challenge (graceful handover), use the captured challenge data
            //   since the server will use the old challenge's data for that challengeId
            const validationChallenge = canSubmitOldChallenge ? challenge : this.currentChallenge;

            if (canSubmitOldChallenge) {
              console.log(`[Orchestrator] Worker ${workerId}: Using captured challenge data for validation (old challenge submission)`);
            }

            if (validationChallenge) {
              console.log(`[Orchestrator] Worker ${workerId}: Current challenge data (what server has):`);
              console.log(`[Orchestrator]   latest_submission: ${validationChallenge.latest_submission}`);
              console.log(`[Orchestrator]   no_pre_mine_hour: ${validationChallenge.no_pre_mine_hour}`);
              console.log(`[Orchestrator]   difficulty: ${validationChallenge.difficulty}`);

              // Check if challenge data changed (excluding difficulty which is checked separately)
              const dataChanged =
                challenge.latest_submission !== validationChallenge.latest_submission ||
                challenge.no_pre_mine_hour !== validationChallenge.no_pre_mine_hour ||
                challenge.no_pre_mine !== validationChallenge.no_pre_mine;

              if (dataChanged) {
                console.log(`[Orchestrator] Worker ${workerId}: ⚠️  Challenge data CHANGED since mining!`);
                console.log(`[Orchestrator]   Recomputing hash with current challenge data to verify server will accept...`);

                // Rebuild preimage with validation challenge data (what server will use)
                const serverPreimage = buildPreimage(nonce, addr.bech32, validationChallenge, false);

                // Compute what hash the SERVER will get
                const serverHash = await hashEngine.hashBatchAsync([serverPreimage]);
                const serverHashHex = serverHash[0];

                console.log(`[Orchestrator]   Our hash:     ${hash.slice(0, 32)}...`);
                console.log(`[Orchestrator]   Server hash:  ${serverHashHex.slice(0, 32)}...`);

                // Check if server's hash will meet difficulty
                const serverHashValid = matchesDifficulty(serverHashHex, validationChallenge.difficulty);
                console.log(`[Orchestrator]   Server hash meets difficulty? ${serverHashValid}`);

                if (!serverHashValid) {
                  console.log(`[Orchestrator] Worker ${workerId}: ✗ Server will REJECT this solution!`);
                  console.log(`[Orchestrator]   Our hash met difficulty but server's recomputed hash does NOT`);
                  console.log(`[Orchestrator]   This is why we get "Solution does not meet difficulty" errors!`);
                  console.log(`[Orchestrator]   Discarding solution to avoid wasting API call and stopping workers`);

                  // Clean up and continue mining
                  this.pausedAddresses.delete(submissionKey);
                  this.submittingAddresses.delete(submissionKey);
                  continue; // Don't submit, keep mining
                } else {
                  console.log(`[Orchestrator] Worker ${workerId}: ✓ Server hash WILL be valid, safe to submit`);
                }
              } else {
                console.log(`[Orchestrator] Worker ${workerId}: ✓ Challenge data unchanged, hash will be identical on server`);
              }
            }

            // Submit immediately with the challenge data we used during mining
            // Like midnight-scavenger-bot: no fresh fetch, no recomputation, just submit
            console.log(`[Orchestrator] Worker ${workerId}: Submitting solution to API...`);

            // CRITICAL: Check if difficulty changed during mining
            // If difficulty increased (more zero bits required), our solution may no longer be valid
            // Use validationChallenge (either current or previous) for comparison
            if (validationChallenge && validationChallenge.difficulty !== difficulty) {
              const currentDifficulty = validationChallenge.difficulty;
              const capturedZeroBits = getDifficultyZeroBits(difficulty);
              const currentZeroBits = getDifficultyZeroBits(currentDifficulty);

              console.log(`[Orchestrator] Worker ${workerId}: Difficulty changed during mining!`);
              console.log(`[Orchestrator]   Captured difficulty: ${difficulty} (${capturedZeroBits} zero bits)`);
              console.log(`[Orchestrator]   Current difficulty:  ${currentDifficulty} (${currentZeroBits} zero bits)`);

              // Re-validate solution with validation challenge difficulty
              const stillValid = matchesDifficulty(hash, currentDifficulty);
              console.log(`[Orchestrator]   Solution still valid with current difficulty? ${stillValid}`);

              if (!stillValid) {
                console.log(`[Orchestrator] Worker ${workerId}: Solution no longer meets current difficulty (${currentZeroBits} zero bits), discarding`);
                this.pausedAddresses.delete(submissionKey);
                this.submittingAddresses.delete(submissionKey);
                // Remove from solved set so we can keep mining for this address
                const solvedSet = this.solvedAddressChallenges.get(addr.bech32);
                if (solvedSet) {
                  solvedSet.delete(challengeId);
                }
                // Continue mining - don't return, let the worker keep going
                continue;
              } else {
                console.log(`[Orchestrator] Worker ${workerId}: Solution STILL VALID with increased difficulty, proceeding with submission`);
              }
            }

            // Submit solution (pass the captured challengeId to prevent race condition)
            let submissionSuccess = false;
            try {
              await this.submitSolution(addr, challengeId, nonce, hash, preimage, isDevFee, workerId);

              // Mark as solved ONLY after successful submission (no exception thrown)
              if (!this.solvedAddressChallenges.has(addr.bech32)) {
                this.solvedAddressChallenges.set(addr.bech32, new Set());
              }
              this.solvedAddressChallenges.get(addr.bech32)!.add(challengeId);
              console.log(`[Orchestrator] Worker ${workerId}: Marked address ${addr.index} as solved for challenge ${challengeId.slice(0, 8)}...`);

              // Set success flag AFTER marking as solved - this ensures we only reach here if no exception was thrown
              submissionSuccess = true;
            } catch (error: any) {
              console.error(`[Orchestrator] Worker ${workerId}: Submission failed:`, error.message);
              submissionSuccess = false;

              // Increment failure counter for this address
              const currentFailures = this.addressSubmissionFailures.get(submissionKey) || 0;
              this.addressSubmissionFailures.set(submissionKey, currentFailures + 1);
              console.log(`[Orchestrator] Worker ${workerId}: Submission failure ${currentFailures + 1}/${maxFailures} for address ${addr.index}`);
            } finally {
              // Always remove submission lock
              this.submittingAddresses.delete(submissionKey);

              // If submission succeeded, keep paused (will exit via return below)
              // If submission failed, resume workers to retry
              if (!submissionSuccess) {
                console.log(`[Orchestrator] Worker ${workerId}: Resuming all workers to find new solution for this address`);
                this.pausedAddresses.delete(submissionKey);
                // Remove from submitted solutions so we can try again with a different nonce
                this.submittedSolutions.delete(hash);
                // Resume stopped workers so they can continue mining
                this.stoppedWorkers.clear();
                // Don't return - continue mining
                continue;
              } else {
                // Submission succeeded - stop all workers for this address
                this.pausedAddresses.delete(submissionKey);
                // Clear failure counter on success
                this.addressSubmissionFailures.delete(submissionKey);
              }
            }

            // Update worker status to completed
            const finalWorkerData = this.workerStats.get(workerId);
            if (finalWorkerData) {
              finalWorkerData.status = 'completed';
            }

            // IMPORTANT: Stop mining for this address after finding a solution
            // Each address should only submit ONE solution per challenge
            // When this worker returns, Promise.race will stop all other workers
            const logPrefix = isDevFee ? '[DEV FEE]' : '';
            console.log(`[Orchestrator] ${logPrefix} Worker ${workerId} for Address ${addr.index}: Solution submitted, all workers stopping for this address`);
            return; // Exit the mineForAddress function - stops all workers via Promise.race
          }
        }
      } catch (error: any) {
        // Check if this is a hash service timeout (408) - suggests server overload
        const is408Timeout = error.message && error.message.includes('408');
        const isTimeout = error.message && (error.message.includes('timeout') || error.message.includes('ETIMEDOUT'));

        if (is408Timeout || isTimeout) {
          console.error(`[Orchestrator] Worker ${workerId}: Hash service timeout (408) - server may be overloaded`);
          console.error(`[Orchestrator] Worker ${workerId}: Error: ${error.message}`);

          // Log suggestion for user
          this.emit('error', {
            type: 'error',
            message: `Hash service timeout on worker ${workerId}. Server may be overloaded. Consider reducing batch size or worker count.`,
          } as MiningEvent);

          // Wait a bit before retrying to give server time to recover
          await this.sleep(2000);
          continue; // Skip this batch and try next one
        }

        // Check if ROM needs reinitialization (hash server may have restarted)
        const isRomNotInitialized = error.message && error.message.includes('ROM not initialized');
        if (isRomNotInitialized) {
          console.error(`[Orchestrator] Worker ${workerId}: ROM not initialized - hash server may have restarted`);

          // If another worker is already reinitializing, wait for it with timeout
          if (this.romReinitializationInProgress) {
            console.log(`[Orchestrator] Worker ${workerId}: ROM reinitialization already in progress, waiting...`);
            const waitStart = Date.now();
            const maxWaitForOther = 90000; // 90 second max wait for other worker's reinitialization
            while (this.romReinitializationInProgress && (Date.now() - waitStart) < maxWaitForOther) {
              await this.sleep(500);
            }
            // Check if ROM is now ready or if we timed out
            if (hashEngine.isRomReady()) {
              console.log(`[Orchestrator] Worker ${workerId}: ROM now ready, retrying batch...`);
              continue; // Retry the batch
            }
            // If timed out waiting, reset flag and let this worker try
            if (this.romReinitializationInProgress) {
              console.warn(`[Orchestrator] Worker ${workerId}: Timeout waiting for other worker's ROM init, taking over...`);
              this.romReinitializationInProgress = false;
            }
          }

          // Double-check ROM isn't already ready (another worker may have just finished)
          if (hashEngine.isRomReady()) {
            console.log(`[Orchestrator] Worker ${workerId}: ROM already ready, retrying batch...`);
            continue;
          }

          console.log(`[Orchestrator] Worker ${workerId}: Triggering ROM reinitialization...`);
          this.romReinitializationInProgress = true;

          // Try to reinitialize ROM using current challenge data
          try {
            if (this.currentChallenge?.no_pre_mine) {
              await hashEngine.initRom(this.currentChallenge.no_pre_mine);

              // Wait for ROM to be ready
              const maxWait = 60000;
              const startWait = Date.now();
              while (!hashEngine.isRomReady() && (Date.now() - startWait) < maxWait) {
                await this.sleep(500);
              }

              if (hashEngine.isRomReady()) {
                console.log(`[Orchestrator] Worker ${workerId}: ✓ ROM reinitialized successfully`);
              } else {
                console.error(`[Orchestrator] Worker ${workerId}: ROM reinitialization timeout`);
              }
            } else {
              console.error(`[Orchestrator] Worker ${workerId}: Cannot reinitialize ROM - no current challenge data`);
            }
          } catch (reinitError: any) {
            console.error(`[Orchestrator] Worker ${workerId}: ROM reinitialization failed: ${reinitError.message}`);
          } finally {
            // Always clear the flag, even on failure
            this.romReinitializationInProgress = false;
          }

          // If ROM is ready now, retry the batch
          if (hashEngine.isRomReady()) {
            continue;
          }

          // If reinitialization failed, wait and try again
          await this.sleep(5000);
          continue;
        }

        Logger.error('mining', 'Batch hash computation error', error);

        // For other errors, wait a bit and continue
        await this.sleep(1000);
      }

      // Emit progress event every PROGRESS_INTERVAL batches
      // Only log to console every 10 batches to reduce noise
      if (batchCounter % PROGRESS_INTERVAL === 0) {
        const now = Date.now();
        const elapsedSeconds = (now - lastProgressTime) / 1000;
        const hashRate = elapsedSeconds > 0 ? Math.round((BATCH_SIZE * PROGRESS_INTERVAL) / elapsedSeconds) : 0;
        lastProgressTime = now;

        // Update worker stats
        const workerData = this.workerStats.get(workerId);
        if (workerData) {
          workerData.hashesComputed = hashCount;
          workerData.hashRate = hashRate;
          workerData.lastUpdateTime = now;

          // Emit worker update event
          this.emit('worker_update', {
            type: 'worker_update',
            workerId,
            addressIndex: addr.index,
            address: addr.bech32,
            hashesComputed: hashCount,
            hashRate,
            solutionsFound: workerData.solutionsFound,
            startTime: workerData.startTime,
            status: workerData.status,
            currentChallenge: challengeId,
          } as MiningEvent);
        }

        // Only log every 100th progress update to console (reduced logging frequency)
        if (batchCounter % (PROGRESS_INTERVAL * 100) === 0) {
          const progressMsg = `Worker ${workerId} for Address ${addr.index}: ${hashCount.toLocaleString()} hashes @ ${hashRate.toLocaleString()} H/s (Challenge: ${challengeId.slice(0, 8)}...)`;
          console.log(`[Orchestrator] ${progressMsg}`);
        }

        this.emit('hash_progress', {
          type: 'hash_progress',
          address: addr.bech32,
          addressIndex: addr.index,
          hashesComputed: hashCount,
          totalHashes: hashCount,
        } as MiningEvent);

        // Emit stats update
        this.emit('stats', {
          type: 'stats',
          stats: this.getStats(),
        } as MiningEvent);
      }
    }

    // Worker finished (loop ended without finding solution or challenge changed)
    const finalWorkerData = this.workerStats.get(workerId);
    if (finalWorkerData) {
      finalWorkerData.status = 'idle';
      console.log(`[Orchestrator] Worker ${workerId} for Address ${addr.index}: Finished mining (no solution found or challenge changed)`);
    }
  }

  /**
   * Submit solution to API
   * API format: POST /solution/{address}/{challenge_id}/{nonce}
   */
  private async submitSolution(addr: DerivedAddress, challengeId: string, nonce: string, hash: string, preimage: string, isDevFee: boolean = false, workerId: number = 0, isRetryAfterRegistration: boolean = false): Promise<void> {
    if (!this.walletManager) return;

    try {
      // Correct API endpoint: /solution/{address}/{challenge_id}/{nonce}
      // CRITICAL: Use the challengeId parameter (captured when hash was computed) not this.currentChallengeId
      const submitUrl = `${this.apiBase}/solution/${addr.bech32}/${challengeId}/${nonce}`;
      const logPrefix = isDevFee ? '[DEV FEE]' : '';
      console.log(`[Orchestrator] ${logPrefix} Worker ${workerId} submitting solution:`, {
        url: submitUrl,
        nonce,
        hash,
        preimageLength: preimage.length,
      });

      console.log(`[Orchestrator] ${logPrefix} Making POST request...`);
      const response = await axios.post(submitUrl, {}, {
        timeout: 30000, // 30 second timeout
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      });

      console.log(`[Orchestrator] ${logPrefix} Response received!`, {
        statusCode: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log(`[Orchestrator] ${logPrefix} ✓ Solution ACCEPTED by server! Worker ${workerId}`, {
          statusCode: response.status,
          statusText: response.statusText,
          responseData: response.data,
          cryptoReceipt: response.data?.crypto_receipt,
        });
      } else {
        console.log(`[Orchestrator] ${logPrefix} ✗ Solution REJECTED by server:`, {
          statusCode: response.status,
          statusText: response.statusText,
          responseData: response.data,
        });
        throw new Error(`Server rejected solution: ${response.status} ${response.statusText}`);
      }

      this.solutionsFound++;

      // Track user solutions vs dev fee solutions
      if (isDevFee) {
        devFeeManager.recordDevFeeSolution();
        console.log(`[Orchestrator] [DEV FEE] Dev fee solution submitted. Total dev fee solutions: ${devFeeManager.getTotalDevFeeSolutions()}`);
      } else {
        this.userSolutionsCount++;
        console.log(`[Orchestrator] User solution submitted. User solutions count: ${this.userSolutionsCount}`);
        // Dev fee will be handled in batch rotation (no parallel mining)
      }

      // Record solution timestamp for stats
      this.solutionTimestamps.push({ timestamp: Date.now() });

      // Note: address+challenge is already marked as solved before submission
      // to prevent race conditions with multiple solutions in same batch

      // Log receipt to file
      receiptsLogger.logReceipt({
        ts: new Date().toISOString(),
        address: addr.bech32,
        addressIndex: addr.index,
        challenge_id: challengeId, // Use the captured challengeId
        nonce: nonce,
        hash: hash,
        crypto_receipt: response.data?.crypto_receipt,
        isDevFee: isDevFee, // Mark dev fee solutions
      });

      // Emit solution result event
      this.emit('solution_result', {
        type: 'solution_result',
        address: addr.bech32,
        addressIndex: addr.index,
        success: true,
        message: 'Solution accepted',
      } as MiningEvent);

      // Emit solution event
      this.emit('solution', {
        type: 'solution',
        address: addr.bech32,
        challengeId: this.currentChallengeId,
        preimage: nonce,
        timestamp: new Date().toISOString(),
      } as MiningEvent);

      Logger.log('mining', 'Solution submitted successfully', {
        address: addr.bech32,
        challengeId: this.currentChallengeId,
        nonce: nonce,
        receipt: response.data?.crypto_receipt,
      });
    } catch (error: any) {
      console.error('[Orchestrator] ✗ Solution submission FAILED:', {
        errorMessage: error.message,
        errorCode: error.code,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        nonce,
        hash: hash.slice(0, 32) + '...',
        isTimeout: error.code === 'ECONNABORTED',
      });

      // Check if error is due to address not being registered
      const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message || '';
      const isNotRegisteredError =
        errorMessage.toLowerCase().includes('not registered') ||
        errorMessage.toLowerCase().includes('unregistered') ||
        error.response?.status === 403; // Some APIs return 403 for unregistered addresses

      // Auto-retry registration ONCE if this is a registration error and we haven't already retried
      if (isNotRegisteredError && !isRetryAfterRegistration) {
        console.log('[Orchestrator] ⚠️  Solution failed due to address not registered');
        console.log('[Orchestrator] 🔄 Attempting to register address and resubmit solution...');

        try {
          // Register the address
          await this.registerAddress(addr);
          console.log('[Orchestrator] ✓ Address registered successfully');

          // Retry solution submission once
          console.log('[Orchestrator] 🔄 Retrying solution submission...');
          return await this.submitSolution(addr, challengeId, nonce, hash, preimage, isDevFee, workerId, true);
        } catch (registrationError: any) {
          console.error('[Orchestrator] ✗ Auto-registration failed:', registrationError.message);
          console.log('[Orchestrator] ✗ Solution lost - address could not be registered');

          // Log the registration failure
          receiptsLogger.logError({
            ts: new Date().toISOString(),
            address: addr.bech32,
            addressIndex: addr.index,
            challenge_id: challengeId,
            nonce: nonce,
            hash: hash,
            error: `Auto-registration failed: ${registrationError.message}. Original error: ${errorMessage}`,
            response: error.response?.data,
          });

          // Emit failure event
          this.emit('solution_result', {
            type: 'solution_result',
            address: addr.bech32,
            addressIndex: addr.index,
            success: false,
            message: `Auto-registration failed: ${registrationError.message}`,
          } as MiningEvent);

          throw registrationError;
        }
      }

      // Log error to file (for non-registration errors or failed retry)
      receiptsLogger.logError({
        ts: new Date().toISOString(),
        address: addr.bech32,
        addressIndex: addr.index,
        challenge_id: challengeId, // Use the captured challengeId
        nonce: nonce,
        hash: hash,
        error: error.response?.data?.message || error.message,
        response: error.response?.data,
      });

      Logger.error('mining', 'Solution submission failed', {
        error: error.message,
        address: addr.bech32,
        challengeId: this.currentChallengeId,
        nonce: nonce,
        hash: hash,
        preimage: preimage.slice(0, 200),
        response: error.response?.data,
      });

      // Emit solution result event with more details
      const statusCode = error.response?.status || 'N/A';
      const responseData = error.response?.data ? JSON.stringify(error.response.data) : 'N/A';
      const detailedMessage = `${error.response?.data?.message || error.message} [Status: ${statusCode}, Response: ${responseData}]`;

      this.emit('solution_result', {
        type: 'solution_result',
        address: addr.bech32,
        addressIndex: addr.index,
        success: false,
        message: detailedMessage,
      } as MiningEvent);

      // Re-throw the error so the caller knows submission failed
      throw error;
    }
  }

  /**
   * Load previously submitted solutions from receipts file
   * This prevents re-submitting duplicates and re-mining solved address+challenge combinations
   */
  private loadSubmittedSolutions(): void {
    try {
      const allReceipts = receiptsLogger.readReceipts();
      console.log(`[Orchestrator] Loading ${allReceipts.length} previous receipts to prevent duplicates...`);

      // Filter out dev fee receipts - they shouldn't count as "solved" for user addresses
      const userReceipts = allReceipts.filter(r => !r.isDevFee);
      const devFeeReceipts = allReceipts.filter(r => r.isDevFee);

      // Load user solutions count from receipts (SINGLE SOURCE OF TRUTH)
      this.userSolutionsCount = userReceipts.length;
      console.log(`[Orchestrator] Loaded ${this.userSolutionsCount} user solutions from previous sessions`);
      console.log(`[Orchestrator] Found ${devFeeReceipts.length} dev fee solutions in receipts`);

      // Sync dev fee manager's counter with actual receipts
      // This ensures cache is always in sync with reality
      const cacheDevFeeCount = devFeeManager.getTotalDevFeeSolutions();
      if (cacheDevFeeCount !== devFeeReceipts.length) {
        console.log(`[Orchestrator] ⚠️  Dev fee cache mismatch detected!`);
        console.log(`[Orchestrator]    Cache says: ${cacheDevFeeCount} dev fees`);
        console.log(`[Orchestrator]    Receipts show: ${devFeeReceipts.length} dev fees`);
        console.log(`[Orchestrator]    Syncing cache to match receipts (single source of truth)...`);
        devFeeManager.syncWithReceipts(devFeeReceipts.length);
      }

      // Note: Dev fee catch-up check is deferred until AFTER address pool is loaded
      // See startMining() method for the actual trigger

      // Process user receipts
      for (const receipt of userReceipts) {
        // Track solution hash to prevent duplicate submissions
        if (receipt.hash) {
          this.submittedSolutions.add(receipt.hash);
        }

        // Track address+challenge combinations that are already solved
        const address = receipt.address;
        const challengeId = receipt.challenge_id;

        if (!this.solvedAddressChallenges.has(address)) {
          this.solvedAddressChallenges.set(address, new Set());
        }
        this.solvedAddressChallenges.get(address)!.add(challengeId);
      }

      // Process dev fee receipts - track their address+challenge combos too
      for (const receipt of devFeeReceipts) {
        // Track solution hash to prevent duplicate submissions
        if (receipt.hash) {
          this.submittedSolutions.add(receipt.hash);
        }

        // Track dev fee address+challenge combinations that are already solved
        const address = receipt.address;
        const challengeId = receipt.challenge_id;

        if (!this.solvedAddressChallenges.has(address)) {
          this.solvedAddressChallenges.set(address, new Set());
        }
        this.solvedAddressChallenges.get(address)!.add(challengeId);
      }

      console.log(`[Orchestrator] Loaded ${this.solvedAddressChallenges.size} unique addresses with solved challenges (includes dev fee addresses)`);

      console.log(`[Orchestrator] Loaded ${this.submittedSolutions.size} submitted solution hashes (${allReceipts.length - userReceipts.length} dev fee solutions excluded)`);
      console.log(`[Orchestrator] Loaded ${this.solvedAddressChallenges.size} addresses with solved challenges`);
    } catch (error: any) {
      console.error('[Orchestrator] Failed to load submitted solutions:', error.message);
    }
  }

  /**
   * Load challenge-specific state from receipts
   * Call this when a challenge is loaded to restore progress for that challenge
   */
  private loadChallengeState(challengeId: string): void {
    try {
      const allReceipts = receiptsLogger.readReceipts();

      // Filter receipts for this specific challenge
      const challengeReceipts = allReceipts.filter(r => r.challenge_id === challengeId);
      const userReceipts = challengeReceipts.filter(r => !r.isDevFee);
      const devFeeReceipts = challengeReceipts.filter(r => r.isDevFee);

      console.log(`[Orchestrator] ═══════════════════════════════════════════════`);
      console.log(`[Orchestrator] LOADING CHALLENGE STATE`);
      console.log(`[Orchestrator] Challenge ID: ${challengeId.slice(0, 16)}...`);
      console.log(`[Orchestrator] Found ${challengeReceipts.length} receipts for this challenge`);
      console.log(`[Orchestrator]   - User solutions: ${userReceipts.length}`);
      console.log(`[Orchestrator]   - Dev fee solutions: ${devFeeReceipts.length}`);

      // Restore solutionsFound count for this challenge
      this.solutionsFound = challengeReceipts.length;

      // Clear and restore addressesProcessedCurrentChallenge with address indexes
      this.addressesProcessedCurrentChallenge.clear();

      for (const receipt of userReceipts) {
        // Find the address index for this receipt
        const addressIndex = this.addresses.findIndex(a => a.bech32 === receipt.address);
        if (addressIndex !== -1) {
          this.addressesProcessedCurrentChallenge.add(addressIndex);
        }
      }

      console.log(`[Orchestrator] Progress: ${this.addressesProcessedCurrentChallenge.size}/${this.addresses.length} user addresses solved for this challenge`);
      console.log(`[Orchestrator] Total solutions: ${this.solutionsFound} (${userReceipts.length} user + ${devFeeReceipts.length} dev fee)`);
      console.log(`[Orchestrator] ═══════════════════════════════════════════════`);

      // Emit stats update to refresh UI with restored state
      this.emit('stats', {
        type: 'stats',
        stats: this.getStats(),
      } as MiningEvent);

    } catch (error: any) {
      console.error('[Orchestrator] Failed to load challenge state:', error.message);
    }
  }

  /**
   * Fetch current challenge from API
   */
  private async fetchChallenge(): Promise<ChallengeResponse> {
    const response = await axios.get(`${this.apiBase}/challenge`);
    return response.data;
  }


  /**
   * Ensure all addresses are registered for the current profile
   */
  private async ensureAddressesRegistered(): Promise<void> {
    // Check which addresses are registered for the CURRENT profile
    const unregistered = this.addresses.filter(addr => {
      if (!this.walletManager) return true;
      return !this.walletManager.isAddressRegisteredForProfile(addr.index, this.currentProfileId);
    });

    if (unregistered.length === 0) {
      console.log(`[Orchestrator] All addresses already registered for profile: ${this.currentProfileId}`);
      return;
    }

    console.log(`[Orchestrator] Registering ${unregistered.length} addresses for profile: ${this.currentProfileId}...`);
    const totalToRegister = unregistered.length;
    let registeredCount = 0;

    for (const addr of unregistered) {
      try {
        // Emit registration start event
        this.emit('registration_progress', {
          type: 'registration_progress',
          addressIndex: addr.index,
          address: addr.bech32,
          current: registeredCount,
          total: totalToRegister,
          success: false,
          message: `Registering address ${addr.index}...`,
        } as MiningEvent);

        await this.registerAddress(addr);
        registeredCount++;
        console.log('[Orchestrator] Registered address', addr.index);

        // Emit registration success event
        this.emit('registration_progress', {
          type: 'registration_progress',
          addressIndex: addr.index,
          address: addr.bech32,
          current: registeredCount,
          total: totalToRegister,
          success: true,
          message: `Address ${addr.index} registered successfully`,
        } as MiningEvent);

        // Rate limiting
        await this.sleep(1500);
      } catch (error: any) {
        Logger.error('mining', `Failed to register address ${addr.index}`, error);

        // Emit registration failure event
        this.emit('registration_progress', {
          type: 'registration_progress',
          addressIndex: addr.index,
          address: addr.bech32,
          current: registeredCount,
          total: totalToRegister,
          success: false,
          message: `Failed to register address ${addr.index}: ${error.message}`,
        } as MiningEvent);
      }
    }
  }

  /**
   * Register a single address
   */
  private async registerAddress(addr: DerivedAddress): Promise<void> {
    if (!this.walletManager) {
      throw new Error('Wallet manager not initialized');
    }

    // Get T&C message (try API first, fallback to profile's registration message)
    let message: string;
    try {
      const tandcResp = await axios.get(`${this.apiBase}/TandC`);
      message = tandcResp.data.message;
    } catch (tandcErr: any) {
      // Try to get fallback message from active profile
      if (tandcErr.response?.status === 404) {
        try {
          const { profileManager } = require('@/lib/config/profile-manager');
          const profile = profileManager.getActiveProfile();

          if (profile?.registration?.message) {
            console.log(`[Orchestrator] /TandC endpoint not found, using profile registration message for ${profile.name}`);
            message = profile.registration.message;
          } else {
            throw new Error('No registration message available (neither /TandC endpoint nor profile registration.message)');
          }
        } catch (profileErr) {
          console.error('[Orchestrator] Failed to load profile registration message:', profileErr);
          throw new Error('Registration failed: No T&C message available');
        }
      } else {
        throw tandcErr;
      }
    }

    // Sign message
    const signature = await this.walletManager.signMessage(addr.index, message);

    // Register
    const registerUrl = `${this.apiBase}/register/${addr.bech32}/${signature}/${addr.publicKeyHex}`;
    await axios.post(registerUrl, {});

    // Mark as registered for this profile
    this.walletManager.markAddressRegistered(addr.index, this.currentProfileId);
    addr.registered = true;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Schedule hourly restart to clean workers and prepare for new challenges
   */
  private scheduleHourlyRestart(password: string): void {
    // Calculate milliseconds until the end of the current hour
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0); // Set to next hour at :00:00
    const msUntilNextHour = nextHour.getTime() - now.getTime();

    console.log(`[Orchestrator] Hourly restart scheduled in ${Math.round(msUntilNextHour / 1000 / 60)} minutes (at ${nextHour.toLocaleTimeString()})`);

    // Clear any existing timer
    if (this.hourlyRestartTimer) {
      clearTimeout(this.hourlyRestartTimer);
    }

    // Schedule the restart
    this.hourlyRestartTimer = setTimeout(async () => {
      if (!this.isRunning) {
        console.log('[Orchestrator] Hourly restart skipped - mining not active');
        return;
      }

      console.log('[Orchestrator] ========================================');
      console.log('[Orchestrator] HOURLY RESTART - Cleaning workers and state');
      console.log('[Orchestrator] ========================================');

      try {
        // Check if dev fee was mining before restart
        // Stop current mining
        console.log('[Orchestrator] Stopping mining for hourly cleanup...');
        this.isMining = false;

        // Give workers time to finish current batch
        await this.sleep(2000);

        // Kill all workers to ensure clean state
        console.log('[Orchestrator] Killing all workers for hourly cleanup...');
        try {
          await hashEngine.killWorkers();
          console.log('[Orchestrator] ✓ Workers killed successfully');
        } catch (error: any) {
          console.error('[Orchestrator] Failed to kill workers:', error.message);
        }

        // Clear worker stats
        this.workerStats.clear();
        console.log('[Orchestrator] ✓ Worker stats cleared');

        // Reset state
        this.addressesProcessedCurrentChallenge.clear();
        this.pausedAddresses.clear();
        this.submittingAddresses.clear();
        console.log('[Orchestrator] ✓ State reset complete');

        // Wait a bit before restarting
        await this.sleep(1000);

        // Reinitialize ROM if we have a challenge
        if (this.currentChallenge) {
          console.log('[Orchestrator] Reinitializing ROM...');
          const noPreMine = this.currentChallenge.no_pre_mine;
          await hashEngine.initRom(noPreMine);

          const maxWait = 60000;
          const startWait = Date.now();
          while (!hashEngine.isRomReady() && (Date.now() - startWait) < maxWait) {
            await this.sleep(500);
          }

          if (hashEngine.isRomReady()) {
            console.log('[Orchestrator] ✓ ROM reinitialized successfully');
          } else {
            console.error('[Orchestrator] ROM initialization timeout after hourly restart');
          }
        }

        console.log('[Orchestrator] ========================================');
        console.log('[Orchestrator] HOURLY RESTART COMPLETE - Resuming mining');
        console.log('[Orchestrator] ========================================');

        // Resume mining if still running
        if (this.isRunning && this.currentChallenge && this.currentChallengeId) {
          // Dev fee is now handled in batch rotation - no special resume needed
          this.startMining();
        }

        // Schedule next hourly restart
        this.scheduleHourlyRestart(password);

      } catch (error: any) {
        console.error('[Orchestrator] Hourly restart failed:', error.message);
        // Try to resume mining anyway
        if (this.isRunning && this.currentChallenge && this.currentChallengeId) {
          this.startMining();
        }
        // Still schedule next restart
        this.scheduleHourlyRestart(password);
      }
    }, msUntilNextHour);
  }

  /**
   * Start watchdog monitor to detect and fix stuck/idle workers
   */
  private startWatchdog(): void {
    // Clear any existing watchdog
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
    }

    console.log('[Orchestrator] 🐕 Starting watchdog monitor (checks every 30 seconds)');

    // Check every 30 seconds
    this.watchdogTimer = setInterval(() => {
      this.runWatchdogCheck();
    }, 30000);
  }

  /**
   * Stop watchdog monitor
   */
  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
      console.log('[Orchestrator] 🐕 Watchdog monitor stopped');
    }
  }

  /**
   * Watchdog check - detects and fixes worker issues
   * Actively reassigns idle workers to maximize hash power
   */
  private runWatchdogCheck(): void {
    // Only run if mining is active
    if (!this.isRunning || !this.isMining || !this.currentChallengeId) {
      return;
    }

    const currentChallengeId = this.currentChallengeId;
    const idleWorkers: number[] = [];
    const workersOnSolvedAddresses: Array<{workerId: number, addressIndex: number}> = [];
    let activeWorkers = 0;
    let submittingWorkers = 0;

    // Check all workers
    for (const [workerId, stats] of this.workerStats.entries()) {
      if (stats.status === 'idle') {
        idleWorkers.push(workerId);
      } else if (stats.status === 'mining') {
        activeWorkers++;
        // Check if mining an already-solved address
        if (stats.addressIndex >= 0) {
          const address = this.addresses[stats.addressIndex];
          if (address) {
            const solvedChallenges = this.solvedAddressChallenges.get(address.bech32);
            if (solvedChallenges && solvedChallenges.has(currentChallengeId)) {
              workersOnSolvedAddresses.push({workerId, addressIndex: stats.addressIndex});
            }
          }
        }
      } else if (stats.status === 'submitting') {
        submittingWorkers++;
      }
    }

    // Combine idle workers and workers on solved addresses - all need reassignment
    const workersToReassign = [...idleWorkers];
    for (const {workerId} of workersOnSolvedAddresses) {
      if (!workersToReassign.includes(workerId)) {
        workersToReassign.push(workerId);
      }
    }

    // If there are workers to reassign, find unsolved addresses and assign them
    if (workersToReassign.length > 0) {
      console.log(`[Orchestrator] 🐕 Watchdog: ${workersToReassign.length} workers need reassignment (${idleWorkers.length} idle, ${workersOnSolvedAddresses.length} on solved)`);

      // Find unsolved addresses that aren't currently being mined
      const addressesBeingMined = new Set<number>();
      for (const [, stats] of this.workerStats.entries()) {
        if (stats.status === 'mining' && !workersToReassign.includes(stats.workerId)) {
          addressesBeingMined.add(stats.addressIndex);
        }
      }

      const unsolvedAddresses = this.addresses.filter(addr => {
        if (!addr.registered) return false;
        // Check if already solved
        const solvedChallenges = this.solvedAddressChallenges.get(addr.bech32);
        if (solvedChallenges && solvedChallenges.has(currentChallengeId)) return false;
        // Check if already being mined by another worker
        if (addressesBeingMined.has(addr.index)) return false;
        return true;
      });

      if (unsolvedAddresses.length === 0) {
        console.log(`[Orchestrator] 🐕 No unsolved addresses available to assign`);
        return;
      }

      // Assign workers to unsolved addresses
      let addressIndex = 0;
      for (const workerId of workersToReassign) {
        if (addressIndex >= unsolvedAddresses.length) {
          // More workers than addresses - some will share addresses (fine for redundancy)
          addressIndex = 0;
        }

        const addr = unsolvedAddresses[addressIndex];
        console.log(`[Orchestrator] 🐕 Reassigning Worker ${workerId} to Address #${addr.index}`);

        // CRITICAL: Remove worker from stoppedWorkers before reassigning
        // Workers are added to stoppedWorkers when another worker finds a solution
        // If we don't clear this, the worker will immediately exit in mineForAddress()
        this.stoppedWorkers.delete(workerId);

        // Start mining on this address (fire and forget - it runs async)
        this.mineForAddress(addr, false, workerId, 6);

        addressIndex++;
      }

      console.log(`[Orchestrator] 🐕 Reassigned ${workersToReassign.length} workers to ${Math.min(workersToReassign.length, unsolvedAddresses.length)} addresses`);
    }
  }
}

// Singleton instance
export const miningOrchestrator = new MiningOrchestrator();
