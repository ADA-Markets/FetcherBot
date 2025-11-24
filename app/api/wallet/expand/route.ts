import { NextRequest, NextResponse } from 'next/server';
import { WalletManager } from '@/lib/wallet/manager';

/**
 * POST /api/wallet/expand
 * Expand wallet by deriving additional addresses
 * Requires: password, newTotal (target total address count)
 */
export async function POST(request: NextRequest) {
  try {
    const { password, newTotal } = await request.json();

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    if (!newTotal || typeof newTotal !== 'number') {
      return NextResponse.json(
        { error: 'newTotal is required and must be a number' },
        { status: 400 }
      );
    }

    if (newTotal < 1 || newTotal > 500) {
      return NextResponse.json(
        { error: 'newTotal must be between 1 and 500' },
        { status: 400 }
      );
    }

    const manager = new WalletManager();

    // Check if wallet exists
    if (!manager.walletExists()) {
      return NextResponse.json(
        { error: 'No wallet found. Please create a wallet first.' },
        { status: 400 }
      );
    }

    // Load the wallet with the provided password
    try {
      await manager.loadWallet(password);
    } catch (err: any) {
      return NextResponse.json(
        { error: 'Failed to load wallet. Incorrect password?' },
        { status: 401 }
      );
    }

    const currentCount = manager.getDerivedAddresses().length;

    if (newTotal <= currentCount) {
      return NextResponse.json(
        { error: `New total (${newTotal}) must be greater than current count (${currentCount})` },
        { status: 400 }
      );
    }

    // Expand the wallet
    const result = await manager.expandAddresses(newTotal);

    return NextResponse.json({
      success: true,
      message: `Successfully added ${result.added} new addresses`,
      previousCount: currentCount,
      added: result.added,
      total: result.total,
    });
  } catch (error: any) {
    console.error('[API] Wallet expand error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to expand wallet' },
      { status: 500 }
    );
  }
}
