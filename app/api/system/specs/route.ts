import { NextResponse } from 'next/server';
import * as os from 'os';
import { miningOrchestrator } from '@/lib/mining/orchestrator';

/**
 * System Specs API - Returns hardware specifications for scaling recommendations
 */
export async function GET() {
  try {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const platform = os.platform();
    const arch = os.arch();
    const loadAvg = os.loadavg();

    // Get CPU info
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCount = cpus.length;
    const cpuSpeed = cpus[0]?.speed || 0;

    // Calculate memory in GB
    const totalMemoryGB = (totalMemory / (1024 ** 3)).toFixed(2);
    const freeMemoryGB = (freeMemory / (1024 ** 3)).toFixed(2);
    const usedMemoryGB = ((totalMemory - freeMemory) / (1024 ** 3)).toFixed(2);
    const memoryUsagePercent = (((totalMemory - freeMemory) / totalMemory) * 100).toFixed(1);

    // Get current configuration from orchestrator
    const currentConfig = miningOrchestrator.getCurrentConfiguration();

    // Calculate recommendations
    const recommendations = calculateRecommendations({
      cpuCount,
      cpuSpeed,
      totalMemoryGB: parseFloat(totalMemoryGB),
      platform,
      currentWorkerThreads: currentConfig.workerThreads,
      currentBatchSize: currentConfig.batchSize,
    });

    return NextResponse.json({
      success: true,
      specs: {
        cpu: {
          model: cpuModel,
          cores: cpuCount,
          speed: cpuSpeed,
          loadAverage: loadAvg,
        },
        memory: {
          total: totalMemoryGB,
          free: freeMemoryGB,
          used: usedMemoryGB,
          usagePercent: memoryUsagePercent,
        },
        system: {
          platform,
          arch,
          uptime: os.uptime(),
        },
      },
      recommendations,
    });
  } catch (error: any) {
    console.error('[System Specs API] Failed to get system specs:', error.message);

    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve system specifications',
      specs: null,
      recommendations: null,
    }, { status: 500 });
  }
}

/**
 * Calculate optimal BATCH_SIZE and workerThreads based on system specs
 */
function calculateRecommendations(specs: {
  cpuCount: number;
  cpuSpeed: number;
  totalMemoryGB: number;
  platform: string;
  currentWorkerThreads: number;
  currentBatchSize: number;
}) {
  const { cpuCount, cpuSpeed, totalMemoryGB, currentWorkerThreads, currentBatchSize } = specs;

  // Worker threads recommendation
  // Use all available CPU cores for maximum hashing performance
  const maxWorkers = cpuCount;

  // Optimal workers (use all cores as optimal)
  const optimalWorkers = cpuCount;

  // Conservative workers (for systems with other workloads running)
  const conservativeWorkers = Math.max(2, Math.floor(cpuCount * 0.5));

  // Ensure conservative is never higher than optimal
  const finalConservativeWorkers = Math.min(conservativeWorkers, optimalWorkers);

  // Batch size recommendation - Dynamic scaling based on CPU cores
  // Rule: Larger batches = fewer API calls but more memory usage
  // Scale batch size proportionally to CPU cores for optimal performance

  // Base calculation: Scale with core count
  // Formula: 200 base + (cores * 30) for linear scaling
  // 4 cores  = 200 + 120  = 320
  // 12 cores = 200 + 360  = 560
  // 24 cores = 200 + 720  = 920
  // 64 cores = 200 + 1920 = 2120
  let optimalBatchSize = 200 + (cpuCount * 30);

  // Apply CPU speed multiplier
  let speedMultiplier = 1.0;
  if (cpuSpeed >= 3500) {
    speedMultiplier = 1.25; // Very fast CPUs
  } else if (cpuSpeed >= 3000) {
    speedMultiplier = 1.15; // Fast CPUs can handle larger batches
  } else if (cpuSpeed >= 2500) {
    speedMultiplier = 1.05;
  } else if (cpuSpeed < 2000) {
    speedMultiplier = 0.85; // Slower CPUs need smaller batches
  }

  // Apply memory constraint multiplier
  let memoryMultiplier = 1.0;
  if (totalMemoryGB >= 64) {
    memoryMultiplier = 1.2; // Massive RAM
  } else if (totalMemoryGB >= 32) {
    memoryMultiplier = 1.15; // Lots of RAM can handle larger batches
  } else if (totalMemoryGB >= 16) {
    memoryMultiplier = 1.05;
  } else if (totalMemoryGB < 8) {
    memoryMultiplier = 0.8; // Limited RAM needs smaller batches
  } else if (totalMemoryGB < 4) {
    memoryMultiplier = 0.6; // Very limited RAM
  }

  // Calculate final optimal with multipliers
  optimalBatchSize = Math.round(optimalBatchSize * speedMultiplier * memoryMultiplier);

  // Calculate max (1.8x optimal) and conservative (0.65x optimal)
  let maxBatchSize = Math.round(optimalBatchSize * 1.8);
  let conservativeBatchSize = Math.round(optimalBatchSize * 0.65);

  // Apply absolute bounds to prevent extreme values
  // Min: 150 (even 2-core systems need some batch)
  // Max: 4000 (prevents excessive challenge staleness)
  optimalBatchSize = Math.max(150, Math.min(3000, optimalBatchSize));
  maxBatchSize = Math.max(250, Math.min(4000, maxBatchSize));
  conservativeBatchSize = Math.max(100, Math.min(2000, conservativeBatchSize));

  // System tier classification
  let systemTier: 'low-end' | 'entry-level' | 'mid-range' | 'high-end';
  if (cpuCount >= 12 && totalMemoryGB >= 16) {
    systemTier = 'high-end';
  } else if (cpuCount >= 8 && totalMemoryGB >= 8) {
    systemTier = 'mid-range';
  } else if (cpuCount >= 4 && totalMemoryGB >= 4) {
    systemTier = 'entry-level';
  } else {
    systemTier = 'low-end';
  }

  return {
    systemTier,
    workerThreads: {
      current: currentWorkerThreads,
      optimal: optimalWorkers,
      conservative: finalConservativeWorkers,
      max: maxWorkers,
      explanation: `Based on ${cpuCount} CPU cores. Optimal uses ~${Math.round((optimalWorkers / cpuCount) * 100)}% of cores, leaving headroom for OS tasks.`,
    },
    batchSize: {
      current: currentBatchSize,
      optimal: optimalBatchSize,
      conservative: conservativeBatchSize,
      max: maxBatchSize,
      explanation: `Larger batches reduce API calls but increase memory usage. Optimal based on ${cpuCount} cores, ${cpuSpeed}MHz CPU, and ${totalMemoryGB}GB RAM.`,
    },
    warnings: generateWarnings(specs, optimalWorkers, optimalBatchSize),
    performanceNotes: [
      'Worker threads should not exceed CPU core count to avoid context switching overhead',
      'Batch size affects hash computation time and memory usage',
      'Monitor CPU usage and hash rate to fine-tune these values',
      'If you see 408 timeouts, reduce batch size',
      'If CPU usage is low, increase worker threads',
    ],
  };
}

/**
 * Generate warnings based on system specs
 */
function generateWarnings(
  specs: { cpuCount: number; cpuSpeed: number; totalMemoryGB: number; platform: string },
  optimalWorkers: number,
  optimalBatchSize: number
): string[] {
  const warnings: string[] = [];

  if (specs.totalMemoryGB < 4) {
    warnings.push('⚠️ Low memory detected. Consider reducing batch size to avoid out-of-memory errors.');
  }

  if (specs.cpuCount < 4) {
    warnings.push('⚠️ Limited CPU cores. Mining performance may be limited. Consider using conservative settings.');
  }

  if (specs.cpuSpeed < 2000) {
    warnings.push('⚠️ Low CPU clock speed. May experience slower hash rates. Consider reducing batch size.');
  }

  if (specs.totalMemoryGB >= 32 && specs.cpuCount >= 16) {
    warnings.push('✅ High-performance system detected. You can push settings higher for maximum throughput.');
  }

  if (optimalWorkers > 12) {
    warnings.push('💡 System has many cores. Consider testing with max worker threads for optimal performance.');
  }

  return warnings;
}
