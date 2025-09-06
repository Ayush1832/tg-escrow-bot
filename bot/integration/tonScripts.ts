// bot/integration/tonScripts.ts
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { database, TradeRecord } from '../utils/database';

export class TONScriptsIntegration {
  private projectRoot: string;
  private tradesFile: string;

  constructor() {
    this.projectRoot = path.resolve(__dirname, '../..');
    this.tradesFile = path.join(this.projectRoot, 'data', 'trades.json');
  }

  async deployEscrow(
    sellerMnemonic: string,
    sellerUserId: number,
    sellerUsername: string,
    buyerUsername: string,
    amount: string,
    commissionBps: number = 250
  ): Promise<string | null> {
    try {
      console.log('🚀 Deploying escrow contract...');
      
      // Create trade record
      const tradeRecord = {
        escrowAddress: '', // Will be filled after deployment
        sellerUserId,
        sellerUsername,
        buyerUsername,
        amount,
        commissionBps,
        status: 'pending' as const,
        createdAt: database.getCurrentTimestamp(),
        updatedAt: database.getCurrentTimestamp()
      };

      // For now, create a mock escrow address
      // In production, this would call your deploy-escrow.ts script
      const escrowAddress = `0:escrow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      tradeRecord.escrowAddress = escrowAddress;
      await database.saveTrade(tradeRecord);
      
      console.log('✅ Escrow deployed and recorded:', escrowAddress);
      return escrowAddress;
    } catch (error) {
      console.error('❌ Error deploying escrow:', error);
      return null;
    }
  }

  async checkEscrowStatus(escrowAddress: string): Promise<any> {
    try {
      console.log('🔍 Checking escrow status...');
      
      // Get from database
      const trade = await database.getTrade(escrowAddress);
      if (!trade) {
        return null;
      }

      // In production, query the actual contract
      // For now, return mock data based on database record
      return {
        status: trade.status === 'pending' ? 0 : trade.status === 'active' ? 1 : 2,
        seller: '0:mock_seller',
        buyer: '0:mock_buyer',
        admin: process.env.ADMIN_ADDRESS || '0:mock_admin',
        amount: trade.amount,
        deposited: trade.status === 'pending' ? '0' : trade.amount,
        commissionBps: trade.commissionBps,
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        depositVerified: trade.status !== 'pending',
        payoutAttempted: trade.status === 'completed'
      };
    } catch (error) {
      console.error('❌ Error checking escrow status:', error);
      return null;
    }
  }

  async confirmDelivery(
    escrowAddress: string,
    sellerUserId: number
  ): Promise<boolean> {
    try {
      console.log('✅ Confirming delivery...');
      
      // Update trade status
      const trade = await database.getTrade(escrowAddress);
      if (!trade) {
        console.error('❌ Trade not found');
        return false;
      }

      if (trade.sellerUserId !== sellerUserId) {
        console.error('❌ Unauthorized seller');
        return false;
      }

      trade.status = 'completed';
      trade.updatedAt = database.getCurrentTimestamp();
      trade.confirmTxHash = `mock_confirm_${Date.now()}`;
      
      await database.saveTrade(trade);
      
      console.log('✅ Delivery confirmed and recorded');
      return true;
    } catch (error) {
      console.error('❌ Error confirming delivery:', error);
      return false;
    }
  }

  async raiseDispute(
    escrowAddress: string,
    buyerUserId: number,
    reason: string = 'Payment made but seller not confirming'
  ): Promise<boolean> {
    try {
      console.log('⚠️ Raising dispute...');
      
      // Get trade
      const trade = await database.getTrade(escrowAddress);
      if (!trade) {
        console.error('❌ Trade not found');
        return false;
      }

      if (trade.buyerUserId !== buyerUserId) {
        console.error('❌ Unauthorized buyer');
        return false;
      }

      // Create dispute record
      const dispute = {
        id: database.generateDisputeId(),
        escrowAddress,
        buyerUserId,
        sellerUserId: trade.sellerUserId,
        reason,
        status: 'pending' as const,
        createdAt: database.getCurrentTimestamp()
      };

      await database.saveDispute(dispute);
      
      // Update trade status
      trade.status = 'dispute';
      trade.updatedAt = database.getCurrentTimestamp();
      trade.disputeReason = reason;
      
      await database.saveTrade(trade);
      
      console.log('✅ Dispute raised and recorded');
      return true;
    } catch (error) {
      console.error('❌ Error raising dispute:', error);
      return false;
    }
  }

  async resolveDispute(
    escrowAddress: string,
    adminUserId: number,
    resolveToBuyer: boolean
  ): Promise<boolean> {
    try {
      console.log('🔧 Resolving dispute...');
      
      // Get trade and dispute
      const trade = await database.getTrade(escrowAddress);
      if (!trade) {
        console.error('❌ Trade not found');
        return false;
      }

      const disputes = await database.getAllDisputes();
      const dispute = disputes.find(d => d.escrowAddress === escrowAddress && d.status === 'pending');
      
      if (!dispute) {
        console.error('❌ Active dispute not found');
        return false;
      }

      // Update dispute
      dispute.status = 'resolved';
      dispute.resolvedAt = database.getCurrentTimestamp();
      dispute.resolution = resolveToBuyer ? 'buyer' : 'seller';
      dispute.adminUserId = adminUserId;
      
      await database.saveDispute(dispute);
      
      // Update trade
      trade.status = 'completed';
      trade.updatedAt = database.getCurrentTimestamp();
      trade.resolutionTxHash = `mock_resolution_${Date.now()}`;
      
      await database.saveTrade(trade);
      
      console.log(`✅ Dispute resolved in favor of ${resolveToBuyer ? 'buyer' : 'seller'}`);
      return true;
    } catch (error) {
      console.error('❌ Error resolving dispute:', error);
      return false;
    }
  }

  async getTradesByStatus(status: string): Promise<TradeRecord[]> {
    try {
      const trades = this.loadTrades();
      return trades.filter(t => t.status === status);
    } catch (error) {
      console.error('❌ Error getting trades by status:', error);
      return [];
    }
  }

  async getActiveDisputes(): Promise<any[]> {
    try {
      const disputes = await database.getAllDisputes();
      const activeDisputes = disputes.filter(d => d.status === 'pending');
      
      // Enrich with trade information
      const enrichedDisputes = [];
      for (const dispute of activeDisputes) {
        const trade = await database.getTrade(dispute.escrowAddress);
        if (trade) {
          enrichedDisputes.push({
            ...dispute,
            amount: trade.amount,
            sellerUsername: trade.sellerUsername,
            buyerUsername: trade.buyerUsername
          });
        }
      }
      
      return enrichedDisputes;
    } catch (error) {
      console.error('❌ Error getting active disputes:', error);
      return [];
    }
  }

  private loadTrades(): TradeRecord[] {
    try {
      const data = fs.readFileSync(this.tradesFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error loading trades:', error);
      return [];
    }
  }

  async updateTradeStatus(
    escrowAddress: string,
    status: 'pending' | 'active' | 'dispute' | 'completed' | 'cancelled',
    additionalData: any = {}
  ): Promise<boolean> {
    try {
      const trade = await database.getTrade(escrowAddress);
      if (!trade) {
        return false;
      }

      trade.status = status;
      trade.updatedAt = database.getCurrentTimestamp();
      
      // Add any additional data
      Object.assign(trade, additionalData);
      
      await database.saveTrade(trade);
      return true;
    } catch (error) {
      console.error('❌ Error updating trade status:', error);
      return false;
    }
  }

  async logTradeEvent(
    escrowAddress: string,
    event: string,
    data: any = {}
  ): Promise<void> {
    try {
      console.log(`📝 Trade Event: ${event} for ${escrowAddress}`, data);
      
      // In production, you might want to store events separately
      // For now, just log them
    } catch (error) {
      console.error('❌ Error logging trade event:', error);
    }
  }
}

export const tonScripts = new TONScriptsIntegration();
