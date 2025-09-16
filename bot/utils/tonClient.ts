// bot/utils/tonClient.ts
import { TonClient } from '@ton/ton';
import { Address } from '@ton/core';

export class TONClient {
  private client: TonClient;
  private isTestnet: boolean;

  constructor() {
    this.isTestnet = process.env.TON_NETWORK === 'testnet';

    const defaultEndpoint = this.isTestnet
      ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
      : 'https://toncenter.com/api/v2/jsonRPC';

    const endpoint = process.env.TON_RPC_ENDPOINT || defaultEndpoint;
    const apiKey = process.env.TON_API_KEY || undefined;

    console.log(
      `🌐 TON client config → network: ${this.isTestnet ? 'testnet' : 'mainnet'}, endpoint: ${endpoint}, apiKey: ${apiKey ? 'present' : 'missing'}`
    );

    this.client = new TonClient({
      endpoint,
      apiKey
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection by getting latest block
      const latestBlock = await this.client.getMasterchainInfo();
      console.log(`✅ Connected to ${this.isTestnet ? 'testnet' : 'mainnet'}`);
      console.log(`📦 Latest block: ${latestBlock.latestSeqno}`);
      return true;
    } catch (error) {
      console.error('❌ TON connection failed:', error);
      throw error;
    }
  }

  async getAccountState(address: Address) {
    try {
      // Mock implementation - in production, use proper TON client methods
      console.log(`📊 Getting account state for ${address.toString()}`);
      return { state: 'active' };
    } catch (error) {
      console.error('❌ Failed to get account state:', error);
      throw error;
    }
  }

  async getJettonBalance(jettonWalletAddress: Address): Promise<bigint> {
    try {
      // Mock implementation - in production, parse jetton wallet data
      console.log(`💰 Getting jetton balance for ${jettonWalletAddress.toString()}`);
      return BigInt(0); // Placeholder
    } catch (error) {
      console.error('❌ Failed to get jetton balance:', error);
      return BigInt(0);
    }
  }

  async sendMessage(from: Address, to: Address, value: bigint, body: any) {
    try {
      // This would integrate with your wallet implementation
      console.log(`📤 Sending message from ${from.toString()} to ${to.toString()}`);
      console.log(`💰 Value: ${value.toString()} TON`);
      return true;
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      throw error;
    }
  }

  getClient(): TonClient {
    return this.client;
  }

  isTestnetMode(): boolean {
    return this.isTestnet;
  }
}

export const tonClient = new TONClient();
