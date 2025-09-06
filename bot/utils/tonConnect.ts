// bot/utils/tonConnect.ts
import { Address } from '@ton/core';

export interface WalletInfo {
  address: string;
  publicKey: string;
  connected: boolean;
}

export class TONConnectService {
  public connectedWallets: Map<number, WalletInfo> = new Map();

  constructor() {
    // Simple wallet connection service
    // In production, this would integrate with proper TON Connect
  }



  /**
   * Get connected wallet for user
   */
  getConnectedWallet(userId: number): WalletInfo | null {
    return this.connectedWallets.get(userId) || null;
  }

  /**
   * Disconnect wallet for user
   */
  disconnectWallet(userId: number): void {
    this.connectedWallets.delete(userId);
  }

  /**
   * Check if user has connected wallet
   */
  isWalletConnected(userId: number): boolean {
    return this.connectedWallets.has(userId);
  }



  /**
   * Format address for display
   */
  formatAddress(address: string): string {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  }

  /**
   * Validate TON address
   */
  isValidAddress(address: string): boolean {
    try {
      Address.parse(address);
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const tonConnectService = new TONConnectService();
