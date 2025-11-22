# Fetcher Bot - Comprehensive Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key Components](#key-components)
4. [Core Technologies](#core-technologies)
5. [Directory Structure](#directory-structure)
6. [Application Flow](#application-flow)
7. [Mining Process](#mining-process)
8. [Configuration](#configuration)
9. [API Reference](#api-reference)

---

## Overview

Fetcher Bot is a **multi-project cryptocurrency mining application** built with **Next.js** that supports various mining projects through a profile-based architecture. It features a modern web UI that controls a sophisticated mining orchestration system powered by a native Rust hash engine.

### Key Features
- **Multi-Project Support** - Switch between different mining projects
- HD Wallet management with 200 addresses per project
- Parallel mining with configurable worker threads
- Real-time dashboard with Server-Sent Events
- Native Rust hash engine for maximum performance
- Automatic address registration
- Development fee system (configurable per project)
- Secure seed phrase encryption (AES-256-GCM)
- Mining receipts logging
- Reward consolidation

---

## Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│               User Interface (React)                 │
│          http://localhost:3001 (Browser)            │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│         Next.js App Router (Server)                 │
│  - API Routes (RESTful + Server-Sent Events)       │
│  - Server Components & Client Components            │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│          Core Business Logic (lib/)                 │
│  ┌─────────────────────────────────────────────┐   │
│  │  Mining Orchestrator (Singleton)            │   │
│  │  - Challenge polling (2s interval)          │   │
│  │  - Worker coordination (11 threads)         │   │
│  │  - Address management (200 addresses)       │   │
│  │  - Solution submission & verification       │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │  Wallet Manager                             │   │
│  │  - Lucid Cardano integration                │   │
│  │  - Seed phrase encryption (AES-256-GCM)     │   │
│  │  - Address derivation (HD wallet)           │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │  Hash Engine (HTTP Client)                  │   │
│  │  - Connects to external Rust server         │   │
│  │  - Batch hashing (300 at a time)            │   │
│  │  - ROM initialization per challenge         │   │
│  └─────────────────────────────────────────────┘   │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│    Native Rust Hash Server (hashengine/)           │
│    - HTTP server on port 9001                       │
│    - Parallel hash computation (Rayon)              │
│    - Custom ROM-based algorithm                     │
│    - Compiled to native binary                      │
└─────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│       External APIs                                 │
│  - Project Mining APIs (configured per profile)    │
│  - Dev Fee API (ada.markets)                       │
│  - Remote Profiles API                             │
└─────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Mining Orchestrator (`lib/mining/orchestrator.ts`)
**The "brain" of the application** - 1600+ lines of sophisticated mining logic.

**Responsibilities:**
- Polls project API every 2 seconds for active challenges
- Manages 11 parallel worker threads mining the same address
- Processes 200 addresses sequentially (one at a time)
- Handles ROM initialization for each new challenge
- Coordinates solution submission with fresh challenge data
- Tracks solved addresses to prevent duplicate submissions
- Implements intelligent retry logic (max 6 failures per address)
- Manages hourly worker restarts for stability
- Emits real-time events to UI via Server-Sent Events

**Key Methods:**
- `reinitialize(password)` - Loads wallet and starts mining
- `pollAndMine()` - 2-second polling loop
- `startMining()` - Initiates sequential address mining
- `mineForAddress(addr, isDevFee, workerId)` - Individual worker mining loop
- `pauseAddressMining(addr)` - Pauses all workers for submission
- `resumeAddressMining(addr)` - Resumes workers after submission

### 2. Wallet Manager (`lib/wallet/manager.ts`)
**Secure wallet operations using Lucid Cardano**

**Responsibilities:**
- Generates 24-word BIP-39 seed phrases
- Derives 200 addresses using HD wallet derivation
- Encrypts seed phrase with AES-256-GCM
- Signs messages for address registration
- Manages address registration status

**Key Methods:**
- `generateWallet(password, count)` - Creates new wallet
- `loadWallet(password)` - Decrypts and loads wallet
- `deriveAddresses(seedPhrase, count)` - Derives addresses
- `signMessage(address, message)` - Signs with private key

### 3. Hash Engine (`lib/hash/engine.ts` + `hashengine/`)
**High-performance hash computation**

**JavaScript Client (`lib/hash/engine.ts`):**
- HTTP client connecting to Rust server (port 9001)
- Initializes ROM for each challenge
- Sends batches of 300 preimages
- Manages worker lifecycle

**Rust Server (`hashengine/`):**
- HTTP server using Actix-web
- Parallel hash computation with Rayon
- Custom ROM-based algorithm
- Compiled to native binary

**Key Endpoints:**
- `POST /init_rom` - Initialize ROM with challenge data
- `POST /hash_batch` - Compute batch of 300 hashes
- `POST /hash` - Compute single hash (for verification)
- `GET /health` - Health check

### 4. Dev Fee Manager (`lib/devfee/manager.ts`)
**Manages development fee system**

**Responsibilities:**
- Pre-fetches 10 dev fee addresses at startup
- Calculates dev fee obligations (1 per 15 user solutions = ~6.67%)
- Round-robin address selection from pool
- Tracks dev fee solutions
- Caches addresses in `.devfee_cache.json`

**Formula:**
```
devFeesNeeded = floor(userSolutions / 15) - currentDevFees
```

### 5. Solution Submitter (`lib/mining/solution-submitter.ts`)
**Handles solution submission with verification**

**Critical Flow:**
1. Solution found by worker
2. Pause all other workers immediately
3. Fetch FRESH challenge data from API (critical!)
4. Recompute hash with fresh data
5. Verify fresh hash meets difficulty
6. Submit solution to API
7. Log receipt to `storage/receipts.jsonl`
8. Resume or stop workers based on result

---

## Core Technologies

### Frontend Stack
- **Next.js 16.0.1** - React framework with App Router
- **React 19.2.0** - UI library
- **TypeScript 5.9.3** - Type safety
- **Tailwind CSS 4.1.16** - Utility-first styling
- **Lucide React 0.552.0** - Icon library

### Backend Stack
- **Next.js API Routes** - Serverless endpoints
- **Node.js 20.x** - Runtime environment
- **Lucid Cardano 0.10.11** - Cardano wallet library
- **Axios 1.13.2** - HTTP client
- **Server-Sent Events** - Real-time updates

### Native Components
- **Rust** - High-performance hash engine
- **Rayon** - Parallel processing library
- **Actix-web** - HTTP server framework
- **Cargo** - Rust package manager

### Security & Storage
- **Node.js Crypto** - AES-256-GCM encryption, scrypt KDF
- **File System** - Encrypted wallet storage
- **JSONL** - Log-structured receipts

---

## Directory Structure

```
FetcherBot/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Home page (wallet selection)
│   ├── layout.tsx                # Root layout
│   ├── wallet/
│   │   ├── create/page.tsx       # Wallet creation wizard
│   │   └── load/page.tsx         # Wallet unlock page
│   ├── mining/
│   │   ├── page.tsx              # Main mining dashboard (1883 lines)
│   │   └── history/page.tsx      # Mining history view
│   └── api/                      # API Routes
│       ├── wallet/               # Wallet operations
│       │   ├── create/route.ts
│       │   ├── load/route.ts
│       │   └── status/route.ts
│       ├── mining/               # Mining control
│       │   ├── start/route.ts
│       │   ├── stop/route.ts
│       │   ├── status/route.ts
│       │   ├── stream/route.ts   # Server-Sent Events
│       │   ├── addresses/route.ts
│       │   └── history/route.ts
│       ├── hash/                 # Hash engine operations
│       │   ├── init/route.ts
│       │   ├── compute/route.ts
│       │   └── health/route.ts
│       ├── stats/route.ts        # Mining statistics
│       └── devfee/route.ts       # Dev fee management
│
├── lib/                          # Core Business Logic
│   ├── mining/                   # Mining orchestration
│   │   ├── orchestrator.ts       # Main coordinator (1600 lines)
│   │   ├── types.ts              # TypeScript interfaces
│   │   ├── difficulty.ts         # Difficulty validation
│   │   ├── nonce.ts              # Nonce generation
│   │   ├── preimage.ts           # Preimage construction
│   │   ├── solution-submitter.ts # Solution submission
│   │   └── devfee.ts             # Dev fee logic
│   ├── wallet/                   # Wallet management
│   │   ├── manager.ts            # Wallet operations
│   │   └── encryption.ts         # AES-256-GCM encryption
│   ├── hash/                     # Hash engine interface
│   │   ├── engine.ts             # HTTP client wrapper
│   │   ├── client.ts             # HTTP implementation
│   │   ├── types.ts              # Hash engine types
│   │   └── native-loader.ts      # Native module loader
│   ├── storage/                  # Persistence
│   │   └── receipts-logger.ts    # JSONL receipt logging
│   ├── devfee/                   # Development fee
│   │   └── manager.ts            # Dev fee address pool
│   ├── stats/                    # Statistics
│   │   └── compute.ts            # Stats computation
│   └── utils/                    # Utilities
│       └── logger.ts             # Structured logging
│
├── components/ui/                # React Components
│   ├── button.tsx                # Button variants
│   ├── card.tsx                  # Card container
│   ├── input.tsx                 # Form input
│   ├── stat-card.tsx             # Statistics display
│   ├── alert.tsx                 # Alert component
│   └── modal.tsx                 # Modal dialog
│
├── hashengine/                   # Rust Native Module
│   ├── src/                      # Rust source code
│   │   ├── main.rs               # Hash server entry point
│   │   ├── lib.rs                # Library code
│   │   └── hash/                 # Hash algorithm
│   ├── Cargo.toml                # Rust dependencies
│   ├── index.node                # Compiled native binary
│   └── build.rs                  # Build script
│
├── secure/                       # Encrypted Storage (runtime)
│   ├── wallet-seed.json.enc      # Encrypted 24-word seed
│   └── derived-addresses.json    # Derived addresses
│
├── storage/                      # Mining Data (runtime)
│   └── receipts.jsonl            # Mining receipts (1 per line)
│
├── logs/                         # Application Logs (runtime)
│   ├── app.log
│   └── wallet-registration-progress.log
│
├── .devfee_cache.json            # Dev fee cache (runtime)
├── package.json                  # Node.js dependencies
├── next.config.ts                # Next.js configuration
├── tsconfig.json                 # TypeScript configuration
├── tailwind.config.ts            # Tailwind CSS configuration
├── setup.cmd                     # One-click setup script
└── run.cmd                       # Start script
```

---

## Application Flow

### 1. Initial Setup Flow

```
User runs setup.cmd
├─> Checks Node.js 20.x
├─> Checks Rust toolchain
├─> Builds Rust hash engine (cargo build --release)
├─> Installs npm dependencies
├─> Builds Next.js app (npm run build)
└─> Opens browser to http://localhost:3001
```

### 2. Wallet Creation Flow

```
User navigates to /wallet/create
├─> Enters password
├─> POST /api/wallet/create { password, count: 200 }
├─> WalletManager.generateWallet()
│   ├─> Generates 24-word seed phrase (Lucid Cardano)
│   ├─> Derives 200 addresses (HD wallet)
│   ├─> Encrypts seed with AES-256-GCM
│   ├─> Saves to secure/wallet-seed.json.enc
│   └─> Saves addresses to secure/derived-addresses.json
├─> Displays seed phrase (ONLY TIME IT'S SHOWN)
├─> User backs up seed phrase
└─> Redirects to /wallet/load
```

### 3. Wallet Load Flow

```
User navigates to /wallet/load
├─> Enters password
├─> POST /api/wallet/load { password }
├─> WalletManager.loadWallet()
│   ├─> Reads secure/wallet-seed.json.enc
│   ├─> Decrypts with password
│   ├─> Loads derived addresses
│   └─> Returns address list
├─> Stores password in sessionStorage
└─> Redirects to /mining
```

### 4. Mining Startup Flow

```
User clicks "Start Mining" on /mining page
├─> POST /api/mining/start { password }
└─> miningOrchestrator.reinitialize(password)
    ├─> Stops any existing mining
    ├─> Loads wallet (WalletManager.loadWallet)
    ├─> Loads previous solutions from receipts.jsonl
    ├─> Registers unregistered addresses
    │   ├─> For each unregistered address:
    │   │   ├─> GET /TandC (Midnight API)
    │   │   ├─> Sign message with private key
    │   │   ├─> POST /register/{address}/{signature}/{pubKey}
    │   │   └─> Wait 1.5s (rate limiting)
    │   └─> Marks registered in derived-addresses.json
    ├─> Pre-fetches 10 dev fee addresses
    │   └─> POST https://miner.ada.markets/api/get-dev-address
    ├─> Starts polling loop (2-second interval)
    └─> Schedules hourly restart
```

---

## Mining Process

### 1. Challenge Polling Loop (Every 2 Seconds)

```
pollAndMine()
├─> GET /challenge (Midnight API)
├─> Check challenge status (before/active/after)
└─> If new challenge detected:
    ├─> Stop current mining
    ├─> Kill all hash workers
    ├─> Clear progress tracking
    ├─> Initialize ROM
    │   ├─> POST http://127.0.0.1:9001/init_rom { no_pre_mine }
    │   └─> Wait for ROM ready (max 60s)
    ├─> Load challenge state from receipts
    └─> Start mining
```

### 2. Sequential Address Mining

```
startMining()
├─> Filter out already-solved addresses
├─> For each unsolved address (sequential):
│   ├─> Set as current mining address
│   ├─> Launch 11 workers in parallel (all mining same address)
│   └─> Workers loop until:
│       ├─> Solution found, OR
│       ├─> Max failures reached (6), OR
│       ├─> Challenge changed
└─> After all addresses: checkAndMineDevFee()
```

**Why Sequential?**
- All 11 workers focus on one address at a time
- Maximizes chance of finding solution quickly
- Moves to next address only after solution or max failures

### 3. Worker Mining Loop (Per Worker)

```
mineForAddress(address, isDevFee, workerId)
├─> Capture challenge snapshot
├─> Initialize worker stats
└─> Loop continuously:
    ├─> Check if still mining correct address
    ├─> Check if max failures reached (6)
    ├─> Check if address already solved
    ├─> Check if worker should stop (solution by other worker)
    ├─> Check if paused (another worker submitting)
    │
    ├─> Generate batch of 300 nonces + preimages
    │   ├─> Each worker uses unique workerId for nonce space
    │   └─> Preimage = nonce + address + challenge_id + ...
    │
    ├─> POST http://127.0.0.1:9001/hash_batch { preimages: [300] }
    │   └─> Rust server computes hashes in parallel
    │
    ├─> Receive 300 hashes
    ├─> Check each hash against difficulty
    │
    └─> If solution found:
        ├─> Mark as submitting
        ├─> Stop all other workers immediately
        ├─> Pause address mining
        │
        ├─> Fetch FRESH challenge data (CRITICAL!)
        │   └─> GET /challenge (gets latest_submission)
        │
        ├─> Recompute hash with fresh data
        │   └─> POST http://127.0.0.1:9001/hash { preimage }
        │
        ├─> Verify fresh hash meets difficulty
        │
        ├─> Submit solution
        │   ├─> POST /solution/{address}/{challenge_id}/{nonce}
        │   ├─> Log receipt to storage/receipts.jsonl
        │   ├─> Mark address as solved
        │   └─> Clear submission lock
        │
        └─> Exit worker (all workers stop for this address)
```

### 4. Solution Submission Flow (Critical)

**Why Fetch Fresh Challenge Data?**
- Challenge's `latest_submission` field updates when anyone submits
- Preimage includes `latest_submission`
- Hash computed 1 second ago may be stale
- Recomputing with fresh data prevents stale submissions

**Submission Steps:**
1. Worker finds hash meeting difficulty
2. **PAUSE ALL WORKERS** (prevents duplicate work)
3. **Fetch fresh challenge data** from API
4. **Recompute hash** with fresh `latest_submission`
5. **Verify** fresh hash still meets difficulty
6. **Submit** to API
7. Log receipt
8. Mark address solved
9. Move to next address

### 5. Dev Fee Mining

```
checkAndMineDevFee()
├─> Calculate: devFeesNeeded = floor(userSolutions / 15)
├─> Current dev fees = totalDevFeeSolutions
│
└─> If devFeesNeeded > 0:
    ├─> For each needed dev fee solution:
    │   ├─> Get dev fee address from pool (round-robin)
    │   ├─> Check if address already solved this challenge
    │   ├─> If solved: fetch new address from API
    │   ├─> Mine for dev fee address (single worker)
    │   └─> Submit solution (marked as isDevFee: true)
    └─> Update dev fee cache
```

**Dev Fee Formula:**
- Ratio: 1 dev fee per 15 user solutions
- Percentage: ~6.67%
- Example: 45 user solutions = 3 dev fees

### 6. Hourly Restart Flow

```
Every hour (top of the hour):

scheduleHourlyRestart()
├─> Calculate milliseconds until next hour
└─> setTimeout(() => {
    ├─> Stop current mining
    ├─> Wait 2 seconds for workers to finish
    ├─> Kill all hash workers
    ├─> Clear worker stats
    ├─> Reset state (addresses, submissions, paused)
    ├─> Reinitialize ROM (if challenge active)
    ├─> Resume mining
    └─> Schedule next hourly restart
})
```

**Why Hourly Restarts?**
- Clears memory leaks
- Resets worker state
- Ensures fresh connections
- Maintains stability over long runs

---

## Configuration

### Mining Orchestrator Settings

Located in `lib/mining/orchestrator.ts`:

```typescript
private apiBase = 'https://scavenger.prod.gd.midnighttge.io';
private pollInterval = 2000;              // 2 seconds
private workerThreads = 11;               // Parallel workers
const BATCH_SIZE = 300;                   // Hashes per batch
const MAX_SUBMISSION_FAILURES = 6;        // Max retries per address
```

### Dev Fee Configuration

Located in `lib/devfee/manager.ts`:

```typescript
{
  enabled: true,
  apiUrl: 'https://miner.ada.markets/api/get-dev-address',
  ratio: 15,  // 1 in 15 solutions = ~6.67%
}
```

### Hash Engine Configuration

Located in `lib/hash/engine.ts`:

```typescript
{
  hashServiceUrl: 'http://127.0.0.1:9001',
  maxConnectionsPerUrl: 200,
  keepAliveTimeout: 60000,
  requestTimeout: 10000,
  maxRetries: 3,
  retryDelayMs: 100,
}
```

### Wallet Configuration

Located in `lib/wallet/manager.ts`:

```typescript
{
  addressCount: 200,
  network: 'Mainnet',
  encryption: 'AES-256-GCM',
  kdf: 'scrypt',
  scryptParams: {
    N: 32768,
    r: 8,
    p: 1,
    keyLen: 32,
  },
}
```

### Environment Variables

**`.env` (optional):**
```bash
# All configuration is built-in
# No environment variables required
```

Optional internal variables:
- `HASH_SERVICE_URL` - Hash server URL (default: http://127.0.0.1:9001)
- `DEV_FEE_ENABLED` - Enable/disable dev fee (default: true)
- `DEBUG_PREIMAGE` - Debug preimage construction (default: false)

---

## API Reference

### Wallet APIs

#### POST /api/wallet/create
Creates a new HD wallet with encrypted seed phrase.

**Request:**
```json
{
  "password": "string",
  "count": 200
}
```

**Response:**
```json
{
  "success": true,
  "seedPhrase": "word1 word2 ... word24",
  "addresses": ["addr1...", "addr2...", ...]
}
```

#### POST /api/wallet/load
Loads and decrypts existing wallet.

**Request:**
```json
{
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "addresses": [
    {
      "index": 0,
      "bech32": "addr1...",
      "registered": true
    }
  ]
}
```

#### GET /api/wallet/status
Check if wallet exists.

**Response:**
```json
{
  "exists": true,
  "addressCount": 200
}
```

### Mining APIs

#### POST /api/mining/start
Start mining with all 11 workers.

**Request:**
```json
{
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Mining started"
}
```

#### POST /api/mining/stop
Stop all mining workers.

**Response:**
```json
{
  "success": true,
  "message": "Mining stopped"
}
```

#### GET /api/mining/status
Get current mining status.

**Response:**
```json
{
  "isRunning": true,
  "isMining": true,
  "currentAddress": "addr1...",
  "totalSolutions": 42,
  "totalHashes": 1234567890,
  "hashRate": 123456,
  "workerStats": [
    {
      "workerId": 0,
      "totalHashes": 123456,
      "hashRate": 12345,
      "solutions": 4
    }
  ]
}
```

#### GET /api/mining/stream
Server-Sent Events stream for real-time updates.

**Event Types:**
- `status` - Mining started/stopped
- `stats` - Mining statistics (every 5s)
- `solution` - Solution found
- `error` - Error occurred
- `mining_start` - Started mining address
- `hash_progress` - Hashes computed
- `solution_submit` - Submitting solution
- `solution_result` - Solution accepted/rejected
- `registration_progress` - Address registration
- `worker_update` - Worker statistics

**Example Event:**
```
event: solution
data: {"address":"addr1...","challengeId":"abc123","success":true}
```

#### GET /api/mining/addresses
Get list of all addresses with registration status.

**Response:**
```json
{
  "addresses": [
    {
      "index": 0,
      "bech32": "addr1...",
      "registered": true
    }
  ]
}
```

#### GET /api/mining/history
Get mining history from receipts.jsonl.

**Response:**
```json
{
  "receipts": [
    {
      "timestamp": "2025-11-06T12:34:56.789Z",
      "address": "addr1...",
      "challengeId": "abc123",
      "nonce": "abcdef0123456789",
      "hash": "000000abcdef...",
      "difficulty": 28,
      "success": true,
      "isDevFee": false
    }
  ]
}
```

### Hash Engine APIs

#### POST /api/hash/init
Initialize hash engine ROM for new challenge.

**Request:**
```json
{
  "noPreMine": "abc123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "ROM initialized"
}
```

#### POST /api/hash/compute
Compute batch of hashes.

**Request:**
```json
{
  "preimages": [
    "preimage1",
    "preimage2",
    "..."
  ]
}
```

**Response:**
```json
{
  "hashes": [
    "hash1",
    "hash2",
    "..."
  ]
}
```

#### GET /api/hash/health
Health check for hash engine.

**Response:**
```json
{
  "status": "healthy",
  "port": 9001
}
```

### Statistics APIs

#### GET /api/stats
Get mining statistics and reward estimates.

**Response:**
```json
{
  "totalSolutions": 42,
  "totalHashes": 1234567890,
  "hashRate": 123456,
  "uptime": 3600000,
  "rewards": {
    "star": 42000000,
    "night": 420000000
  }
}
```

### Dev Fee APIs

#### GET /api/devfee
Get dev fee status.

**Response:**
```json
{
  "enabled": true,
  "ratio": 15,
  "totalDevFees": 3,
  "userSolutions": 45
}
```

---

## Preimage Construction

The preimage is the critical input to the hash function. It must be constructed **exactly** as specified.

### Format

```
nonce + address + challenge_id + difficulty + no_pre_mine + latest_submission + no_pre_mine_hour
```

### Example

```
abcdef0123456789addr1qy...abc12328abc123def456789012345678901234567890123456789012345678901234560
```

### Fields

1. **nonce** (16 hex chars) - Random 16-character hex string
2. **address** (63 chars) - Bech32 Cardano address
3. **challenge_id** (variable) - Current challenge ID
4. **difficulty** (2 digits) - Required difficulty (e.g., "28")
5. **no_pre_mine** (64 hex chars) - Challenge's no_pre_mine field
6. **latest_submission** (64 hex chars) - Challenge's latest_submission field
7. **no_pre_mine_hour** (1 digit) - Challenge's no_pre_mine_hour field

### Critical Notes

- **NO TRIMMING** - Preserve exact field formats
- **NO PADDING** - Don't add extra characters
- **NO SEPARATORS** - No spaces, commas, or delimiters
- **ORDER MATTERS** - Fields must be in exact order
- **LATEST_SUBMISSION** - Must be fresh (re-fetch before submission)

### Code Reference

See [lib/mining/preimage.ts](lib/mining/preimage.ts) for implementation.

---

## Difficulty Validation

Hash must have at least N leading zero bits, where N is the difficulty.

### Example (Difficulty 28)

**Valid Hash (29 leading zeros):**
```
00000000abcdef0123456789...
```

**Invalid Hash (27 leading zeros):**
```
00000001abcdef0123456789...
```

### Algorithm

1. Convert hex hash to binary
2. Count leading zeros
3. Compare to required difficulty

### Code Reference

See [lib/mining/difficulty.ts](lib/mining/difficulty.ts) for implementation.

---

## Storage Format

### Receipts (storage/receipts.jsonl)

JSONL format (1 JSON object per line):

```jsonl
{"timestamp":"2025-11-06T12:34:56.789Z","address":"addr1...","challengeId":"abc123","nonce":"abcdef0123456789","hash":"000000abcdef...","difficulty":28,"success":true,"isDevFee":false}
{"timestamp":"2025-11-06T12:45:67.890Z","address":"addr2...","challengeId":"abc123","nonce":"fedcba9876543210","hash":"000000fedcba...","difficulty":28,"success":true,"isDevFee":false}
```

### Wallet Seed (secure/wallet-seed.json.enc)

Encrypted JSON with AES-256-GCM:

```json
{
  "encryptedData": "base64...",
  "iv": "base64...",
  "authTag": "base64...",
  "salt": "base64..."
}
```

### Derived Addresses (secure/derived-addresses.json)

Unencrypted JSON array:

```json
[
  {
    "index": 0,
    "bech32": "addr1...",
    "registered": true
  },
  {
    "index": 1,
    "bech32": "addr2...",
    "registered": false
  }
]
```

### Dev Fee Cache (.devfee_cache.json)

```json
{
  "addresses": [
    {
      "address": "addr1...",
      "clientId": "abc123"
    }
  ],
  "totalDevFeeSolutions": 2,
  "lastUpdated": "2025-11-06T12:34:56.789Z"
}
```

---

## Troubleshooting

### Common Issues

#### 1. "Hash engine not responding"
- Check if hash-server.exe is running on port 9001
- Restart mining to kill and restart hash workers
- Check logs/app.log for errors

#### 2. "Submission failed: stale challenge"
- Normal - challenge updated between hash and submission
- Orchestrator will retry (max 6 times)
- If persistent, check network connection

#### 3. "Worker stuck at 0 hash rate"
- Wait 5-10 seconds for stats to update
- If persists, restart mining
- Check CPU usage (should be near 100%)

#### 4. "ROM initialization timeout"
- Hash engine may be overloaded
- Restart mining
- Check if multiple instances are running

#### 5. "Password incorrect"
- Password is case-sensitive
- No password recovery (seed phrase required)
- If seed phrase lost, create new wallet

### Log Files

- **logs/app.log** - Main application log
- **logs/wallet-registration-progress.log** - Address registration
- **storage/receipts.jsonl** - Mining receipts

### Performance Tips

1. **Close background applications** - Mining uses all CPU
2. **Run on dedicated machine** - Avoid interruptions
3. **Ensure stable internet** - Required for API calls
4. **Monitor temperature** - CPU will run hot
5. **Use SSD** - Faster file I/O for logs

---

## Security Considerations

### Wallet Security

1. **Seed Phrase** - Only shown once during creation
2. **Encryption** - AES-256-GCM with scrypt KDF
3. **Password** - Stored in sessionStorage (cleared on browser close)
4. **Private Keys** - Never leave memory unencrypted

### Best Practices

1. **Back up seed phrase** - Write on paper, store securely
2. **Use strong password** - 16+ characters, mixed case, numbers, symbols
3. **Don't share password** - Never send via email/chat
4. **Verify addresses** - Check first transaction carefully
5. **Keep software updated** - Watch for security updates

### Attack Vectors

1. **Keyloggers** - Can capture password
2. **Screen capture** - Can capture seed phrase
3. **File access** - Encrypted, but password needed
4. **Memory dump** - Private keys in memory during mining
5. **Network sniffing** - HTTPS protects API calls

---

## Development

### Setup Development Environment

```bash
# Install dependencies
npm install

# Build hash engine
cd hashengine
cargo build --release --bin hash-server
cd ..

# Start development server
npm run dev
```

### Project Scripts

```bash
npm run dev         # Start development server (port 3001)
npm run build       # Build for production
npm run start       # Start production server
npm run lint        # Run ESLint
npm run build:hash  # Build Rust hash engine
```

### Code Style

- **TypeScript** - Strict mode enabled
- **ESLint** - Next.js recommended rules
- **Prettier** - Not configured (use ESLint)
- **Naming** - camelCase for variables, PascalCase for components

### Testing

Currently no automated tests. Manual testing workflow:

1. Create wallet
2. Start mining
3. Monitor for 1 hour
4. Check receipts.jsonl
5. Verify solutions on Midnight Explorer

---

## Credits

- **Framework** - Next.js by Vercel
- **Wallet** - Lucid Cardano
- **Hash Engine** - Custom Rust implementation
- **UI** - Tailwind CSS
- **Icons** - Lucide React

---

## License

Proprietary - All rights reserved

---

## Support

For issues or questions:
1. Check this documentation
2. Review logs/app.log
3. Check GitHub issues (if applicable)
4. Contact developer

---

**Last Updated:** 2025-11-06
**Version:** 1.0.0
