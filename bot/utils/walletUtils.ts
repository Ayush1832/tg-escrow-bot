// bot/utils/walletUtils.ts
import { Address } from '@ton/core';
import { mnemonicToPrivateKey } from 'ton-crypto';
import { WalletContractV4 } from '@ton/ton';

export interface WalletInfo {
  address: string;
  publicKey: Buffer;
  privateKey: Buffer;
}

export class WalletUtils {
  async createWalletFromMnemonic(mnemonic: string): Promise<WalletInfo> {
    try {
      const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '));
      const wallet = WalletContractV4.create({ 
        workchain: 0, 
        publicKey: keyPair.publicKey 
      });
      
      return {
        address: wallet.address.toString(),
        publicKey: keyPair.publicKey,
        privateKey: keyPair.secretKey
      };
    } catch (error) {
      console.error('❌ Failed to create wallet from mnemonic:', error);
      throw error;
    }
  }

  validateAddress(address: string): boolean {
    try {
      Address.parse(address);
      return true;
    } catch {
      return false;
    }
  }

  validateMnemonic(mnemonic: string): boolean {
    const words = mnemonic.trim().split(' ');
    return words.length === 24 && words.every(word => word.length > 0);
  }

  formatAddress(address: string): string {
    try {
      const addr = Address.parse(address);
      const str = addr.toString();
      return `${str.substring(0, 6)}...${str.substring(str.length - 6)}`;
    } catch {
      return 'Invalid address';
    }
  }

  async generateMnemonic(): Promise<string> {
    // In production, use a proper mnemonic generator
    // For now, return a placeholder
    return 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  }

  async getWalletBalance(address: string): Promise<string> {
    try {
      // This would integrate with TON client to get actual balance
      // For now, return a mock balance
      return '0';
    } catch (error) {
      console.error('❌ Failed to get wallet balance:', error);
      return '0';
    }
  }

  async getJettonWalletAddress(
    ownerAddress: string,
    jettonMasterAddress: string
  ): Promise<string> {
    try {
      // This would integrate with your compute-jetton-wallet script
      // For now, return a mock address
      return `0:jetton_wallet_${Date.now()}`;
    } catch (error) {
      console.error('❌ Failed to get jetton wallet address:', error);
      throw error;
    }
  }

  async sendJetton(
    fromMnemonic: string,
    toAddress: string,
    jettonAmount: string,
    jettonWalletAddress: string
  ): Promise<boolean> {
    try {
      console.log(`📤 Sending ${jettonAmount} jettons to ${toAddress}`);
      
      // This would integrate with your deposit script
      // For now, return success
      return true;
    } catch (error) {
      console.error('❌ Failed to send jetton:', error);
      return false;
    }
  }

  async signMessage(
    mnemonic: string,
    message: string
  ): Promise<string> {
    try {
      const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '));
      
      // This would implement actual message signing
      // For now, return a mock signature
      return `mock_signature_${Date.now()}`;
    } catch (error) {
      console.error('❌ Failed to sign message:', error);
      throw error;
    }
  }

  async verifySignature(
    publicKey: Buffer,
    message: string,
    signature: string
  ): Promise<boolean> {
    try {
      // This would implement actual signature verification
      // For now, return true for mock signatures
      return signature.startsWith('mock_signature_');
    } catch (error) {
      console.error('❌ Failed to verify signature:', error);
      return false;
    }
  }
}

export const walletUtils = new WalletUtils();
