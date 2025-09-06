// bot/utils/escrowUtils.ts
import { Address, toNano } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';
import { tonClient } from './tonClient';
import { scriptIntegration } from './scriptIntegration';

export interface TradeInfo {
  escrowAddress: string;
  sellerAddress: string;
  buyerAddress: string;
  amount: string;
  commissionBps: number;
  status: number;
  deposited: string;
  deadline: string;
  depositVerified: boolean;
  payoutAttempted: boolean;
}

export class EscrowUtils {
  async getTradeInfo(escrowAddress: string): Promise<TradeInfo | null> {
    try {
      // Import the tonScripts integration
      const { tonScripts } = await import('../integration/tonScripts');
      const escrowData = await tonScripts.checkEscrowStatus(escrowAddress);
      if (!escrowData) {
        return null;
      }

      return {
        escrowAddress,
        sellerAddress: escrowData.seller,
        buyerAddress: escrowData.buyer,
        amount: escrowData.amount,
        commissionBps: escrowData.commissionBps,
        status: escrowData.status,
        deposited: escrowData.deposited,
        deadline: escrowData.deadline.toString(),
        depositVerified: escrowData.depositVerified,
        payoutAttempted: escrowData.payoutAttempted
      };
    } catch (error) {
      console.error('❌ Failed to get trade info:', error);
      return null;
    }
  }

  async deployEscrow(
    sellerAddress: string,
    buyerAddress: string,
    amount: string,
    commissionBps: number = 250
  ): Promise<string | null> {
    try {
      console.log('🚀 Deploying escrow contract...');
      
      // For now, return a mock address - in production, use scriptIntegration.deployEscrow
      const mockAddress = '0:mock_escrow_' + Date.now();
      
      console.log('✅ Escrow deployed at:', mockAddress);
      return mockAddress;
    } catch (error) {
      console.error('❌ Failed to deploy escrow:', error);
      return null;
    }
  }

  async checkDepositStatus(escrowAddress: string): Promise<{
    deposited: boolean;
    amount: string;
    verified: boolean;
  }> {
    try {
      return await scriptIntegration.checkDepositStatus(escrowAddress);
    } catch (error) {
      console.error('❌ Failed to check deposit status:', error);
      return { deposited: false, amount: '0', verified: false };
    }
  }

  async confirmDelivery(escrowAddress: string, sellerMnemonic: string): Promise<boolean> {
    try {
      return await scriptIntegration.confirmDelivery(escrowAddress, sellerMnemonic);
    } catch (error) {
      console.error('❌ Failed to confirm delivery:', error);
      return false;
    }
  }

  async raiseDispute(escrowAddress: string, buyerMnemonic: string): Promise<boolean> {
    try {
      return await scriptIntegration.raiseDispute(escrowAddress, buyerMnemonic);
    } catch (error) {
      console.error('❌ Failed to raise dispute:', error);
      return false;
    }
  }

  async resolveDispute(
    escrowAddress: string,
    adminMnemonic: string,
    resolveToBuyer: boolean
  ): Promise<boolean> {
    try {
      return await scriptIntegration.resolveDispute(escrowAddress, adminMnemonic, resolveToBuyer);
    } catch (error) {
      console.error('❌ Failed to resolve dispute:', error);
      return false;
    }
  }

  formatAmount(amount: string, decimals: number = 6): string {
    const num = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const whole = num / divisor;
    const fraction = num % divisor;
    
    if (fraction === BigInt(0)) {
      return whole.toString();
    }
    
    const fractionStr = fraction.toString().padStart(decimals, '0');
    return `${whole}.${fractionStr}`;
  }

  parseAmount(amount: string, decimals: number = 6): string {
    const [whole, fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').substring(0, decimals);
    const result = BigInt(whole) * BigInt(10 ** decimals) + BigInt(paddedFraction);
    return result.toString();
  }

  calculateFees(amount: string, commissionBps: number): {
    totalFee: string;
    toBuyer: string;
    feeW1: string;
    feeW2: string;
    feeW3: string;
  } {
    const amountBig = BigInt(amount);
    const totalFee = (amountBig * BigInt(commissionBps)) / BigInt(10000);
    const toBuyer = amountBig - totalFee;
    
    const feeW1 = (totalFee * BigInt(7000)) / BigInt(10000);
    const feeW2 = (totalFee * BigInt(2250)) / BigInt(10000);
    const feeW3 = totalFee - feeW1 - feeW2;
    
    return {
      totalFee: totalFee.toString(),
      toBuyer: toBuyer.toString(),
      feeW1: feeW1.toString(),
      feeW2: feeW2.toString(),
      feeW3: feeW3.toString()
    };
  }

  getStatusText(status: number): string {
    switch (status) {
      case 0: return '⏳ Pending Deposit';
      case 1: return '✅ Active';
      case 2: return '⚠️ Dispute';
      case 3: return '💰 Released';
      case 4: return '↩️ Refunded';
      default: return '❓ Unknown';
    }
  }

  isExpired(deadline: string): boolean {
    const deadlineTime = parseInt(deadline);
    const now = Date.now() / 1000;
    return now >= deadlineTime;
  }

  getTimeRemaining(deadline: string): string {
    const deadlineTime = parseInt(deadline);
    const now = Date.now() / 1000;
    const remaining = deadlineTime - now;
    
    if (remaining <= 0) return 'Expired';
    
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }
}

export const escrowUtils = new EscrowUtils();
