/**
 * Project Profile Configuration
 * Defines the structure for project-specific settings
 */

export interface ProjectProfile {
  // Project Identity
  id: string;                    // Unique ID (e.g., "midnight", "defensio")
  name: string;                  // Display name (e.g., "Midnight", "Defensio")
  fullName: string;              // Full display name (e.g., "Midnight Fetcher Bot")
  status?: 'active' | 'ended' | 'upcoming';  // Project status (default: active)

  // API Configuration
  api: {
    baseUrl: string;             // e.g., "https://mine.defensio.io/api"
    endpoints?: {                // Optional custom endpoints (defaults provided)
      challenge?: string;        // Default: "/work/current"
      register?: string;         // Default: "/register/{address}/{signature}/{publicKey}"
      termsAndConditions?: string; // Default: "/TandC"
      submit?: string;           // Default: "/work/submit"
      rates?: string;            // Default: "/work_to_star_rate"
      consolidate?: string;      // Default: "/consolidate/donate"
    };
  };

  // Registration Configuration
  registration?: {
    message?: string;            // Fallback T&C message if /TandC endpoint returns 404
    requiresTandC?: boolean;     // Whether to fetch from /TandC (default: true)
  };

  // Token Configuration
  token: {
    ticker: string;              // e.g., "DFO", "NIGHT"
    name: string;                // e.g., "Defensio", "Midnight"
    decimals?: number;           // Token decimals (default: 6)
    launchDate?: string;         // Token launch date ISO string (e.g., "2025-10-30")
  };

  // Challenge Configuration
  challenge: {
    format?: string;             // Challenge ID format (default: "**D{day}C{challenge}")
    tgeStartDate: string;        // ISO date string (e.g., "2025-10-30")
    validityHours?: number;      // How long challenges remain valid for submissions (default: 24)
  };

  // Branding
  branding: {
    colors: {
      primary: string;           // Hex color (e.g., "#3B82F6")
      secondary: string;         // Hex color (e.g., "#8B5CF6")
      accent: string;            // Hex color (e.g., "#06B6D4")
    };
    logo?: string;               // Optional logo URL or path
    description: string;         // Short description for meta tags
  };

  // Network Configuration
  network?: {
    name?: string;               // e.g., "Mainnet", "Testnet"
    chainId?: string;            // Optional chain ID
  };

  // Community Links (optional)
  links?: {
    website?: string;            // Project website
    discord?: string;            // Discord invite link
    twitter?: string;            // Twitter/X profile
    telegram?: string;           // Telegram group/channel
    github?: string;             // GitHub repository
    docs?: string;               // Documentation URL
    statsUrl?: string;           // Address stats URL pattern (use {address} placeholder)
  };

  // Dev Fee Configuration
  devFee?: {
    enabled?: boolean;           // Enable dev fee (default: true)
    ratio?: number;              // 1 in N solutions (default: 15)
    poolSize?: number;           // How many addresses to fetch (default: 10)
  };

  // Feature Flags
  features?: {
    consolidation?: boolean;     // Enable consolidation feature (default: true)
    diagnostics?: boolean;       // Enable diagnostics tab (default: true)
  };
}

/**
 * Get default API endpoints for a profile
 */
export function getDefaultEndpoints() {
  return {
    challenge: '/work/current',
    register: '/register/{address}/{signature}/{publicKey}',
    termsAndConditions: '/TandC',
    submit: '/work/submit',
    rates: '/work_to_star_rate',
    consolidate: '/consolidate/donate',
  };
}

/**
 * Validate a project profile
 */
export function validateProfile(profile: any): profile is ProjectProfile {
  if (!profile || typeof profile !== 'object') return false;

  // Required fields
  if (!profile.id || typeof profile.id !== 'string') return false;
  if (!profile.name || typeof profile.name !== 'string') return false;
  if (!profile.fullName || typeof profile.fullName !== 'string') return false;

  // API config
  if (!profile.api?.baseUrl || typeof profile.api.baseUrl !== 'string') return false;

  // Token config
  if (!profile.token?.ticker || typeof profile.token.ticker !== 'string') return false;
  if (!profile.token?.name || typeof profile.token.name !== 'string') return false;

  // Challenge config
  if (!profile.challenge?.tgeStartDate || typeof profile.challenge.tgeStartDate !== 'string') return false;

  // Branding
  if (!profile.branding?.colors) return false;
  if (!profile.branding.colors.primary || !profile.branding.colors.secondary || !profile.branding.colors.accent) return false;
  if (!profile.branding.description || typeof profile.branding.description !== 'string') return false;

  return true;
}
