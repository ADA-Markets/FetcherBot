'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import {
  Cpu,
  MemoryStick as Memory,
  Gauge,
  TrendingUp,
  RefreshCw,
  Settings,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Zap,
  ArrowLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SystemSpecs {
  cpu: {
    model: string;
    cores: number;
    speed: number;
    loadAverage: number[];
  };
  memory: {
    total: string;
    free: string;
    used: string;
    usagePercent: string;
  };
  system: {
    platform: string;
    arch: string;
    uptime: number;
  };
}

interface Recommendations {
  systemTier: 'low-end' | 'entry-level' | 'mid-range' | 'high-end';
  workerThreads: {
    current: number;
    optimal: number;
    conservative: number;
    max: number;
    explanation: string;
  };
  batchSize: {
    current: number;
    optimal: number;
    conservative: number;
    max: number;
    explanation: string;
  };
  warnings: string[];
  performanceNotes: string[];
}

export default function ScalePage() {
  const router = useRouter();
  const [specs, setSpecs] = useState<SystemSpecs | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Worker grouping settings
  const [workerGroupingMode, setWorkerGroupingMode] = useState<'auto' | 'all-on-one' | 'grouped'>('auto');
  const [workersPerAddress, setWorkersPerAddress] = useState<number>(5);
  const [workerThreads, setWorkerThreads] = useState<number>(11);
  const [batchSize, setBatchSize] = useState<number>(300);
  const [preferEasierChallenges, setPreferEasierChallenges] = useState<boolean>(false);
  const [minChallengeTimeMinutes, setMinChallengeTimeMinutes] = useState<number>(15);
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [syncingChallenges, setSyncingChallenges] = useState<boolean>(false);
  const [challengeSyncResult, setChallengeSyncResult] = useState<{ success: boolean; message: string; easiest?: any } | null>(null);

  useEffect(() => {
    loadSystemSpecs();
    loadCurrentConfig();
  }, []);

  const loadCurrentConfig = async () => {
    try {
      const response = await fetch('/api/mining/status');
      const data = await response.json();
      // Config is nested inside stats: { success: true, stats: { config: {...} } }
      const config = data.stats?.config || data.config;
      if (config) {
        setWorkerGroupingMode(config.workerGroupingMode || 'auto');
        setWorkersPerAddress(config.workersPerAddress || 5);
        setWorkerThreads(config.workerThreads || 11);
        setBatchSize(config.batchSize || 300);
        setPreferEasierChallenges(config.preferEasierChallenges || false);
        setMinChallengeTimeMinutes(config.minChallengeTimeMinutes || 15);
      }
    } catch (err) {
      console.error('Failed to load current config:', err);
    }
  };

  const handleUpdateConfig = async () => {
    setUpdating(true);
    setUpdateSuccess(false);
    setError(null);

    try {
      const response = await fetch('/api/mining/update-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerThreads,
          batchSize,
          workerGroupingMode,
          workersPerAddress,
          preferEasierChallenges,
          minChallengeTimeMinutes,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setUpdateSuccess(true);
        setTimeout(() => setUpdateSuccess(false), 3000);
      } else {
        setError(data.error || 'Failed to update configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update configuration');
    } finally {
      setUpdating(false);
    }
  };

  const calculateGroupCount = () => {
    if (workerGroupingMode === 'all-on-one') return 1;
    const minWorkers = workerGroupingMode === 'grouped' ? workersPerAddress : 5;
    return Math.floor(workerThreads / minWorkers);
  };

  // Sync challenge history from community API
  const syncChallengeHistory = async () => {
    setSyncingChallenges(true);
    setChallengeSyncResult(null);

    try {
      // Get the history URL from the profile
      const profileResponse = await fetch('/api/profile');
      const profileData = await profileResponse.json();
      const historyUrl = profileData?.profile?.challenge?.historyUrl;

      if (!historyUrl) {
        setChallengeSyncResult({
          success: false,
          message: 'No challenge history URL configured for this profile',
        });
        return;
      }

      const response = await fetch('/api/mining/challenge-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: historyUrl }),
      });

      const data = await response.json();

      if (data.success) {
        setChallengeSyncResult({
          success: true,
          message: `Imported ${data.imported} challenges. ${data.totalValid} valid challenges available.`,
          easiest: data.easiestChallenge,
        });
      } else {
        setChallengeSyncResult({
          success: false,
          message: data.error || 'Failed to sync challenge history',
        });
      }
    } catch (err: any) {
      setChallengeSyncResult({
        success: false,
        message: err.message || 'Failed to sync challenge history',
      });
    } finally {
      setSyncingChallenges(false);
    }
  };

  const loadSystemSpecs = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/system/specs');
      const data = await response.json();

      if (data.success) {
        setSpecs(data.specs);
        setRecommendations(data.recommendations);
      } else {
        setError(data.error || 'Failed to load system specifications');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to API');
    } finally {
      setLoading(false);
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'high-end':
        return 'text-green-400 bg-green-900/20 border-green-700/50';
      case 'mid-range':
        return 'text-blue-400 bg-blue-900/20 border-blue-700/50';
      case 'entry-level':
        return 'text-yellow-400 bg-yellow-900/20 border-yellow-700/50';
      case 'low-end':
        return 'text-orange-400 bg-orange-900/20 border-orange-700/50';
      default:
        return 'text-gray-400 bg-gray-900/20 border-gray-700/50';
    }
  };

  const getTierLabel = (tier: string) => {
    return tier.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-4">
              <RefreshCw className="w-12 h-12 animate-spin text-blue-500 mx-auto" />
              <p className="text-lg text-gray-400">Analyzing system specifications...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !specs || !recommendations) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-7xl mx-auto">
          <Alert variant="error" className="mb-4">
            <AlertTriangle className="w-5 h-5" />
            <span>{error || 'Failed to load system specifications'}</span>
          </Alert>
          <Button onClick={loadSystemSpecs} variant="primary">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Button
                onClick={() => router.back()}
                variant="ghost"
                size="sm"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
              <h1 className="text-3xl font-bold">Performance Scaling</h1>
            </div>
            <p className="text-gray-400">
              Optimize BATCH_SIZE and workerThreads based on your hardware
            </p>
          </div>
          <Button onClick={loadSystemSpecs} variant="outline">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>

        {/* System Tier Badge */}
        <div className="flex justify-center">
          <div className={cn(
            'inline-flex items-center gap-3 px-6 py-3 rounded-full border',
            getTierColor(recommendations.systemTier)
          )}>
            <Zap className="w-5 h-5" />
            <span className="text-lg font-semibold">
              System Tier: {getTierLabel(recommendations.systemTier)}
            </span>
          </div>
        </div>

        {/* System Specifications */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Cpu className="w-5 h-5 text-blue-400" />
                CPU
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Model:</span>
                <span className="font-mono text-white truncate ml-2" title={specs.cpu.model}>
                  {specs.cpu.model.substring(0, 25)}...
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Cores:</span>
                <span className="font-mono text-white">{specs.cpu.cores}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Speed:</span>
                <span className="font-mono text-white">{specs.cpu.speed} MHz</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Load (1m):</span>
                <span className="font-mono text-white">{specs.cpu.loadAverage[0].toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Memory className="w-5 h-5 text-purple-400" />
                Memory
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total:</span>
                <span className="font-mono text-white">{specs.memory.total} GB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Used:</span>
                <span className="font-mono text-white">{specs.memory.used} GB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Free:</span>
                <span className="font-mono text-white">{specs.memory.free} GB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Usage:</span>
                <span className="font-mono text-white">{specs.memory.usagePercent}%</span>
              </div>
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings className="w-5 h-5 text-green-400" />
                System
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Platform:</span>
                <span className="font-mono text-white">{specs.system.platform}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Architecture:</span>
                <span className="font-mono text-white">{specs.system.arch}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Uptime:</span>
                <span className="font-mono text-white">
                  {Math.floor(specs.system.uptime / 3600)}h {Math.floor((specs.system.uptime % 3600) / 60)}m
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Challenge Strategy - AT TOP for visibility */}
        <Card variant="elevated" className="border-2 border-yellow-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-yellow-400" />
              Challenge Strategy
            </CardTitle>
            <CardDescription>
              Configure which challenges to mine - current or easier historical ones
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Toggle for Prefer Easier Challenges */}
            <div className="flex items-center justify-between p-4 bg-yellow-900/30 border border-yellow-600/50 rounded-lg">
              <div className="space-y-1">
                <label className="text-sm font-medium text-white">Prefer Easier Challenges</label>
                <p className="text-xs text-gray-400">
                  Mine easier historical challenges instead of the current harder one
                </p>
              </div>
              <button
                onClick={() => setPreferEasierChallenges(!preferEasierChallenges)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  preferEasierChallenges ? 'bg-yellow-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    preferEasierChallenges ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {preferEasierChallenges && (
              <>
                <Alert variant="info">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm">
                    When enabled, the miner will automatically switch to easier challenges from history
                    if they have enough time remaining. This can significantly increase your success rate!
                  </span>
                </Alert>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">
                    Minimum Time Remaining (minutes)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    value={minChallengeTimeMinutes}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setMinChallengeTimeMinutes('' as any);
                      } else {
                        setMinChallengeTimeMinutes(Math.max(5, Math.min(120, parseInt(val) || 15)));
                      }
                    }}
                    onBlur={(e) => {
                      if (e.target.value === '') {
                        setMinChallengeTimeMinutes(15);
                      }
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                  <p className="text-xs text-gray-400">
                    Only consider historical challenges with at least this much time before they expire.
                    Default: 15 minutes. Lower values are riskier but may find more opportunities.
                  </p>
                </div>

                {/* Sync Challenge History Button */}
                <div className="space-y-3">
                  <Button
                    onClick={syncChallengeHistory}
                    disabled={syncingChallenges}
                    variant="outline"
                    className="w-full border-yellow-600 text-yellow-400 hover:bg-yellow-900/30"
                  >
                    {syncingChallenges ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync Challenge History from Community
                      </>
                    )}
                  </Button>

                  {challengeSyncResult && (
                    <Alert variant={challengeSyncResult.success ? 'success' : 'error'}>
                      {challengeSyncResult.success ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                      <div className="text-sm">
                        <p>{challengeSyncResult.message}</p>
                        {challengeSyncResult.easiest && (
                          <p className="mt-1 text-xs opacity-80">
                            Easiest available: {challengeSyncResult.easiest.challenge_id}
                            (difficulty: {challengeSyncResult.easiest.difficulty},
                            expires in {challengeSyncResult.easiest.minutesRemaining} min)
                          </p>
                        )}
                      </div>
                    </Alert>
                  )}

                  <p className="text-xs text-gray-400">
                    Sync pulls challenge history from the community API. This helps you find easier historical challenges to mine.
                  </p>
                </div>
              </>
            )}

            <Button
              onClick={handleUpdateConfig}
              disabled={updating}
              className="w-full"
              variant={updateSuccess ? "success" : "primary"}
            >
              {updating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Updating...
                </>
              ) : updateSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Settings Applied!
                </>
              ) : (
                <>
                  <Settings className="w-4 h-4" />
                  Apply Challenge Strategy
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Warnings */}
        {recommendations.warnings.length > 0 && (
          <div className="space-y-2">
            {recommendations.warnings.map((warning, index) => (
              <Alert
                key={index}
                variant={warning.startsWith('✅') ? 'success' : warning.startsWith('💡') ? 'info' : 'warning'}
              >
                <span>{warning}</span>
              </Alert>
            ))}
          </div>
        )}

        {/* Worker Distribution Configuration */}
        <Card variant="elevated">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-6 h-6 text-blue-400" />
              Worker Distribution Strategy
            </CardTitle>
            <CardDescription>
              Configure how workers are assigned to addresses
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current Settings Display */}
            <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg">
              <p className="text-sm font-semibold text-blue-300 mb-2">Current Settings</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-gray-400">Mode: </span>
                  <span className="text-white font-medium">
                    {workerGroupingMode === 'auto' ? 'Auto' : workerGroupingMode === 'all-on-one' ? 'All-on-One' : 'Custom Groups'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Workers per Address: </span>
                  <span className="text-white font-medium">
                    {workerGroupingMode === 'all-on-one'
                      ? `${workerThreads} (all)`
                      : workerGroupingMode === 'grouped'
                        ? `${workersPerAddress}`
                        : '~5 (auto)'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Addresses in Parallel: </span>
                  <span className="text-white font-medium">{calculateGroupCount()}</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-300">Mode</label>
              <select
                value={workerGroupingMode}
                onChange={(e) => setWorkerGroupingMode(e.target.value as any)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="auto">Auto (Recommended)</option>
                <option value="all-on-one">All Workers on One Address</option>
                <option value="grouped">Custom Groups</option>
              </select>
            </div>

            {workerGroupingMode === 'grouped' && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-300">
                  Minimum Workers per Address
                </label>
                <input
                  type="number"
                  min="1"
                  max={workerThreads}
                  value={workersPerAddress}
                  onChange={(e) => setWorkersPerAddress(Math.max(1, Math.min(workerThreads, parseInt(e.target.value) || 1)))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-sm text-gray-400">
                  With {workerThreads} workers at min {workersPerAddress}:
                  <strong className="text-white"> {calculateGroupCount()} addresses in parallel</strong>
                </p>
              </div>
            )}

            {workerGroupingMode === 'auto' && (
              <Alert variant="info">
                <Info className="w-4 h-4" />
                <span className="text-sm">
                  Auto mode uses ~5 workers per address. With {workerThreads} workers: <strong>{calculateGroupCount()} addresses in parallel</strong>
                </span>
              </Alert>
            )}

            {workerGroupingMode === 'all-on-one' && (
              <Alert variant="info">
                <Info className="w-4 h-4" />
                <span className="text-sm">
                  All {workerThreads} workers will focus on ONE address at a time for maximum solving speed per address.
                </span>
              </Alert>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Worker Threads</label>
              <input
                type="number"
                min="1"
                max="256"
                value={workerThreads}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setWorkerThreads('' as any);
                  } else {
                    setWorkerThreads(Math.max(1, Math.min(256, parseInt(val) || 1)));
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value === '') {
                    setWorkerThreads(1);
                  }
                }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Batch Size</label>
              <input
                type="number"
                min="50"
                max="10000"
                value={batchSize}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setBatchSize('' as any);
                  } else {
                    setBatchSize(Math.max(50, Math.min(10000, parseInt(val) || 300)));
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value === '') {
                    setBatchSize(300);
                  }
                }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <Button
              onClick={handleUpdateConfig}
              disabled={updating}
              className="w-full"
              variant={updateSuccess ? "success" : "primary"}
            >
              {updating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Updating...
                </>
              ) : updateSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Settings Applied!
                </>
              ) : (
                <>
                  <Settings className="w-4 h-4" />
                  Apply Settings
                </>
              )}
            </Button>

            {updateSuccess && (
              <Alert variant="success">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm">Configuration updated successfully! Restart mining to apply changes.</span>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Recommendations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Worker Threads */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="w-6 h-6 text-blue-400" />
                Worker Threads
              </CardTitle>
              <CardDescription>
                Number of parallel mining threads
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <span className="text-gray-400">Current:</span>
                  <span className="text-2xl font-bold text-white">
                    {recommendations.workerThreads.current}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-green-900/20 border border-green-700/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-green-400 font-semibold">Optimal:</span>
                  </div>
                  <span className="text-2xl font-bold text-green-400">
                    {recommendations.workerThreads.optimal}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                  <span className="text-blue-400">Conservative:</span>
                  <span className="text-xl font-bold text-blue-400">
                    {recommendations.workerThreads.conservative}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-orange-900/20 border border-orange-700/50 rounded-lg">
                  <span className="text-orange-400">Maximum:</span>
                  <span className="text-xl font-bold text-orange-400">
                    {recommendations.workerThreads.max}
                  </span>
                </div>
              </div>

              <Alert variant="info">
                <Info className="w-4 h-4" />
                <span className="text-sm">{recommendations.workerThreads.explanation}</span>
              </Alert>

              <div className="text-xs text-gray-500 space-y-1">
                <p><strong>Location:</strong> lib/mining/orchestrator.ts:42</p>
                <p><strong>Variable:</strong> <code className="bg-gray-800 px-1 py-0.5 rounded">private workerThreads = 12;</code></p>
              </div>
            </CardContent>
          </Card>

          {/* Batch Size */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="w-6 h-6 text-purple-400" />
                Batch Size
              </CardTitle>
              <CardDescription>
                Number of hashes computed per batch
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <span className="text-gray-400">Current:</span>
                  <span className="text-2xl font-bold text-white">
                    {recommendations.batchSize.current}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-green-900/20 border border-green-700/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <span className="text-green-400 font-semibold">Optimal:</span>
                  </div>
                  <span className="text-2xl font-bold text-green-400">
                    {recommendations.batchSize.optimal}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                  <span className="text-blue-400">Conservative:</span>
                  <span className="text-xl font-bold text-blue-400">
                    {recommendations.batchSize.conservative}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-orange-900/20 border border-orange-700/50 rounded-lg">
                  <span className="text-orange-400">Maximum:</span>
                  <span className="text-xl font-bold text-orange-400">
                    {recommendations.batchSize.max}
                  </span>
                </div>
              </div>

              <Alert variant="info">
                <Info className="w-4 h-4" />
                <span className="text-sm">{recommendations.batchSize.explanation}</span>
              </Alert>

              <div className="text-xs text-gray-500 space-y-1">
                <p><strong>Location:</strong> lib/mining/orchestrator.ts:597</p>
                <p><strong>Variable:</strong> <code className="bg-gray-800 px-1 py-0.5 rounded">const BATCH_SIZE = 350;</code></p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Performance Notes */}
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-yellow-400" />
              Performance Tuning Tips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-300">
              {recommendations.performanceNotes.map((note, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Manual Configuration Instructions */}
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-400" />
              How to Apply Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-4 text-sm text-gray-300">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                  1
                </span>
                <div>
                  <p className="font-semibold text-white mb-1">Stop Mining</p>
                  <p className="text-gray-400">Make sure mining is stopped before making changes</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                  2
                </span>
                <div>
                  <p className="font-semibold text-white mb-1">Edit Orchestrator File</p>
                  <p className="text-gray-400 mb-2">Open: <code className="bg-gray-800 px-2 py-0.5 rounded">lib/mining/orchestrator.ts</code></p>
                  <div className="bg-gray-800 p-3 rounded-lg font-mono text-xs space-y-1">
                    <p className="text-gray-500">// Line 597</p>
                    <p className="text-green-400">const BATCH_SIZE = {recommendations.batchSize.optimal};</p>
                    <p className="text-gray-500 mt-2">// Line 42</p>
                    <p className="text-green-400">private workerThreads = {recommendations.workerThreads.optimal};</p>
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                  3
                </span>
                <div>
                  <p className="font-semibold text-white mb-1">Restart Application</p>
                  <p className="text-gray-400">Close and reopen the app to apply changes</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                  4
                </span>
                <div>
                  <p className="font-semibold text-white mb-1">Monitor Performance</p>
                  <p className="text-gray-400">Watch hash rate, CPU usage, and error logs to ensure stability</p>
                </div>
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
