'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Alert } from '@/components/ui/alert';
import { ArrowLeft, CheckCircle2, XCircle, Calendar, TrendingUp, Loader2, Copy, Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CryptoReceipt {
  preimage: string;
  timestamp: string;
  signature: string;
}

interface ReceiptEntry {
  ts: string;
  address: string;
  challenge_id: string;
  nonce: string;
  hash?: string;
  crypto_receipt?: CryptoReceipt;
}

interface ErrorEntry {
  ts: string;
  address: string;
  challenge_id: string;
  nonce: string;
  hash?: string;
  error: string;
  response?: any;
}

interface HistoryData {
  receipts: ReceiptEntry[];
  errors: ErrorEntry[];
  summary: {
    totalSolutions: number;
    totalErrors: number;
    totalRetryAttempts?: number;
    successRate: string;
    recentFailureCount?: number;
  };
}

export default function MiningHistory() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [retryAllResult, setRetryAllResult] = useState<{ succeeded: number; failed: number } | null>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/mining/history');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch history');
      }

      setHistory(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
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

  const retrySubmission = async (errorEntry: ErrorEntry, id: string) => {
    setRetryingId(id);
    setRetryResult(null);

    try {
      const response = await fetch('/api/mining/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: errorEntry.address,
          challengeId: errorEntry.challenge_id,
          nonce: errorEntry.nonce,
          hash: errorEntry.hash || '',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setRetryResult({ id, success: true, message: 'Solution resubmitted successfully!' });
        // Refresh history after successful retry
        setTimeout(() => {
          fetchHistory();
          setRetryResult(null);
        }, 2000);
      } else {
        setRetryResult({ id, success: false, message: data.error || 'Retry failed' });
        setTimeout(() => setRetryResult(null), 5000);
      }
    } catch (err: any) {
      setRetryResult({ id, success: false, message: err.message || 'Retry failed' });
      setTimeout(() => setRetryResult(null), 5000);
    } finally {
      setRetryingId(null);
    }
  };

  const retryAllFailures = async () => {
    setRetryingAll(true);
    setRetryAllResult(null);

    try {
      const response = await fetch('/api/mining/retry-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success) {
        setRetryAllResult({
          succeeded: data.summary?.succeeded || 0,
          failed: data.summary?.failed || 0,
        });
        // Refresh history after retry
        setTimeout(() => {
          fetchHistory();
          setRetryAllResult(null);
        }, 3000);
      } else {
        setError(data.error || 'Retry all failed');
      }
    } catch (err: any) {
      setError(err.message || 'Retry all failed');
    } finally {
      setRetryingAll(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getFilteredEntries = () => {
    if (!history) return [];

    const allEntries: Array<{ type: 'success' | 'error'; data: ReceiptEntry | ErrorEntry }> = [
      ...history.receipts.map(r => ({ type: 'success' as const, data: r })),
      ...history.errors.map(e => ({ type: 'error' as const, data: e }))
    ];

    // Sort by timestamp
    allEntries.sort((a, b) => new Date(b.data.ts).getTime() - new Date(a.data.ts).getTime());

    if (filter === 'all') return allEntries;
    return allEntries.filter(e => e.type === filter);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto" />
          <p className="text-lg text-gray-400">Loading mining history...</p>
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
              Mining History
            </h1>
            <p className="text-gray-400">View all mining solutions and submission history</p>
          </div>
          <Button
            onClick={() => router.push('/mining')}
            variant="outline"
            size="md"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Button>
        </div>

        {/* Error Display */}
        {error && <Alert variant="error">{error}</Alert>}

        {/* Summary Stats */}
        {history && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Total Solutions"
              value={history.summary.totalSolutions}
              icon={<CheckCircle2 />}
              variant="success"
            />
            <div className="relative">
              <StatCard
                label="Failed Submissions"
                value={history.summary.totalErrors}
                icon={<XCircle />}
                variant={history.summary.totalErrors > 0 ? 'danger' : 'default'}
              />
              {/* Retry All Button - show if there are recent failures */}
              {(history.summary.recentFailureCount || 0) > 0 && (
                <div className="mt-2">
                  <button
                    onClick={retryAllFailures}
                    disabled={retryingAll}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors',
                      retryingAll
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-orange-600 hover:bg-orange-500 text-white'
                    )}
                  >
                    {retryingAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Retrying {history.summary.recentFailureCount} solutions...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Retry All ({history.summary.recentFailureCount} in last 24h)
                      </>
                    )}
                  </button>
                  {retryAllResult && (
                    <div className="mt-2 p-2 rounded text-xs bg-gray-800 text-center">
                      <span className="text-green-400">{retryAllResult.succeeded} succeeded</span>
                      {retryAllResult.failed > 0 && (
                        <span className="text-red-400 ml-2">{retryAllResult.failed} failed</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <StatCard
              label="Success Rate"
              value={history.summary.successRate}
              icon={<TrendingUp />}
              variant="primary"
            />
          </div>
        )}

        {/* Filter Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={cn(
              'px-4 py-2 rounded text-sm font-medium transition-colors',
              filter === 'all'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            )}
          >
            All ({history ? history.receipts.length + history.errors.length : 0})
          </button>
          <button
            onClick={() => setFilter('success')}
            className={cn(
              'px-4 py-2 rounded text-sm font-medium transition-colors',
              filter === 'success'
                ? 'bg-green-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            )}
          >
            Success ({history?.receipts.length || 0})
          </button>
          <button
            onClick={() => setFilter('error')}
            className={cn(
              'px-4 py-2 rounded text-sm font-medium transition-colors',
              filter === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            )}
          >
            Errors ({history?.errors.length || 0})
          </button>
        </div>

        {/* History Entries */}
        <Card variant="bordered">
          <CardHeader>
            <CardTitle className="text-xl">Solution History</CardTitle>
            <CardDescription>
              Showing {getFilteredEntries().length} {filter === 'all' ? 'entries' : filter === 'success' ? 'successful solutions' : 'errors'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
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

                        {entry.type === 'success' && (entry.data as ReceiptEntry).crypto_receipt && (
                          <div className="mt-2 text-xs text-green-400">
                            ✓ Crypto receipt received
                          </div>
                        )}

                        {/* Retry result message */}
                        {retryResult && retryResult.id === `error-${index}` && (
                          <div className={cn(
                            'mt-2 p-2 rounded text-xs',
                            retryResult.success
                              ? 'bg-green-900/30 text-green-400'
                              : 'bg-red-900/30 text-red-400'
                          )}>
                            {retryResult.success ? '✓ ' : '✗ '}{retryResult.message}
                          </div>
                        )}
                      </div>

                      {/* Retry button for errors */}
                      {entry.type === 'error' && (
                        <div className="flex-shrink-0">
                          <button
                            onClick={() => retrySubmission(entry.data as ErrorEntry, `error-${index}`)}
                            disabled={retryingId === `error-${index}`}
                            className={cn(
                              'flex items-center gap-2 px-3 py-2 rounded text-xs font-medium transition-colors',
                              retryingId === `error-${index}`
                                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                : 'bg-orange-600 hover:bg-orange-500 text-white'
                            )}
                          >
                            {retryingId === `error-${index}` ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Retrying...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-3 h-3" />
                                Retry
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
