# Fetcher Bot

**The evolution of [Midnight Fetcher Bot](https://github.com/ADA-Markets/midnight-fetcher-bot) - now supporting multiple mining projects!**

APPLICATION BROUGHT TO YOU BY PADDY https://x.com/PoolShamrock AND PAUL https://x.com/cwpaulm

A multi-project mining platform that supports any project following a similar mining process to the Midnight Scavenger Mine (pulling challenges from an API, finding solutions, and submitting them). Built with NextJS and runs on both Windows and Linux.

**Supported Projects:**
- **Defensio** - DFO token mining
- More projects coming soon!

When the app starts, it can take 5 - 10 minutes for things to fully get going the first time as the script instalkls all prerequisites. Address registration can take some time due to API rate limiting, but this is a one-time thing per project.

This software was built at the community's request to help simplify API mining and make it accessible to anyone who wants to get involved. It is released as-is. Use at your own risk and do your own due diligence on any projects you choose to mine - the authors take no responsibility for any issues that may arise.

## Features

- 🔄 **Multi-Project Support** - Switch between different mining projects easily
- 🔐 **Easy Wallet Creation** - Generate 24-word seed phrase with one click
- 💼 **200 Mining Addresses** - Auto-generate and register addresses per project
- 🖥️ **User-Friendly UI** - Modern web interface with real-time updates
- ⚡ **Native Performance** - Rust-based hashing for maximum speed
- 🪟 **Cross-Platform** - Works on Windows and Linux
- 📊 **Live Dashboard** - Real-time mining statistics and solution tracking
- 📦 **Consolidation** - Consolidate rewards from multiple addresses

## Development Fee

This software includes a small development fee to support ongoing maintenance and improvements.
- **1 in every 15 solutions** (~6.67%) is mined for the developers
- This is **not a fee on your rewards** - you keep all your mined solutions
- Completely transparent - dev fee solutions are clearly logged and marked separately
- Can be disabled in the Settings tab of the mining dashboard

## Quick Start

### Windows Installation

**Prerequisites:**
- Windows 10/11
- Internet connection

**Steps:**

1. **Download** this repository (or clone with git)

2. **Run Setup** - Double-click `setup.cmd` or open Command Prompt and run:
   ```cmd
   setup.cmd
   ```

3. The setup script will:
   - ✅ Check/install Node.js 20.x
   - ✅ Verify pre-built hash server
   - ✅ Install all dependencies
   - ✅ Build the application
   - ✅ Open your browser and start the app

4. **Access the app** at `http://localhost:3001`

### Ubuntu/Linux Server Installation

**Prerequisites:**
- Ubuntu 20.04+ (or compatible Linux distribution)
- SSH access with sudo privileges
- Internet connection

**Steps:**

1. **Download and extract** the repository:
   ```bash
   wget https://github.com/ADA-Markets/FetcherBot/archive/main.zip
   unzip main.zip
   cd FetcherBot-main
   ```

2. **Run initial setup** (first time only):
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

   The setup script will:
   - ✅ Install Node.js 20.x
   - ✅ Install build tools (gcc, g++, make)
   - ✅ Install Rust toolchain
   - ✅ Build optimized hash server (+15-38% performance vs standard build)
   - ✅ Install dependencies
   - ✅ Start services in background
   - ✅ Exit automatically (services keep running)

3. **Access the web dashboard immediately:**
   ```
   http://YOUR_SERVER_IP:3001
   ```

   Services are running in the background - no need to press Ctrl+C!

4. **Manage services** (after initial setup):
   ```bash
   ./start.sh        # Start services (auto-detects CPU cores)
   ./start.sh 16     # Start with 16 worker threads
   ./stop.sh         # Stop all services
   ./status.sh       # Check if services are running
   ./logs.sh         # View live logs
   ```

   **CPU Thread Configuration:** Scripts auto-detect CPU cores by default (max 32).
   Override with: `./start.sh 24` or `WORKERS=24 ./start.sh`

**Firewall Configuration** (if needed):
```bash
sudo ufw allow 3001/tcp
sudo ufw reload
```

## Usage

Run: setup.cmd

On Complete navigate on browser to

http://localhost:3001

### First Time Setup

1. **Create Wallet**
   - Click "Create New Wallet"
   - Enter a strong password (min. 8 characters)
   - **IMPORTANT**: Write down your 24-word seed phrase
   - Store it safely offline (paper, secure vault)
   - ⚠️ Without this seed phrase, you cannot recover your wallet!

2. **Start Mining**
   - The app will automatically generate 200 mining addresses
   - Register all addresses (this happens automatically)
   - Click "Start Mining"
   - Monitor your progress on the dashboard

### Returning Users

1. **Load Wallet**
   - Click "Load Existing Wallet"
   - Enter your password
   - Start mining immediately

## Application Structure

```
FetcherBot/
├── setup.cmd                   # Windows setup script
├── setup.sh                    # Linux setup script
├── app/                        # NextJS app (UI pages)
│   ├── page.tsx               # Home page
│   ├── select-profile/        # Project selection
│   ├── wallet/
│   │   ├── create/page.tsx   # Wallet creation
│   │   └── load/page.tsx     # Load existing wallet
│   ├── mining/page.tsx        # Mining dashboard
│   └── api/                   # API routes
│       ├── wallet/            # Wallet operations
│       ├── hash/              # Hash service
│       ├── mining/            # Mining control
│       └── profiles/          # Project profiles
├── lib/                       # Core libraries
│   ├── wallet/                # Wallet management
│   ├── hash/                  # Hash engine
│   ├── mining/                # Mining orchestrator
│   ├── profiles/              # Built-in project profiles
│   └── config/                # Configuration management
├── native-HashEngine/         # Rust native module
└── logs/                      # Application logs (auto-created)

Data stored in: Documents/FetcherBot/
├── projects/{project-id}/     # Per-project data
│   ├── secure/                # Encrypted wallet files
│   └── storage/               # Receipts and logs
├── profiles/                  # Cached project profiles
└── active-profile.json        # Currently selected project
```

## Dashboard Features

### Real-Time Stats
- 🎯 **Challenge ID** - Current mining challenge
- ✅ **Solutions Found** - Total solutions submitted
- ⏱️ **Uptime** - Mining session duration
- 📍 **Registered Addresses** - 200 addresses ready to mine
- 📈 **Hash Rate** - Mining performance

### Controls
- ▶️ **Start Mining** - Begin mining operation
- ⏹️ **Stop Mining** - Stop current mining session
- 🔄 **Live Updates** - Real-time statistics via Server-Sent Events

## Security

### Wallet Security
- Seed phrase encrypted with password (scrypt + AES-256-GCM)
- Encrypted files stored in `secure/` directory
- Never shares seed phrase after initial display
- All signing done locally (no network transmission of keys)

### Best Practices
- ✅ Use a strong password (12+ characters, mixed case, numbers, symbols)
- ✅ Store seed phrase offline (paper, hardware wallet)
- ✅ Never share your seed phrase with anyone
- ✅ Backup your `secure/` directory to external storage
- ❌ Never screenshot or digitally store your seed phrase

### Scale
increase the below in lib\mining\orchestrator.ts
const BATCH_SIZE = 350;
private workerThreads = 12;

increase or decrease these based on your hardware 

## Troubleshooting

### Setup Issues

**"Node.js not found"**
- Run `setup.cmd` - it will guide you to install Node.js
- Or manually install from: https://nodejs.org/

**"Rust not found"**
- Run `setup.cmd` - it will install Rust automatically
- Or manually install from: https://rustup.rs/

**"Native module build failed"**
- Ensure Visual C++ Build Tools are installed
- Rust installer should handle this automatically
- Restart your terminal after Rust installation

### Runtime Issues

**"Failed to decrypt wallet"**
- Double-check your password
- Ensure `secure/wallet-seed.json.enc` exists

**"Address registration failing"**
- Check your internet connection
- API may be rate-limiting (waits 1.5s between registrations)
- Check logs in `logs/` directory

**"Mining not starting"**
- Ensure all 200 addresses are registered
- Check if challenge is active (mining has time windows)
- Verify ROM initialization completed

## Project Profiles

The application supports multiple mining projects through profiles. Profiles are fetched from a remote API and cached locally.

### Selecting a Project
1. On first launch, you'll be prompted to select a project
2. Projects can be switched from the profile selection page
3. Each project maintains separate wallet and mining data

### Profile Configuration
Each project profile contains:
- API endpoints for mining
- Token information (ticker, decimals)
- Branding and display settings
- Feature flags (consolidation, diagnostics)

Built-in profiles are stored in `lib/profiles/` and custom profiles can be added to `Documents/FetcherBot/profiles/`.

## Development

### Run in Development Mode

```cmd
npm run dev
```

Access at `http://localhost:3001`

### Build for Production

```cmd
npm run build
npm run start
```

### Project Scripts

```cmd
npm run dev          # Start development server (port 3001)
npm run build        # Build for production
npm run start        # Start production server (port 3001)
npm run lint         # Run linter
npm run build:native # Build native module only
```

## Architecture

### Frontend
- **NextJS 14+** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Server-Sent Events** - Real-time updates

### Backend
- **NextJS API Routes** - Serverless API endpoints
- **Lucid Cardano** - Wallet generation and signing
- **Native Module** - Rust-based HashEngine for hashing

### Storage
- **Documents/FetcherBot/projects/{project}/secure/** - Encrypted seed phrase and address list (per project)
- **Documents/FetcherBot/projects/{project}/storage/** - Mining receipts (JSONL format, per project)
- **logs/** - Application and registration logs

## Support

### Common Questions

**Q: Can I use this on multiple computers?**
A: Yes, copy your `Documents/FetcherBot/projects/{project}/secure/` directory and use your password on the new machine.

**Q: What happens if I forget my password?**
A: You'll need your 24-word seed phrase to recover. Without it, the wallet is unrecoverable.

**Q: Can I change the number of addresses?**
A: Yes, modify `count` in the wallet creation request (default: 200, max: 500).

**Q: Is my seed phrase sent to the server?**
A: No. All wallet operations are local. Only public addresses and signatures are sent to the mining API.

### Logs

Check these locations for debugging:
- `logs/app.log` - Application logs
- `logs/wallet-registration-progress.log` - Address registration status
- Console output in terminal

## License

MIT License - See LICENSE file for details

## Credits

- Uses [Lucid Cardano](https://github.com/spacebudz/lucid)
- Native hashing via HashEngine
- Community support: https://ada.markets/discord

## Disclaimer

This software is provided as-is. Always backup your seed phrase and secure your passwords. The authors are not responsible for lost funds or mining rewards.

---

**Happy Mining!**
