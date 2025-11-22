'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Sparkles, Check, ChevronRight, Clock, XCircle, RefreshCw, Globe, ExternalLink, AlertTriangle, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Profile {
  id: string;
  name: string;
  fullName: string;
  status?: 'active' | 'ended' | 'upcoming';
  token: {
    ticker: string;
    name: string;
  };
  branding: {
    colors: {
      primary: string;
      secondary: string;
      accent: string;
    };
    description: string;
  };
  api: {
    baseUrl: string;
  };
}

export default function SelectProfilePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [hoveredProfile, setHoveredProfile] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      // Load all available profiles
      const profilesRes = await fetch('/api/profiles');
      const profilesData = await profilesRes.json();

      if (profilesData.success) {
        setProfiles(profilesData.profiles);
      }

      // Load active profile
      const activeRes = await fetch('/api/profile');
      const activeData = await activeRes.json();

      if (activeData.success && activeData.profile) {
        setActiveProfile(activeData.profile.id);
      }
    } catch (error) {
      console.error('Failed to load profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectProfile = async (profileId: string) => {
    setSelecting(profileId);

    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profileId }),
      });

      const data = await response.json();

      if (data.success) {
        setActiveProfile(profileId);

        // Wait a moment to show success state, then redirect
        setTimeout(() => {
          router.push('/');
        }, 800);
      } else {
        console.error('Failed to set profile:', data.error);
        setSelecting(null);
      }
    } catch (error) {
      console.error('Error selecting profile:', error);
      setSelecting(null);
    }
  };

  const refreshProfiles = async () => {
    setRefreshing(true);
    setRefreshMessage(null);

    try {
      const response = await fetch('/api/profiles/refresh', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        setRefreshMessage({
          type: 'success',
          text: data.message || `Refreshed ${data.saved} profiles`,
        });
        // Reload profiles after refresh
        await loadProfiles();
      } else {
        setRefreshMessage({
          type: 'error',
          text: data.error || 'Failed to refresh profiles',
        });
      }
    } catch (error: any) {
      console.error('Error refreshing profiles:', error);
      setRefreshMessage({
        type: 'error',
        text: 'Failed to connect to remote server',
      });
    } finally {
      setRefreshing(false);
      // Clear message after 5 seconds
      setTimeout(() => setRefreshMessage(null), 5000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-blue-900/20">
        <div className="text-center space-y-4">
          <div className="relative">
            <Loader2 className="w-16 h-16 animate-spin text-blue-500 mx-auto" />
            <div className="absolute inset-0 w-16 h-16 bg-blue-500/20 rounded-full blur-xl mx-auto animate-pulse" />
          </div>
          <p className="text-lg text-gray-400 animate-pulse">Loading profiles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-blue-900/20">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-blob" />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-blob animation-delay-4000" />
      </div>

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5 pointer-events-none" />

      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <header className="p-6">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">Multi-Project Miner</h2>
                <p className="text-gray-400 text-xs">Select Your Project</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshProfiles}
              disabled={refreshing}
              className="gap-2 border-gray-700 hover:bg-gray-800"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              {refreshing ? 'Refreshing...' : 'Refresh Projects'}
            </Button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-3xl w-full space-y-6">
            {/* Title Section */}
            <div className="text-center space-y-2">
              <h1 className="text-4xl font-bold tracking-tight">
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Choose Your Project
                </span>
              </h1>
              <p className="text-gray-400">
                Select a project to mine. You can switch anytime.
              </p>
            </div>

            {/* Refresh Message */}
            {refreshMessage && (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm",
                  refreshMessage.type === 'success'
                    ? "bg-green-500/20 border border-green-500/30 text-green-400"
                    : "bg-red-500/20 border border-red-500/30 text-red-400"
                )}
              >
                {refreshMessage.type === 'success' ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                {refreshMessage.text}
              </div>
            )}

            {/* Active Projects Section */}
            {profiles.filter(p => p.status !== 'ended').length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-green-400" />
                  Active Projects
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {profiles.filter(p => p.status !== 'ended').map((profile) => {
                    const isActive = activeProfile === profile.id;
                    const isSelecting = selecting === profile.id;
                    const primaryColor = profile.branding?.colors?.primary || '#3B82F6';
                    const secondaryColor = profile.branding?.colors?.secondary || '#8B5CF6';

                    return (
                      <Card
                        key={profile.id}
                        className={cn(
                          "border bg-gray-900/80 backdrop-blur-xl transition-all duration-200 cursor-pointer relative overflow-hidden group",
                          isActive
                            ? "border-green-500 shadow-lg shadow-green-500/20"
                            : "border-gray-800 hover:border-gray-600",
                          isSelecting && "scale-98 opacity-50"
                        )}
                        onClick={() => !isSelecting && selectProfile(profile.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            {/* Icon */}
                            <div
                              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                              style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
                            >
                              <Sparkles className="w-6 h-6 text-white" />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-white text-lg">{profile.name}</h3>
                                <span className="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">
                                  {profile.token.ticker}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500 truncate">
                                {profile.api?.baseUrl ? new URL(profile.api.baseUrl).hostname : 'N/A'}
                              </p>
                            </div>

                            {/* Status */}
                            {isActive ? (
                              <div className="flex items-center gap-1 px-2 py-1 bg-green-500/20 border border-green-500/30 rounded-full">
                                <Check className="w-3 h-3 text-green-400" />
                                <span className="text-green-400 text-xs font-medium">Active</span>
                              </div>
                            ) : (
                              <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-gray-400 transition-colors" />
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ended Projects Section */}
            {profiles.filter(p => p.status === 'ended').length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-500" />
                  Ended Projects
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {profiles.filter(p => p.status === 'ended').map((profile) => {
                    return (
                      <Card
                        key={profile.id}
                        className="border border-gray-800 bg-gray-900/50 relative overflow-hidden opacity-60"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            {/* Icon - greyed out */}
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-gray-800">
                              <Sparkles className="w-6 h-6 text-gray-600" />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-gray-400 text-lg">{profile.name}</h3>
                                <span className="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-500">
                                  {profile.token.ticker}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 truncate">
                                Mining period has ended
                              </p>
                            </div>

                            {/* Ended badge */}
                            <div className="flex items-center gap-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded-full">
                              <XCircle className="w-3 h-3 text-gray-500" />
                              <span className="text-gray-500 text-xs font-medium">Ended</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DYOR Warning */}
            <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm text-yellow-300 font-medium">Do Your Own Research (DYOR)</p>
                  <p className="text-xs text-yellow-200/80 leading-relaxed">
                    These projects have been added based on community requests. We do not perform due diligence on any of the mining projects listed here.
                    It is your responsibility to research and evaluate each project before deciding to mine.
                    By using this application, you acknowledge that you understand the risks involved.
                  </p>
                </div>
              </div>
            </div>

            {/* Community Info */}
            <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-3">
                  <MessageCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-blue-300 font-medium">Want another project added?</p>
                    <p className="text-xs text-blue-200/70">
                      Join our Discord community to request new mining projects or get support.
                    </p>
                  </div>
                </div>
                <a
                  href="https://ada.markets/discord"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#5865F2] hover:bg-[#4752C4] text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  Join Ada Markets Discord
                </a>
              </div>
            </div>

            {/* Footer Note */}
            <div className="text-center text-sm text-gray-500 pt-2">
              <p>Each project has isolated storage for wallets, receipts, and configurations.</p>
              <p className="mt-1">You can switch between projects at any time from the settings.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
