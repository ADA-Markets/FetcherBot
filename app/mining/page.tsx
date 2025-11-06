'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Alert } from '@/components/ui/alert';
import { Play, Square, Home, Loader2, Activity, Clock, Target, Hash, CheckCircle2, Wallet, Terminal, ChevronDown, ChevronUp, Pause, Play as PlayIcon, Maximize2, Minimize2, Cpu, ListChecks, TrendingUp, TrendingDown, Calendar, Copy, Check, XCircle, Users, Award, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkerStats {
  workerId: number;
  addressIndex: number;
  address: string;
  hashesComputed: number;
  hashRate: number;
  solutionsFound: number;
  startTime: number;
  lastUpdateTime: number;
  status: 'idle' | 'mining' | 'submitting' | 'completed';
  currentChallenge: string | null;
}

interface MiningStats {
  active: boolean;
  challengeId: string | null;
  solutionsFound: number;
  registeredAddresses: number;
  totalAddresses: number;
  hashRate: number;
  uptime: number;
  startTime: number | null;
  cpuUsage: number;
  addressesProcessedCurrentChallenge: number;
  solutionsThisHour: number;
  solutionsPreviousHour: number;
  solutionsToday: number;
  solutionsYesterday: number;
  workerThreads: number;
}

interface LogEntry {
  timestamp: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

interface ReceiptEntry {
  ts: string;
  address: string;
  challenge_id: string;
  nonce: string;
  hash?: string;
}

interface ErrorEntry {
  ts: string;
  address: string;
  challenge_id: string;
  nonce: string;
  hash?: string;
  error: string;
}

interface HistoryData {
  receipts: ReceiptEntry[];
  errors: ErrorEntry[];
  summary: {
    totalSolutions: number;
    totalErrors: number;
    successRate: string;
  };
}

function MiningDashboardContent() {
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);

  const [stats, setStats] = useState<MiningStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationProgress, setRegistrationProgress] = useState<{
    current: number;
    total: number;
    currentAddress: string;
    message: string;
  } | null>(null);
  const [showLogs, setShowLogs] = useState(true);
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'success' | 'error' | 'warning'>('all');
  const [autoFollow, setAutoFollow] = useState(true); // Auto-scroll to bottom
  const [logHeight, setLogHeight] = useState<'small' | 'medium' | 'large'>('medium');
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'rewards' | 'workers'>('dashboard');
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'success' | 'error'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Workers state
  const [workers, setWorkers] = useState<Map<number, WorkerStats>>(new Map());

  // Rewards state
  const [rewardsData, setRewardsData] = useState<any | null>(null);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsView, setRewardsView] = useState<'hourly' | 'daily'>('daily');
  const [rewardsLastRefresh, setRewardsLastRefresh] = useState<number | null>(null);
  const [historyLastRefresh, setHistoryLastRefresh] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    // Retrieve password from sessionStorage
    const storedPassword = sessionStorage.getItem('walletPassword');
    if (!storedPassword) {
      // Redirect to wallet load page if no password found
      router.push('/wallet/load');
      return;
    }
    setPassword(storedPassword);

    // Check mining status on load
    checkStatus();
  }, []);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    // Only add logs if not paused
    if (!autoFollow) return;
    setLogs(prev => [...prev, { timestamp: Date.now(), message, type }].slice(-200)); // Keep last 200 logs
  };

  // Auto-scroll effect
  useEffect(() => {
    if (autoFollow && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoFollow]);

  useEffect(() => {
    if (!stats?.active) return;

    // Connect to SSE stream for real-time updates
    const eventSource = new EventSource('/api/mining/stream');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'stats') {
        setStats(data.stats);

        // Update registration status based on stats
        if (data.stats.registeredAddresses < data.stats.totalAddresses) {
          setIsRegistering(true);
        } else {
          setIsRegistering(false);
          setRegistrationProgress(null); // Clear progress when done
        }

        // Don't log generic stats - let the specific events (solution_submit, mining_start, etc.) handle logging
      } else if (data.type === 'registration_progress') {
        // Update registration progress state
        setRegistrationProgress({
          current: data.current,
          total: data.total,
          currentAddress: data.address,
          message: data.message,
        });

        // Log registration events
        if (data.success) {
          addLog(`✅ ${data.message}`, 'success');
        } else if (data.message.includes('Failed')) {
          addLog(`❌ ${data.message}`, 'error');
        } else {
          addLog(`🔄 ${data.message}`, 'info');
        }
      } else if (data.type === 'mining_start') {
        addLog(`🔨 Worker ${data.addressIndex}: Starting mining for challenge ${data.challengeId.slice(0, 12)}...`, 'info');
      } else if (data.type === 'hash_progress') {
        addLog(`⚡ Worker ${data.addressIndex}: ${data.hashesComputed.toLocaleString()} hashes computed`, 'info');
      } else if (data.type === 'solution_submit') {
        addLog(`💎 Worker ${data.addressIndex}: Solution found! Submitting nonce ${data.nonce}...`, 'success');
      } else if (data.type === 'solution_result') {
        if (data.success) {
          addLog(`✅ Solution for address ${data.addressIndex} ACCEPTED! ${data.message}`, 'success');
        } else {
          addLog(`❌ Solution for address ${data.addressIndex} REJECTED: ${data.message}`, 'error');
        }
      } else if (data.type === 'worker_update') {
        // Update worker stats
        setWorkers(prev => {
          const newWorkers = new Map(prev);
          newWorkers.set(data.workerId, {
            workerId: data.workerId,
            addressIndex: data.addressIndex,
            address: data.address,
            hashesComputed: data.hashesComputed,
            hashRate: data.hashRate,
            solutionsFound: data.solutionsFound,
            startTime: prev.get(data.workerId)?.startTime || Date.now(),
            lastUpdateTime: Date.now(),
            status: data.status,
            currentChallenge: data.currentChallenge,
          });
          return newWorkers;
        });
      } else if (data.type === 'error') {
        setError(data.message);
        addLog(`Error: ${data.message}`, 'error');
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      addLog('Stream connection closed', 'warning');
    };

    return () => {
      eventSource.close();
    };
  }, [stats?.active]);

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/mining/status');
      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (err: any) {
      console.error('Failed to check status:', err);
    }
  };

  const handleStartMining = async () => {
    if (!password) {
      setError('Password not provided');
      return;
    }

    setLoading(true);
    setError(null);
    setLogs([]); // Clear previous logs
    addLog('Initializing hash engine...', 'info');
    setIsRegistering(true);

    try {
      addLog('Loading wallet addresses...', 'info');
      const response = await fetch('/api/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start mining');
      }

      addLog('Mining started successfully', 'success');
      addLog(`Starting registration of ${data.stats.totalAddresses} addresses...`, 'info');
      setStats(data.stats);
    } catch (err: any) {
      setError(err.message);
      addLog(`Failed to start mining: ${err.message}`, 'error');
      setIsRegistering(false);
    } finally {
      setLoading(false);
    }
  };

  const handleStopMining = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/mining/stop', {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to stop mining');
      }

      await checkStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      const response = await fetch('/api/mining/history');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch history');
      }

      setHistory(data);
      setHistoryLastRefresh(Date.now());
    } catch (err: any) {
      console.error('Failed to fetch history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchRewards = async () => {
    try {
      setRewardsLoading(true);
      const response = await fetch('/api/stats');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch rewards');
      }

      setRewardsData(data.stats);
      setRewardsLastRefresh(Date.now());
    } catch (err: any) {
      console.error('Failed to fetch rewards:', err);
      addLog(`Failed to load rewards: ${err.message}`, 'error');
    } finally {
      setRewardsLoading(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const formatTimeSince = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((currentTime - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
  };

  const getFilteredEntries = () => {
    if (!history) return [];

    const allEntries: Array<{ type: 'success' | 'error'; data: ReceiptEntry | ErrorEntry }> = [
      ...history.receipts.map(r => ({ type: 'success' as const, data: r })),
      ...history.errors.map(e => ({ type: 'error' as const, data: e }))
    ];

    allEntries.sort((a, b) => new Date(b.data.ts).getTime() - new Date(a.data.ts).getTime());

    if (historyFilter === 'all') return allEntries;
    return allEntries.filter(e => e.type === historyFilter);
  };

  // Load history when switching to history tab and auto-refresh every 30 seconds
  useEffect(() => {
    if (activeTab === 'history') {
      // Initial fetch
      if (!history) {
        fetchHistory();
      }

      // Set up auto-refresh interval
      const intervalId = setInterval(() => {
        fetchHistory();
      }, 30000); // Refresh every 30 seconds

      // Cleanup interval when tab changes or component unmounts
      return () => clearInterval(intervalId);
    }
  }, [activeTab]);

  // Load rewards when switching to rewards tab
  useEffect(() => {
    if (activeTab === 'rewards' && !rewardsData) {
      fetchRewards();
    }
  }, [activeTab]);

  // Update refresh time display every second
  useEffect(() => {
    const interval = setInterval(() => {
      // Force re-render to update time display
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto" />
          <p className="text-lg text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen p-4 md:p-8 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/10 via-blue-900/10 to-gray-900 pointer-events-none" />
      <div className="absolute top-20 left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
              Mining Dashboard
            </h1>
            <div className="flex items-center gap-2">
              {stats.active ? (
                <>
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-green-400 font-semibold">Mining Active</span>
                </>
              ) : (
                <>
                  <div className="w-3 h-3 bg-gray-500 rounded-full" />
                  <span className="text-gray-400">Mining Stopped</span>
                </>
              )}
            </div>
          </div>
          <Button
            onClick={() => {
              // Clear password from sessionStorage when leaving
              sessionStorage.removeItem('walletPassword');
              router.push('/');
            }}
            variant="outline"
            size="md"
          >
            <Home className="w-4 h-4" />
            Back to Home
          </Button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              'px-6 py-3 font-medium transition-colors relative',
              activeTab === 'dashboard'
                ? 'text-blue-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            <Activity className="w-4 h-4 inline mr-2" />
            Dashboard
            {activeTab === 'dashboard' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              'px-6 py-3 font-medium transition-colors relative',
              activeTab === 'history'
                ? 'text-blue-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            <Calendar className="w-4 h-4 inline mr-2" />
            History
            {activeTab === 'history' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('rewards')}
            className={cn(
              'px-6 py-3 font-medium transition-colors relative',
              activeTab === 'rewards'
                ? 'text-blue-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            <TrendingUp className="w-4 h-4 inline mr-2" />
            Rewards
            {activeTab === 'rewards' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('workers')}
            className={cn(
              'px-6 py-3 font-medium transition-colors relative',
              activeTab === 'workers'
                ? 'text-blue-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            <Users className="w-4 h-4 inline mr-2" />
            Workers
            {activeTab === 'workers' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400" />
            )}
          </button>
        </div>

        {/* Error Display */}
        {error && <Alert variant="error">{error}</Alert>}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
        <>
        {/* Mining Control Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Mining Control Button */}
          <Card variant="elevated">
            <CardContent className="pt-6 pb-6">
              <div className="flex flex-col items-center gap-3">
                {!stats.active ? (
                  <Button
                    onClick={handleStartMining}
                    disabled={loading}
                    variant="success"
                    size="lg"
                    className="w-full"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Initializing...
                      </>
                    ) : (
                      <>
                        <Play className="w-5 h-5" />
                        Start Mining
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={handleStopMining}
                    disabled={loading}
                    variant="danger"
                    size="lg"
                    className="w-full"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Stopping...
                      </>
                    ) : (
                      <>
                        <Square className="w-5 h-5" />
                        Stop Mining
                      </>
                    )}
                  </Button>
                )}
                <p className="text-xs text-gray-500 text-center">
                  {stats.active
                    ? 'Stop all mining operations'
                    : `${stats.totalAddresses} addresses ready`}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Mining Status Card */}
          <StatCard
            label="Mining Status"
            value={stats.active ? "Active" : "Stopped"}
            icon={<Activity />}
            variant={stats.active ? "success" : "default"}
          />
        </div>

        {/* Stats Grid */}
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                label="Challenge ID"
                value={stats.challengeId ? stats.challengeId.slice(0, 16) + '...' : 'Waiting...'}
                icon={<Target />}
                variant="primary"
              />

              <StatCard
                label="Solutions Found"
                value={stats.solutionsFound}
                icon={<CheckCircle2 />}
                variant="success"
              />

              <StatCard
                label="Uptime"
                value={formatUptime(stats.uptime)}
                icon={<Clock />}
                variant="default"
              />

              <StatCard
                label="Hash Rate"
                value={stats.hashRate > 0 ? `${stats.hashRate.toFixed(2)} H/s` : 'Calculating...'}
                icon={<Hash />}
                variant={stats.hashRate > 0 ? 'primary' : 'default'}
              />

              <StatCard
                label="Registered Addresses"
                value={`${stats.registeredAddresses} / ${stats.totalAddresses}`}
                icon={<Wallet />}
                variant="default"
              />

              <StatCard
                label="CPU Usage"
                value={stats.cpuUsage != null ? `${stats.cpuUsage.toFixed(1)}%` : 'N/A'}
                icon={<Cpu />}
                variant={stats.cpuUsage != null && stats.cpuUsage > 80 ? 'warning' : 'default'}
              />

              <StatCard
                label="Worker Threads"
                value={stats.workerThreads.toString()}
                icon={<Activity />}
                variant="primary"
              />

              <StatCard
                label="Challenge Progress"
                value={`${stats.addressesProcessedCurrentChallenge} / ${stats.totalAddresses}`}
                icon={<ListChecks />}
                variant="default"
              />

              <StatCard
                label="Hourly Solutions"
                value={stats.solutionsThisHour.toString()}
                icon={<Clock />}
                variant={stats.solutionsThisHour > stats.solutionsPreviousHour ? 'success' : 'default'}
                trend={stats.solutionsThisHour > stats.solutionsPreviousHour ? 'up' : stats.solutionsThisHour < stats.solutionsPreviousHour ? 'down' : 'neutral'}
                trendValue={
                  stats.solutionsPreviousHour > 0
                    ? `${stats.solutionsThisHour > stats.solutionsPreviousHour ? '+' : ''}${stats.solutionsThisHour - stats.solutionsPreviousHour} vs last hour`
                    : 'Previous hour: 0'
                }
              />

              <StatCard
                label="Daily Solutions"
                value={stats.solutionsToday.toString()}
                icon={<Calendar />}
                variant={stats.solutionsToday > stats.solutionsYesterday ? 'success' : 'default'}
                trend={stats.solutionsToday > stats.solutionsYesterday ? 'up' : stats.solutionsToday < stats.solutionsYesterday ? 'down' : 'neutral'}
                trendValue={
                  stats.solutionsYesterday > 0
                    ? `${stats.solutionsToday > stats.solutionsYesterday ? '+' : ''}${stats.solutionsToday - stats.solutionsYesterday} vs yesterday`
                    : 'Yesterday: 0'
                }
              />
            </div>

            {/* Registration Progress Alert - Only show when mining is active */}
            {stats.active && isRegistering && stats.registeredAddresses < stats.totalAddresses && (
              <Alert variant="info" title="Registering Addresses">
                <div className="space-y-3">
                  <p>Registering mining addresses with the network...</p>

                  {/* Progress Bar */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-700 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-blue-500 h-full transition-all duration-300 ease-out"
                        style={{ width: `${(stats.registeredAddresses / stats.totalAddresses) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold tabular-nums">
                      {stats.registeredAddresses} / {stats.totalAddresses}
                    </span>
                  </div>

                  {/* Current Registration Status */}
                  {registrationProgress && (
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                      <span className="text-gray-300">{registrationProgress.message}</span>
                    </div>
                  )}

                  {/* Estimated Time Remaining */}
                  {registrationProgress && registrationProgress.total > 0 && (
                    <div className="text-xs text-gray-400">
                      {registrationProgress.current > 0 && (
                        <>
                          Estimated time remaining: ~
                          {Math.ceil(
                            (registrationProgress.total - registrationProgress.current) * 1.5
                          )}s
                          <span className="text-gray-500 ml-2">(~1.5s per address)</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </Alert>
            )}
            </>

            {/* Live Log Window - Only show when mining is active */}
            {stats.active && (
            <Card variant="bordered">
              <CardHeader>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-blue-400" />
                      Mining Log
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {/* Follow/Unfollow Toggle */}
                      <Button
                        variant={autoFollow ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setAutoFollow(!autoFollow)}
                        className="h-8 gap-1.5"
                        title={autoFollow ? "Auto-scroll enabled" : "Auto-scroll disabled"}
                      >
                        {autoFollow ? <PlayIcon className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        <span className="text-xs">{autoFollow ? 'Following' : 'Paused'}</span>
                      </Button>

                      {/* Size Toggle */}
                      <div className="flex gap-1 bg-gray-800 rounded p-1">
                        <button
                          onClick={() => setLogHeight('small')}
                          className={cn(
                            'px-2 py-1 rounded text-xs transition-colors',
                            logHeight === 'small' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
                          )}
                          title="Small (200px)"
                        >
                          S
                        </button>
                        <button
                          onClick={() => setLogHeight('medium')}
                          className={cn(
                            'px-2 py-1 rounded text-xs transition-colors',
                            logHeight === 'medium' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
                          )}
                          title="Medium (400px)"
                        >
                          M
                        </button>
                        <button
                          onClick={() => setLogHeight('large')}
                          className={cn(
                            'px-2 py-1 rounded text-xs transition-colors',
                            logHeight === 'large' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
                          )}
                          title="Large (600px)"
                        >
                          L
                        </button>
                      </div>

                      {/* Collapse Toggle */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowLogs(!showLogs)}
                        className="h-8 w-8 p-0"
                      >
                        {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  {showLogs && (
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => setLogFilter('all')}
                        className={cn(
                          'px-3 py-1 rounded text-xs font-medium transition-colors',
                          logFilter === 'all'
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        )}
                      >
                        All ({logs.length})
                      </button>
                      <button
                        onClick={() => setLogFilter('error')}
                        className={cn(
                          'px-3 py-1 rounded text-xs font-medium transition-colors',
                          logFilter === 'error'
                            ? 'bg-red-500 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        )}
                      >
                        Errors ({logs.filter(l => l.type === 'error').length})
                      </button>
                      <button
                        onClick={() => setLogFilter('warning')}
                        className={cn(
                          'px-3 py-1 rounded text-xs font-medium transition-colors',
                          logFilter === 'warning'
                            ? 'bg-yellow-500 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        )}
                      >
                        Warnings ({logs.filter(l => l.type === 'warning').length})
                      </button>
                      <button
                        onClick={() => setLogFilter('success')}
                        className={cn(
                          'px-3 py-1 rounded text-xs font-medium transition-colors',
                          logFilter === 'success'
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        )}
                      >
                        Success ({logs.filter(l => l.type === 'success').length})
                      </button>
                      <button
                        onClick={() => setLogFilter('info')}
                        className={cn(
                          'px-3 py-1 rounded text-xs font-medium transition-colors',
                          logFilter === 'info'
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        )}
                      >
                        Info ({logs.filter(l => l.type === 'info').length})
                      </button>
                    </div>
                  )}
                </div>
              </CardHeader>
              {showLogs && (
                <CardContent>
                  <div
                    ref={logContainerRef}
                    className={cn(
                      "bg-gray-950 rounded-lg p-4 overflow-y-auto font-mono text-sm space-y-1 scroll-smooth transition-all",
                      logHeight === 'small' && 'h-[200px]',
                      logHeight === 'medium' && 'h-[400px]',
                      logHeight === 'large' && 'h-[600px]'
                    )}
                  >
                    {logs.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">No logs yet. Start mining to see activity.</p>
                    ) : (
                      logs
                        .filter(log => logFilter === 'all' || log.type === logFilter)
                        .map((log, index) => (
                          <div key={index} className="flex items-start gap-2 animate-in fade-in duration-200">
                            <span className="text-gray-600 shrink-0">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span className={cn(
                              log.type === 'error' && 'text-red-400',
                              log.type === 'success' && 'text-green-400',
                              log.type === 'warning' && 'text-yellow-400',
                              log.type === 'info' && 'text-blue-400'
                            )}>
                              {log.message}
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
            )}

            {/* Additional Info Card - Only show when mining is active */}
            {stats.active && (
            <Card variant="bordered">
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2">
                  <Activity className="w-5 h-5 text-green-400" />
                  Mining Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-400 mb-1">Average Performance</p>
                    <p className="text-white font-semibold">
                      {stats.hashRate > 0 ? 'Normal' : 'Warming up...'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 mb-1">Registration Progress</p>
                    <p className="text-white font-semibold">
                      {Math.round((stats.registeredAddresses / stats.totalAddresses) * 100)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 mb-1">Solutions Rate</p>
                    <p className="text-white font-semibold">
                      {stats.uptime > 0
                        ? `${(stats.solutionsFound / (stats.uptime / 3600000)).toFixed(2)}/hr`
                        : 'Calculating...'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            )}
          </>
        )}


        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
              </div>
            ) : history ? (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatCard
                    label="Total Solutions"
                    value={history.summary.totalSolutions}
                    icon={<CheckCircle2 />}
                    variant="success"
                  />
                  <StatCard
                    label="Failed Submissions"
                    value={history.summary.totalErrors}
                    icon={<XCircle />}
                    variant={history.summary.totalErrors > 0 ? 'danger' : 'default'}
                  />
                  <StatCard
                    label="Success Rate"
                    value={history.summary.successRate}
                    icon={<TrendingUp />}
                    variant="primary"
                  />
                </div>

                {/* Filter Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setHistoryFilter('all')}
                    className={cn(
                      'px-4 py-2 rounded text-sm font-medium transition-colors',
                      historyFilter === 'all'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    )}
                  >
                    All ({history.receipts.length + history.errors.length})
                  </button>
                  <button
                    onClick={() => setHistoryFilter('success')}
                    className={cn(
                      'px-4 py-2 rounded text-sm font-medium transition-colors',
                      historyFilter === 'success'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    )}
                  >
                    Success ({history.receipts.length})
                  </button>
                  <button
                    onClick={() => setHistoryFilter('error')}
                    className={cn(
                      'px-4 py-2 rounded text-sm font-medium transition-colors',
                      historyFilter === 'error'
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    )}
                  >
                    Errors ({history.errors.length})
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      Last: {formatTimeSince(historyLastRefresh)}
                    </span>
                    <Button
                      onClick={fetchHistory}
                      variant="outline"
                      size="sm"
                    >
                      Refresh
                    </Button>
                  </div>
                </div>

                {/* History Entries */}
                <Card variant="bordered">
                  <CardHeader>
                    <CardTitle className="text-xl">Solution History</CardTitle>
                    <CardDescription>
                      Showing {getFilteredEntries().length} {historyFilter === 'all' ? 'entries' : historyFilter === 'success' ? 'successful solutions' : 'errors'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {getFilteredEntries().length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                          <Calendar className="w-16 h-16 mx-auto mb-4 opacity-50" />
                          <p className="text-lg">No mining history yet</p>
                          <p className="text-sm">Start mining to see your solutions here</p>
                        </div>
                      ) : (
                        getFilteredEntries().map((entry, index) => (
                          <div
                            key={index}
                            className={cn(
                              'p-4 rounded-lg border transition-colors',
                              entry.type === 'success'
                                ? 'bg-green-900/10 border-green-700/50'
                                : 'bg-red-900/10 border-red-700/50'
                            )}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-2">
                                  {entry.type === 'success' ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-red-400" />
                                  )}
                                  <span className="text-sm font-semibold text-white">
                                    {entry.type === 'success' ? 'Solution Accepted' : 'Submission Failed'}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {formatDate(entry.data.ts)}
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                  <div>
                                    <span className="text-gray-400">Address:</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-white font-mono text-xs">
                                        {entry.data.address.slice(0, 20)}...
                                      </span>
                                      <button
                                        onClick={() => copyToClipboard(entry.data.address, `addr-${index}`)}
                                        className="text-gray-400 hover:text-white transition-colors"
                                      >
                                        {copiedId === `addr-${index}` ? (
                                          <Check className="w-3 h-3 text-green-400" />
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-gray-400">Challenge:</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-white font-mono text-xs">
                                        {entry.data.challenge_id.slice(0, 16)}...
                                      </span>
                                      <button
                                        onClick={() => copyToClipboard(entry.data.challenge_id, `chal-${index}`)}
                                        className="text-gray-400 hover:text-white transition-colors"
                                      >
                                        {copiedId === `chal-${index}` ? (
                                          <Check className="w-3 h-3 text-green-400" />
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-gray-400">Nonce:</span>
                                    <span className="text-white font-mono text-xs ml-2">
                                      {entry.data.nonce}
                                    </span>
                                  </div>

                                  {entry.data.hash && (
                                    <div>
                                      <span className="text-gray-400">Hash:</span>
                                      <span className="text-white font-mono text-xs ml-2">
                                        {entry.data.hash.slice(0, 16)}...
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {entry.type === 'error' && (
                                  <div className="mt-2 p-2 bg-red-900/20 rounded text-xs">
                                    <span className="text-red-400 font-semibold">Error: </span>
                                    <span className="text-red-300">{(entry.data as ErrorEntry).error}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <p>No history data available</p>
              </div>
            )}
          </div>
        )}

        {/* Rewards Tab */}
        {activeTab === 'rewards' && (
          <div className="space-y-6">
            {rewardsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
              </div>
            ) : !rewardsData ? (
              <Card variant="bordered">
                <CardContent className="text-center py-12">
                  <p className="text-gray-400">No rewards data available yet</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* View Toggle */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setRewardsView('hourly')}
                    className={cn(
                      'px-4 py-2 rounded text-sm font-medium transition-colors',
                      rewardsView === 'hourly'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    )}
                  >
                    Hourly
                  </button>
                  <button
                    onClick={() => setRewardsView('daily')}
                    className={cn(
                      'px-4 py-2 rounded text-sm font-medium transition-colors',
                      rewardsView === 'daily'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    )}
                  >
                    Daily
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      Last: {formatTimeSince(rewardsLastRefresh)}
                    </span>
                    <Button
                      onClick={fetchRewards}
                      variant="outline"
                      size="sm"
                    >
                      Refresh
                    </Button>
                  </div>
                </div>

                {/* Hourly View */}
                {rewardsView === 'hourly' && rewardsData.last8Hours && (
                  <Card variant="bordered">
                    <CardHeader>
                      <CardTitle className="text-xl">Last 8 Hours Rewards</CardTitle>
                      <CardDescription>
                        Hourly breakdown of mining rewards
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="border-b border-gray-700">
                            <tr className="text-gray-400 text-sm">
                              <th className="py-3 px-4">Hour</th>
                              <th className="py-3 px-4">Receipts</th>
                              <th className="py-3 px-4">Addresses</th>
                              <th className="py-3 px-4">STAR</th>
                              <th className="py-3 px-4">NIGHT</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-700">
                            {rewardsData.last8Hours.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="py-8 text-center text-gray-500">
                                  No hourly data available yet
                                </td>
                              </tr>
                            ) : (
                              rewardsData.last8Hours.map((hourData: any, index: number) => {
                                const hourStart = new Date(hourData.hour);
                                const hourEnd = new Date(hourStart.getTime() + 3600000);

                                return (
                                  <tr key={index} className="text-white hover:bg-gray-800/30">
                                    <td className="py-3 px-4 text-gray-300">
                                      <div className="text-sm">
                                        {hourStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        {' - '}
                                        {hourEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {hourStart.toLocaleDateString()}
                                      </div>
                                    </td>
                                    <td className="py-3 px-4">{hourData.receipts.toLocaleString()}</td>
                                    <td className="py-3 px-4">{hourData.addresses}</td>
                                    <td className="py-3 px-4 text-blue-400">{hourData.star.toLocaleString()}</td>
                                    <td className="py-3 px-4 text-purple-400">{hourData.night.toFixed(6)}</td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Daily View */}
                {rewardsView === 'daily' && rewardsData.global && (
                  <>
                    {/* Grand Total */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <StatCard
                        label="Total Receipts"
                        value={rewardsData.global.grandTotal.receipts.toLocaleString()}
                        icon={<CheckCircle2 />}
                        variant="success"
                      />
                      <StatCard
                        label="Total STAR"
                        value={rewardsData.global.grandTotal.star.toLocaleString()}
                        icon={<TrendingUp />}
                        variant="primary"
                      />
                      <StatCard
                        label="Total NIGHT"
                        value={rewardsData.global.grandTotal.night.toFixed(6)}
                        icon={<Target />}
                        variant="default"
                      />
                    </div>

                    {/* Daily Breakdown Table */}
                    <Card variant="bordered">
                      <CardHeader>
                        <CardTitle className="text-xl">Daily Breakdown</CardTitle>
                        <CardDescription>
                          STAR and NIGHT rewards by day
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left">
                            <thead className="border-b border-gray-700">
                              <tr className="text-gray-400 text-sm">
                                <th className="py-3 px-4">Day</th>
                                <th className="py-3 px-4">Date</th>
                                <th className="py-3 px-4">Receipts</th>
                                <th className="py-3 px-4">Addresses</th>
                                <th className="py-3 px-4">STAR</th>
                                <th className="py-3 px-4">NIGHT</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                              {rewardsData.global.days.map((day: any) => (
                                <tr key={day.day} className="text-white hover:bg-gray-800/30">
                                  <td className="py-3 px-4 font-medium">{day.day}</td>
                                  <td className="py-3 px-4 text-gray-400">{day.date}</td>
                                  <td className="py-3 px-4">{day.receipts.toLocaleString()}</td>
                                  <td className="py-3 px-4">{day.addresses || 0}</td>
                                  <td className="py-3 px-4 text-blue-400">{day.star.toLocaleString()}</td>
                                  <td className="py-3 px-4 text-purple-400">{day.night.toFixed(6)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {rewardsData.global.days.length === 0 && (
                            <div className="text-center py-12 text-gray-500">
                              No daily data available yet
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Workers Tab */}
        {activeTab === 'workers' && (
          <div className="space-y-6">
            {workers.size === 0 ? (
              <Card variant="bordered">
                <CardContent className="text-center py-12">
                  <Users className="w-16 h-16 mx-auto mb-4 opacity-50 text-gray-500" />
                  <p className="text-gray-400 text-lg mb-2">No active workers</p>
                  <p className="text-gray-500 text-sm">Workers will appear here when mining starts</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Workers Summary */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <StatCard
                    label="Total Workers"
                    value={`${workers.size} / ${stats?.workerThreads || 10}`}
                    icon={<Users />}
                    variant="success"
                  />
                  <StatCard
                    label="Total Hashes"
                    value={Array.from(workers.values()).reduce((sum, w) => sum + w.hashesComputed, 0).toLocaleString()}
                    icon={<Hash />}
                    variant="primary"
                  />
                  <StatCard
                    label="Avg Hash Rate"
                    value={`${Math.round(Array.from(workers.values()).reduce((sum, w) => sum + w.hashRate, 0) / workers.size).toLocaleString()} H/s`}
                    icon={<Zap />}
                    variant="default"
                  />
                  <StatCard
                    label="Solutions Found"
                    value={Array.from(workers.values()).reduce((sum, w) => sum + w.solutionsFound, 0)}
                    icon={<Award />}
                    variant="success"
                  />
                </div>

                {/* Workers Race View */}
                <Card variant="bordered">
                  <CardHeader>
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-400" />
                      Worker Performance Race
                    </CardTitle>
                    <CardDescription>
                      Real-time worker performance tracking - fastest workers at the top
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {Array.from(workers.values())
                        .sort((a, b) => {
                          // Sort by solutions found (descending) - winners always on top
                          if (b.solutionsFound !== a.solutionsFound) {
                            return b.solutionsFound - a.solutionsFound;
                          }
                          // Then by worker ID for stable sort (no jumping)
                          return a.workerId - b.workerId;
                        })
                        .map((worker, index) => {
                          const maxHashes = Math.max(...Array.from(workers.values()).map(w => w.hashesComputed));
                          const percentage = maxHashes > 0 ? (worker.hashesComputed / maxHashes) * 100 : 0;
                          const uptime = Date.now() - worker.startTime;
                          const uptimeSeconds = Math.floor(uptime / 1000);

                          return (
                            <div
                              key={worker.workerId}
                              className={cn(
                                'p-4 rounded-lg border transition-all duration-300',
                                worker.status === 'mining' && 'bg-blue-900/10 border-blue-700/50',
                                worker.status === 'submitting' && 'bg-yellow-900/10 border-yellow-700/50 animate-pulse',
                                worker.status === 'completed' && 'bg-green-900/10 border-green-700/50',
                                worker.status === 'idle' && 'bg-gray-900/10 border-gray-700/50'
                              )}
                            >
                              <div className="flex items-center gap-4">
                                {/* Rank Badge */}
                                <div className={cn(
                                  'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg',
                                  index === 0 && 'bg-yellow-500/20 text-yellow-400 border-2 border-yellow-500',
                                  index === 1 && 'bg-gray-400/20 text-gray-300 border-2 border-gray-400',
                                  index === 2 && 'bg-orange-500/20 text-orange-400 border-2 border-orange-500',
                                  index > 2 && 'bg-gray-700 text-gray-400'
                                )}>
                                  {index === 0 && '🥇'}
                                  {index === 1 && '🥈'}
                                  {index === 2 && '🥉'}
                                  {index > 2 && `#${index + 1}`}
                                </div>

                                {/* Worker Info */}
                                <div className="flex-1 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <span className="text-white font-semibold">Worker {worker.workerId}</span>
                                      <span className={cn(
                                        'px-2 py-1 rounded text-xs font-medium',
                                        worker.status === 'mining' && 'bg-blue-500/20 text-blue-400',
                                        worker.status === 'submitting' && 'bg-yellow-500/20 text-yellow-400',
                                        worker.status === 'completed' && 'bg-green-500/20 text-green-400',
                                        worker.status === 'idle' && 'bg-gray-500/20 text-gray-400'
                                      )}>
                                        {worker.status === 'mining' && '⚡ Mining'}
                                        {worker.status === 'submitting' && '📤 Submitting'}
                                        {worker.status === 'completed' && '✅ Completed'}
                                        {worker.status === 'idle' && '💤 Idle'}
                                      </span>
                                      {worker.solutionsFound > 0 && (
                                        <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
                                          🏆 {worker.solutionsFound} solution{worker.solutionsFound > 1 ? 's' : ''}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-right">
                                      <div className="text-sm text-gray-400">Address #{worker.addressIndex}</div>
                                      <div className="text-xs text-gray-500 font-mono">
                                        {worker.address.slice(0, 12)}...
                                      </div>
                                    </div>
                                  </div>

                                  {/* Progress Bar */}
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-gray-400">
                                      <span>{worker.hashesComputed.toLocaleString()} hashes</span>
                                      <span>{worker.hashRate.toLocaleString()} H/s</span>
                                    </div>
                                    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                                      <div
                                        className={cn(
                                          'h-full transition-all duration-500',
                                          worker.status === 'mining' && 'bg-gradient-to-r from-blue-500 to-cyan-400',
                                          worker.status === 'submitting' && 'bg-gradient-to-r from-yellow-500 to-orange-400',
                                          worker.status === 'completed' && 'bg-gradient-to-r from-green-500 to-emerald-400',
                                          worker.status === 'idle' && 'bg-gray-600'
                                        )}
                                        style={{ width: `${percentage}%` }}
                                      />
                                    </div>
                                  </div>

                                  {/* Stats Row */}
                                  <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div>
                                      <span className="text-gray-500">Uptime: </span>
                                      <span className="text-gray-300">{uptimeSeconds}s</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Avg: </span>
                                      <span className="text-gray-300">
                                        {uptimeSeconds > 0 ? Math.round(worker.hashesComputed / uptimeSeconds).toLocaleString() : '0'} H/s
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Challenge: </span>
                                      <span className="text-gray-300 font-mono">
                                        {worker.currentChallenge ? worker.currentChallenge.slice(0, 8) + '...' : 'N/A'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MiningDashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="text-xl">Loading...</div></div>}>
      <MiningDashboardContent />
    </Suspense>
  );
}
