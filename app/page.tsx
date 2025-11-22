'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, Plus, LogIn, Loader2, Sparkles, Shield, Zap, ChevronRight, Github, BookOpen, Cpu, Server } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

interface ActiveProfile {
  id: string;
  name: string;
  fullName: string;
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
}

export default function Home() {
  const router = useRouter();
  const [walletExists, setWalletExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [activeProfile, setActiveProfile] = useState<ActiveProfile | null>(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Check if user wants to see profile selector on first launch
      const skipProfileSelect = sessionStorage.getItem('skipProfileSelect');

      // Initialize profile system first
      await fetch('/api/init');

      // Load active profile for branding
      const profileRes = await fetch('/api/profile');
      const profileData = await profileRes.json();
      if (profileData.success && profileData.profile) {
        setActiveProfile(profileData.profile);
      }

      // If first time user and hasn't explicitly skipped, optionally redirect to profile selector
      // For now, we'll let users access it via the "Switch Project" button
      // To enable first-launch redirect, uncomment:
      // if (!skipProfileSelect && !walletExists) {
      //   router.push('/select-profile');
      //   return;
      // }

      // Then check wallet status
      const response = await fetch('/api/wallet/status');
      const data = await response.json();
      setWalletExists(data.exists);
    } catch (error) {
      console.error('Failed to initialize app:', error);
    } finally {
      setLoading(false);
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
          <p className="text-lg text-gray-400 animate-pulse">Initializing...</p>
        </div>
      </div>
    );
  }

  // Use active profile for branding, fallback to defaults
  const profileName = activeProfile?.name || 'Defensio';
  const profileFullName = activeProfile?.fullName || 'Defensio Fetcher Bot';
  const profileDescription = activeProfile?.branding?.description || 'Mining application for Defensio DFO';

  const features = [
    {
      icon: Shield,
      title: 'Military-Grade Security',
      description: 'AES-256-GCM encryption protects your wallet',
      color: 'blue',
      gradient: 'from-blue-500 to-cyan-500'
    },
    {
      icon: Zap,
      title: 'Lightning Fast',
      description: 'Native Rust engine for peak performance',
      color: 'yellow',
      gradient: 'from-yellow-500 to-orange-500'
    },
    {
      icon: Wallet,
      title: '200+ Addresses',
      description: 'Maximize mining opportunities',
      color: 'green',
      gradient: 'from-green-500 to-emerald-500'
    },
    {
      icon: Cpu,
      title: 'Smart Scaling',
      description: 'Auto-optimize for your hardware',
      color: 'purple',
      gradient: 'from-purple-500 to-pink-500'
    },
    {
      icon: Server,
      title: 'Multi-Worker',
      description: 'Parallel mining with 12 workers',
      color: 'indigo',
      gradient: 'from-indigo-500 to-blue-500'
    },
    {
      icon: Sparkles,
      title: 'Real-Time Stats',
      description: 'Live monitoring and analytics',
      color: 'pink',
      gradient: 'from-pink-500 to-rose-500'
    }
  ];

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
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">{profileName} Fetcher</h2>
                <p className="text-gray-400 text-xs">Mining Platform</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => router.push('/select-profile')}
                variant="ghost"
                size="sm"
                className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Switch Project
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <BookOpen className="w-4 h-4 mr-2" />
                Docs
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <Github className="w-4 h-4 mr-2" />
                GitHub
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-7xl w-full space-y-6">

            {/* Hero Section */}
            <div className="text-center space-y-2 animate-fade-in">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-300 text-sm font-medium backdrop-blur-sm hover:bg-blue-500/20 transition-all">
                <Sparkles className="w-4 h-4 animate-pulse" />
                <span>Multi-Project Mining Platform</span>
                <ChevronRight className="w-3 h-3" />
              </div>

              <div className="space-y-1">
                <h1 className="text-5xl font-black tracking-tight">
                  <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent animate-gradient-x">
                    {profileFullName}
                  </span>
                </h1>

              </div>
            </div>

            {/* Main Action Card - Moved BEFORE features */}
            <div className="max-w-2xl mx-auto">
              <Card className="border-gray-800 bg-gray-900/80 backdrop-blur-xl shadow-2xl hover:shadow-blue-500/10 transition-all duration-300">
                <CardHeader className="text-center space-y-2 pb-4">
                  <CardTitle className="text-4xl font-bold">
                    {walletExists ? (
                      <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                        Welcome Back
                      </span>
                    ) : (
                      <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                        Get Started
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription className="text-base text-gray-400">
                    {walletExists
                      ? 'Load your wallet to access the mining dashboard and start earning'
                      : 'Create your first wallet to begin your mining journey'}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4 px-6 pb-6">
                  {walletExists ? (
                    <>
                      <Button
                        onClick={() => router.push('/wallet/load')}
                        variant="primary"
                        size="lg"
                        className="w-full group relative overflow-hidden"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <LogIn className="w-5 h-5 relative z-10 group-hover:scale-110 transition-transform" />
                        <span className="relative z-10">Load Existing Wallet</span>
                        <ChevronRight className="w-5 h-5 relative z-10 ml-2 group-hover:translate-x-1 transition-transform" />
                      </Button>

                      <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                        <Shield className="w-4 h-4" />
                        <span>Your wallet is encrypted and secure</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={() => router.push('/wallet/create')}
                        variant="success"
                        size="lg"
                        className="w-full group relative overflow-hidden"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-green-600 to-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <Plus className="w-5 h-5 relative z-10 group-hover:rotate-90 transition-transform" />
                        <span className="relative z-10">Create New Wallet</span>
                        <ChevronRight className="w-5 h-5 relative z-10 ml-2 group-hover:translate-x-1 transition-transform" />
                      </Button>

                      <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                        <Wallet className="w-4 h-4" />
                        <span>Generate 200 mining addresses instantly</span>
                      </div>
                    </>
                  )}
                </CardContent>

                {walletExists && (
                  <CardFooter className="flex-col space-y-3 bg-gray-800/30 border-t border-gray-800 rounded-b-lg">
                    <Alert variant="warning" className="w-full text-sm">
                      <Sparkles className="w-4 h-4" />
                      <span>Creating a new wallet requires backing up a new seed phrase</span>
                    </Alert>
                    <Button
                      onClick={() => router.push('/wallet/create')}
                      variant="ghost"
                      size="md"
                      className="w-full group"
                    >
                      <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                      Create New Wallet Instead
                      <ChevronRight className="w-4 h-4 ml-auto group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </CardFooter>
                )}
              </Card>
            </div>

          </div>
        </main>

        {/* Footer */}
        <footer className="p-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <span>Made with</span>
                <span className="text-red-400 animate-pulse">♥</span>
                <span>by the community</span>
              </div>

              <div className="flex items-center gap-4">
                <span>Powered by</span>
                <span className="text-blue-400 font-semibold">Paul & Paddy</span>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span>All systems operational</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
