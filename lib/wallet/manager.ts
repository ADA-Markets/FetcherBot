import fs from 'fs';
import path from 'path';
import { Lucid, toHex } from 'lucid-cardano';
import { encrypt, decrypt, EncryptedData } from './encryption';

// Lazy path resolution - determined at first use when profile is definitely loaded
let _secureDir: string | null = null;

function getSecureDir(): string {
  if (_secureDir) return _secureDir;

  try {
    // Try to use profile-specific path
    const { pathResolver } = require('@/lib/storage/path-resolver');
    const resolvedDir = pathResolver.getSecureDir();
    _secureDir = resolvedDir;
    console.log(`[Wallet] Using profile-specific path: ${resolvedDir}`);
    return resolvedDir;
  } catch (error: any) {
    // Fallback for legacy support (only if profile not available)
    const oldSecureDir = path.join(process.cwd(), 'secure');
    const newDataDir = path.join(
      process.env.USERPROFILE || process.env.HOME || process.cwd(),
      'Documents',
      'FetcherBot'
    );

    // Check if wallet exists in old location (installation folder)
    const oldWalletFile = path.join(oldSecureDir, 'wallet-seed.json.enc');
    if (fs.existsSync(oldWalletFile)) {
      console.log(`[Wallet] Found existing wallet in installation folder`);
      console.log(`[Wallet] Using: ${oldSecureDir}`);
      _secureDir = oldSecureDir;
      return _secureDir;
    }

    // Check if wallet exists in legacy flat Documents folder
    const legacySecureDir = path.join(newDataDir, 'secure');
    const legacyWalletFile = path.join(legacySecureDir, 'wallet-seed.json.enc');
    if (fs.existsSync(legacyWalletFile)) {
      console.log(`[Wallet] Found existing wallet in legacy location`);
      console.log(`[Wallet] Using: ${legacySecureDir}`);
      _secureDir = legacySecureDir;
      return _secureDir;
    }

    // Check if wallet exists in any profile directory (safety net)
    const projectsDir = path.join(newDataDir, 'projects');
    if (fs.existsSync(projectsDir)) {
      try {
        const profiles = fs.readdirSync(projectsDir);
        for (const profile of profiles) {
          const profileSecureDir = path.join(projectsDir, profile, 'secure');
          const profileWalletFile = path.join(profileSecureDir, 'wallet-seed.json.enc');
          if (fs.existsSync(profileWalletFile)) {
            console.log(`[Wallet] Found existing wallet in profile: ${profile}`);
            console.log(`[Wallet] Using: ${profileSecureDir}`);
            console.log(`[Wallet] Warning: Profile was not loaded, but wallet found. Consider selecting profile.`);
            _secureDir = profileSecureDir;
            return _secureDir;
          }
        }
      } catch (scanError) {
        console.error(`[Wallet] Error scanning profiles directory:`, scanError);
      }
    }

    // No existing wallet found - use legacy path for new wallet
    console.log(`[Wallet] No existing wallet found, using legacy path: ${legacySecureDir}`);
    console.log(`[Wallet] Note: Select a profile to use profile-specific storage`);
    console.log(`[Wallet] Error was: ${error.message}`);
    _secureDir = legacySecureDir;
    return _secureDir;
  }
}

function getSeedFile(): string {
  return path.join(getSecureDir(), 'wallet-seed.json.enc');
}

function getDerivedAddressesFile(): string {
  return path.join(getSecureDir(), 'derived-addresses.json');
}

// Reset cached path (call when profile changes)
export function resetWalletPath(): void {
  _secureDir = null;
  console.log('[Wallet] Path cache cleared - will re-resolve on next access');
}

export interface DerivedAddress {
  index: number;
  bech32: string;
  publicKeyHex: string;
  registered?: boolean;  // Legacy field - kept for backwards compatibility
  registeredProfiles?: string[];  // Array of profile IDs this address is registered for
}

export interface WalletInfo {
  seedPhrase: string;
  addresses: DerivedAddress[];
}

export class WalletManager {
  private mnemonic: string | null = null;
  private derivedAddresses: DerivedAddress[] = [];

  /**
   * Generate a new wallet with 24-word seed phrase
   */
  async generateWallet(password: string, count: number = 40): Promise<WalletInfo> {
    // Ensure secure directory exists
    const secureDir = getSecureDir();
    if (!fs.existsSync(secureDir)) {
      fs.mkdirSync(secureDir, { recursive: true, mode: 0o700 });
    }

    // Generate 24-word mnemonic using Lucid
    const tempLucid = await Lucid.new(undefined, 'Mainnet');
    this.mnemonic = tempLucid.utils.generateSeedPhrase();
    const words = this.mnemonic.split(' ');

    if (words.length !== 24) {
      throw new Error('Failed to generate 24-word mnemonic');
    }

    // Derive addresses
    await this.deriveAddresses(count);

    // Encrypt and save seed
    const encryptedData = encrypt(this.mnemonic, password);
    fs.writeFileSync(getSeedFile(), JSON.stringify(encryptedData, null, 2), { mode: 0o600 });

    // Save derived addresses
    fs.writeFileSync(
      getDerivedAddressesFile(),
      JSON.stringify(this.derivedAddresses, null, 2),
      { mode: 0o600 }
    );

    return {
      seedPhrase: this.mnemonic,
      addresses: this.derivedAddresses,
    };
  }

  /**
   * Load existing wallet from encrypted file
   */
  async loadWallet(password: string): Promise<DerivedAddress[]> {
    if (!fs.existsSync(getSeedFile())) {
      throw new Error('No wallet found. Please create a new wallet first.');
    }

    const encryptedData: EncryptedData = JSON.parse(fs.readFileSync(getSeedFile(), 'utf8'));

    try {
      this.mnemonic = decrypt(encryptedData, password);
    } catch (err) {
      throw new Error('Failed to decrypt wallet. Incorrect password?');
    }

    // Load derived addresses if they exist
    if (fs.existsSync(getDerivedAddressesFile())) {
      this.derivedAddresses = JSON.parse(fs.readFileSync(getDerivedAddressesFile(), 'utf8'));
    } else {
      throw new Error('Derived addresses file not found. Wallet may be corrupted.');
    }

    return this.derivedAddresses;
  }

  /**
   * Check if wallet exists
   */
  walletExists(): boolean {
    return fs.existsSync(getSeedFile());
  }

  /**
   * Derive addresses from mnemonic
   */
  private async deriveAddresses(count: number): Promise<void> {
    if (!this.mnemonic) {
      throw new Error('Mnemonic not loaded');
    }

    this.derivedAddresses = [];

    for (let i = 0; i < count; i++) {
      try {
        const { address, pubKeyHex } = await this.deriveAddressAtIndex(i);

        this.derivedAddresses.push({
          index: i,
          bech32: address,
          publicKeyHex: pubKeyHex,
          registered: false,
        });
      } catch (err: any) {
        console.error(`Failed to derive address at index ${i}:`, err.message);
        throw err;
      }
    }
  }

  /**
   * Expand wallet by deriving additional addresses
   * Requires wallet to be loaded first
   */
  async expandAddresses(newTotal: number): Promise<{ added: number; total: number }> {
    if (!this.mnemonic) {
      throw new Error('Wallet not loaded. Please load the wallet first.');
    }

    const currentCount = this.derivedAddresses.length;

    if (newTotal <= currentCount) {
      throw new Error(`New total (${newTotal}) must be greater than current count (${currentCount})`);
    }

    if (newTotal > 500) {
      throw new Error('Maximum address count is 500');
    }

    const startIndex = currentCount;
    const toAdd = newTotal - currentCount;

    console.log(`[Wallet] Expanding from ${currentCount} to ${newTotal} addresses (adding ${toAdd})`);

    for (let i = startIndex; i < newTotal; i++) {
      try {
        const { address, pubKeyHex } = await this.deriveAddressAtIndex(i);

        this.derivedAddresses.push({
          index: i,
          bech32: address,
          publicKeyHex: pubKeyHex,
          registered: false,
        });

        // Log progress every 10 addresses
        if ((i - startIndex + 1) % 10 === 0) {
          console.log(`[Wallet] Derived ${i - startIndex + 1}/${toAdd} new addresses`);
        }
      } catch (err: any) {
        console.error(`Failed to derive address at index ${i}:`, err.message);
        throw err;
      }
    }

    // Save updated addresses
    fs.writeFileSync(
      getDerivedAddressesFile(),
      JSON.stringify(this.derivedAddresses, null, 2),
      { mode: 0o600 }
    );

    console.log(`[Wallet] Successfully expanded to ${newTotal} addresses`);

    return {
      added: toAdd,
      total: this.derivedAddresses.length,
    };
  }

  /**
   * Derive a single address at specific index
   */
  private async deriveAddressAtIndex(index: number): Promise<{ address: string; pubKeyHex: string }> {
    if (!this.mnemonic) {
      throw new Error('Mnemonic not loaded');
    }

    const lucid = await Lucid.new(undefined, 'Mainnet');
    lucid.selectWalletFromSeed(this.mnemonic, {
      accountIndex: index,
    });

    const address = await lucid.wallet.address();

    // Get public key by signing a test message
    const testPayload = toHex(Buffer.from('test', 'utf8'));
    const signedMessage = await lucid.wallet.signMessage(address, testPayload);

    // Extract 32-byte public key from COSE_Key structure
    const coseKey = signedMessage.key;
    const pubKeyHex = coseKey.slice(-64);

    if (!pubKeyHex || pubKeyHex.length !== 64) {
      throw new Error(`Failed to extract valid public key for index ${index}`);
    }

    return { address, pubKeyHex };
  }

  /**
   * Sign a message with specific address
   */
  async signMessage(addressIndex: number, message: string): Promise<string> {
    if (!this.mnemonic) {
      throw new Error('Mnemonic not loaded');
    }

    const addr = this.derivedAddresses.find(a => a.index === addressIndex);
    if (!addr) {
      throw new Error(`Address not found for index ${addressIndex}`);
    }

    const lucid = await Lucid.new(undefined, 'Mainnet');
    lucid.selectWalletFromSeed(this.mnemonic, {
      accountIndex: addressIndex,
    });

    const payload = toHex(Buffer.from(message, 'utf8'));
    const signedMessage = await lucid.wallet.signMessage(addr.bech32, payload);

    return signedMessage.signature;
  }

  /**
   * Get all derived addresses
   */
  getDerivedAddresses(): DerivedAddress[] {
    return this.derivedAddresses;
  }

  /**
   * Get public key for specific address index
   */
  getPubKeyHex(index: number): string {
    const addr = this.derivedAddresses.find(a => a.index === index);
    if (!addr) {
      throw new Error(`Address not found for index ${index}`);
    }
    return addr.publicKeyHex;
  }

  /**
   * Mark address as registered for a specific profile
   */
  markAddressRegistered(index: number, profileId?: string): void {
    const addr = this.derivedAddresses.find(a => a.index === index);
    if (addr) {
      // Legacy support
      addr.registered = true;

      // New profile-aware tracking
      if (profileId) {
        if (!addr.registeredProfiles) {
          addr.registeredProfiles = [];
        }
        if (!addr.registeredProfiles.includes(profileId)) {
          addr.registeredProfiles.push(profileId);
        }
      }

      // Save updated addresses
      fs.writeFileSync(
        getDerivedAddressesFile(),
        JSON.stringify(this.derivedAddresses, null, 2),
        { mode: 0o600 }
      );
    }
  }

  /**
   * Check if address is registered for a specific profile
   */
  isAddressRegisteredForProfile(index: number, profileId: string): boolean {
    const addr = this.derivedAddresses.find(a => a.index === index);
    if (!addr) return false;

    // Check new profile-aware field first
    if (addr.registeredProfiles && addr.registeredProfiles.includes(profileId)) {
      return true;
    }

    // Fallback to legacy field (assume registered for all profiles if true)
    // This maintains backwards compatibility
    return addr.registered === true;
  }

  /**
   * Create donation signature for consolidating rewards
   * Signs the message: "donate_to:{destinationAddress}"
   */
  async makeDonationSignature(addressIndex: number, sourceAddress: string, destinationAddress: string): Promise<string> {
    if (!this.mnemonic) {
      throw new Error('Mnemonic not loaded');
    }

    const addr = this.derivedAddresses.find(a => a.index === addressIndex);
    if (!addr) {
      throw new Error(`Address not found for index ${addressIndex}`);
    }

    if (addr.bech32 !== sourceAddress) {
      throw new Error(`Address mismatch: expected ${addr.bech32}, got ${sourceAddress}`);
    }

    const lucid = await Lucid.new(undefined, 'Mainnet');
    lucid.selectWalletFromSeed(this.mnemonic, {
      accountIndex: addressIndex,
    });

    const message = `Assign accumulated Scavenger rights to: ${destinationAddress}`;
    const payload = toHex(Buffer.from(message, 'utf8'));
    const signedMessage = await lucid.wallet.signMessage(sourceAddress, payload);

    return signedMessage.signature;
  }
}
