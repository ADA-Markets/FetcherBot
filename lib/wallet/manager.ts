import fs from 'fs';
import path from 'path';
import { Lucid, toHex } from 'lucid-cardano';
import { encrypt, decrypt, EncryptedData } from './encryption';

// Determine data directory: Use profile-aware path resolver if available,
// otherwise fall back to legacy detection for backwards compatibility
function determineDataDirectory(): string {
  try {
    // Try to use profile-specific path
    const { pathResolver } = require('@/lib/storage/path-resolver');
    return pathResolver.getSecureDir();
  } catch (error) {
    // Fallback for legacy support
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
      console.log(`[Wallet] Using: ${path.join(process.cwd(), 'secure')}`);
      return oldSecureDir;
    }

    // Otherwise use Documents folder (old default)
    console.log(`[Wallet] Using Documents folder: ${newDataDir}/secure`);
    return path.join(newDataDir, 'secure');
  }
}

const SECURE_DIR = determineDataDirectory();
const SEED_FILE = path.join(SECURE_DIR, 'wallet-seed.json.enc');
const DERIVED_ADDRESSES_FILE = path.join(SECURE_DIR, 'derived-addresses.json');

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
    if (!fs.existsSync(SECURE_DIR)) {
      fs.mkdirSync(SECURE_DIR, { recursive: true, mode: 0o700 });
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
    fs.writeFileSync(SEED_FILE, JSON.stringify(encryptedData, null, 2), { mode: 0o600 });

    // Save derived addresses
    fs.writeFileSync(
      DERIVED_ADDRESSES_FILE,
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
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error('No wallet found. Please create a new wallet first.');
    }

    const encryptedData: EncryptedData = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));

    try {
      this.mnemonic = decrypt(encryptedData, password);
    } catch (err) {
      throw new Error('Failed to decrypt wallet. Incorrect password?');
    }

    // Load derived addresses if they exist
    if (fs.existsSync(DERIVED_ADDRESSES_FILE)) {
      this.derivedAddresses = JSON.parse(fs.readFileSync(DERIVED_ADDRESSES_FILE, 'utf8'));
    } else {
      throw new Error('Derived addresses file not found. Wallet may be corrupted.');
    }

    return this.derivedAddresses;
  }

  /**
   * Check if wallet exists
   */
  walletExists(): boolean {
    return fs.existsSync(SEED_FILE);
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
        DERIVED_ADDRESSES_FILE,
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
