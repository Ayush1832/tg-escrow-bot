// bot/utils/database.ts
import * as fs from 'fs';
import * as path from 'path';

export interface SellerProfile {
  userId: number;
  username: string;
  walletAddress: string;
  bankDetails: {
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName: string;
  };
  upiId: string;
  phoneNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradeRecord {
  tradeId: string;
  escrowAddress?: string;
  sellerUserId: number;
  buyerUserId?: number;
  sellerUsername: string;
  buyerUsername?: string;
  buyerWalletAddress?: string;
  amount: string;
  commissionBps: number;
  groupId?: number;
  groupTitle?: string;
  status: 'pending' | 'active' | 'deposited' | 'payment_pending' | 'payment_confirmed' | 'completed' | 'dispute' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  depositTxHash?: string;
  confirmTxHash?: string;
  releaseTxHash?: string;
  disputeReason?: string;
  resolutionTxHash?: string;
  bankTransferConfirmed?: boolean;
}

export interface DisputeRecord {
  id: string;
  escrowAddress: string;
  buyerUserId: number;
  sellerUserId: number;
  reason: string;
  status: 'pending' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
  resolution?: 'buyer' | 'seller';
  adminUserId?: number;
}

export class Database {
  private tradesFile: string;
  private disputesFile: string;
  private sellersFile: string;
  private dataDir: string;

  constructor() {
    this.dataDir = path.join(__dirname, '../../data');
    this.tradesFile = path.join(this.dataDir, 'trades.json');
    this.disputesFile = path.join(this.dataDir, 'disputes.json');
    this.sellersFile = path.join(this.dataDir, 'sellers.json');
    this.ensureDataDir();
  }

  private ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.tradesFile)) {
      fs.writeFileSync(this.tradesFile, JSON.stringify([], null, 2));
    }
    
    if (!fs.existsSync(this.disputesFile)) {
      fs.writeFileSync(this.disputesFile, JSON.stringify([], null, 2));
    }
    
    if (!fs.existsSync(this.sellersFile)) {
      fs.writeFileSync(this.sellersFile, JSON.stringify([], null, 2));
    }
  }

  // Trade operations
  async saveTrade(trade: TradeRecord): Promise<void> {
    try {
      const trades = this.loadTrades();
      const existingIndex = trades.findIndex(t => t.escrowAddress === trade.escrowAddress);
      
      if (existingIndex >= 0) {
        trades[existingIndex] = trade;
      } else {
        trades.push(trade);
      }
      
      fs.writeFileSync(this.tradesFile, JSON.stringify(trades, null, 2));
    } catch (error) {
      console.error('❌ Error saving trade:', error);
    }
  }

  async getTrade(escrowAddress: string): Promise<TradeRecord | null> {
    try {
      const trades = this.loadTrades();
      return trades.find(t => t.escrowAddress === escrowAddress) || null;
    } catch (error) {
      console.error('❌ Error getting trade:', error);
      return null;
    }
  }

  async getTradeByGroupId(groupId: number): Promise<TradeRecord | null> {
    try {
      const trades = this.loadTrades();
      return trades.find(t => t.groupId === groupId) || null;
    } catch (error) {
      console.error('❌ Error getting trade by group ID:', error);
      return null;
    }
  }

  async getTradeByTradeId(tradeId: string): Promise<TradeRecord | null> {
    try {
      const trades = this.loadTrades();
      return trades.find(t => t.tradeId === tradeId) || null;
    } catch (error) {
      console.error('❌ Error getting trade by trade ID:', error);
      return null;
    }
  }

  async getTradesByUser(userId: number, role: 'seller' | 'buyer'): Promise<TradeRecord[]> {
    try {
      const trades = this.loadTrades();
      if (role === 'seller') {
        return trades.filter(t => t.sellerUserId === userId);
      } else {
        return trades.filter(t => t.buyerUserId === userId);
      }
    } catch (error) {
      console.error('❌ Error getting user trades:', error);
      return [];
    }
  }

  async getAllTrades(): Promise<TradeRecord[]> {
    try {
      return this.loadTrades();
    } catch (error) {
      console.error('❌ Error getting all trades:', error);
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

  // Dispute operations
  async saveDispute(dispute: DisputeRecord): Promise<void> {
    try {
      const disputes = this.loadDisputes();
      const existingIndex = disputes.findIndex(d => d.id === dispute.id);
      
      if (existingIndex >= 0) {
        disputes[existingIndex] = dispute;
      } else {
        disputes.push(dispute);
      }
      
      fs.writeFileSync(this.disputesFile, JSON.stringify(disputes, null, 2));
    } catch (error) {
      console.error('❌ Error saving dispute:', error);
    }
  }

  async getDispute(id: string): Promise<DisputeRecord | null> {
    try {
      const disputes = this.loadDisputes();
      return disputes.find(d => d.id === id) || null;
    } catch (error) {
      console.error('❌ Error getting dispute:', error);
      return null;
    }
  }

  async getActiveDisputes(): Promise<DisputeRecord[]> {
    try {
      const disputes = this.loadDisputes();
      return disputes.filter(d => d.status === 'pending');
    } catch (error) {
      console.error('❌ Error getting active disputes:', error);
      return [];
    }
  }

  async getAllDisputes(): Promise<DisputeRecord[]> {
    try {
      return this.loadDisputes();
    } catch (error) {
      console.error('❌ Error getting all disputes:', error);
      return [];
    }
  }

  private loadDisputes(): DisputeRecord[] {
    try {
      const data = fs.readFileSync(this.disputesFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error loading disputes:', error);
      return [];
    }
  }

  // Seller Profile operations
  async saveSellerProfile(profile: SellerProfile): Promise<void> {
    try {
      const profiles = this.loadSellerProfiles();
      const existingIndex = profiles.findIndex(p => p.userId === profile.userId);
      
      if (existingIndex >= 0) {
        profiles[existingIndex] = profile;
      } else {
        profiles.push(profile);
      }
      
      fs.writeFileSync(this.sellersFile, JSON.stringify(profiles, null, 2));
    } catch (error) {
      console.error('❌ Error saving seller profile:', error);
    }
  }

  async getSellerProfile(userId: number): Promise<SellerProfile | null> {
    try {
      const profiles = this.loadSellerProfiles();
      return profiles.find(p => p.userId === userId) || null;
    } catch (error) {
      console.error('❌ Error getting seller profile:', error);
      return null;
    }
  }

  async getAllSellerProfiles(): Promise<SellerProfile[]> {
    try {
      return this.loadSellerProfiles();
    } catch (error) {
      console.error('❌ Error getting all seller profiles:', error);
      return [];
    }
  }

  private loadSellerProfiles(): SellerProfile[] {
    try {
      const data = fs.readFileSync(this.sellersFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error loading seller profiles:', error);
      return [];
    }
  }

  // Statistics
  async getStats(): Promise<{
    totalTrades: number;
    activeTrades: number;
    completedTrades: number;
    disputedTrades: number;
    totalVolume: string;
    totalFees: string;
    avgTradeSize: string;
    successRate: string;
  }> {
    try {
      const trades = this.loadTrades();
      const disputes = this.loadDisputes();
      
      const totalTrades = trades.length;
      const activeTrades = trades.filter(t => t.status === 'active').length;
      const completedTrades = trades.filter(t => t.status === 'completed').length;
      const disputedTrades = disputes.length;
      
      const totalVolumeNum = trades.reduce((sum, trade) => {
        return sum + parseFloat(trade.amount);
      }, 0);
      
      const totalFeesNum = trades.reduce((sum, trade) => {
        const amount = parseFloat(trade.amount);
        const fee = (amount * trade.commissionBps) / 10000;
        return sum + fee;
      }, 0);
      
      const avgTradeSizeNum = totalTrades > 0 ? totalVolumeNum / totalTrades : 0;
      const successRateNum = totalTrades > 0 ? (completedTrades / totalTrades) * 100 : 100;
      
      return {
        totalTrades,
        activeTrades,
        completedTrades,
        disputedTrades,
        totalVolume: totalVolumeNum.toLocaleString() + ' USDT',
        totalFees: totalFeesNum.toFixed(2) + ' USDT',
        avgTradeSize: avgTradeSizeNum.toFixed(1) + ' USDT',
        successRate: successRateNum.toFixed(1) + '%'
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      return {
        totalTrades: 0,
        activeTrades: 0,
        completedTrades: 0,
        disputedTrades: 0,
        totalVolume: '0 USDT',
        totalFees: '0 USDT',
        avgTradeSize: '0 USDT',
        successRate: '100%'
      };
    }
  }

  // Utility methods
  generateDisputeId(): string {
    return `dispute_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getCurrentTimestamp(): string {
    return new Date().toISOString();
  }
}

export const database = new Database();
