// bot/utils/scriptIntegration.ts
import { execSync, spawn } from 'child_process';
import * as path from 'path';

export class ScriptIntegration {
  private projectRoot: string;

  constructor() {
    this.projectRoot = path.resolve(__dirname, '../..');
  }

  async deployEscrow(
    sellerMnemonic: string,
    buyerAddress: string,
    amount: string,
    commissionBps: number
  ): Promise<string | null> {
    try {
      console.log('🚀 Deploying escrow via script...');
      
      // Set environment variables for the script
      const env = {
        ...process.env,
        SELLER_MNEMONIC: sellerMnemonic,
        BUYER_ADDRESS: buyerAddress,
        AMOUNT_JETTON_UNITS: amount,
        COMMISSION_BPS: commissionBps.toString()
      };

      // Run the deploy script
      const result = execSync(
        'npx blueprint run scripts/ton/deploy-escrow.ts -t testnet',
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      // Parse the result to extract escrow address
      const addressMatch = result.match(/Contract address: (.+)/);
      if (addressMatch) {
        return addressMatch[1].trim();
      }

      console.log('Deploy script output:', result);
      return null;
    } catch (error) {
      console.error('❌ Error deploying escrow:', error);
      return null;
    }
  }

  async checkDepositStatus(escrowAddress: string): Promise<{
    deposited: boolean;
    amount: string;
    verified: boolean;
  }> {
    try {
      console.log('🔍 Checking deposit status via script...');
      
      const env = {
        ...process.env,
        ESCROW_ADDRESS: escrowAddress
      };

      // In production, you'd create a script to check deposit status
      // For now, return mock data
      return {
        deposited: false,
        amount: '0',
        verified: false
      };
    } catch (error) {
      console.error('❌ Error checking deposit status:', error);
      return { deposited: false, amount: '0', verified: false };
    }
  }

  async confirmDelivery(
    escrowAddress: string,
    sellerMnemonic: string
  ): Promise<boolean> {
    try {
      console.log('✅ Confirming delivery via script...');
      
      const env = {
        ...process.env,
        SELLER_MNEMONIC: sellerMnemonic,
        ESCROW_ADDRESS: escrowAddress
      };

      const result = execSync(
        'npx blueprint run scripts/ton/confirm-delivery.ts -t testnet',
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      console.log('Confirm delivery output:', result);
      return result.includes('✅');
    } catch (error) {
      console.error('❌ Error confirming delivery:', error);
      return false;
    }
  }

  async raiseDispute(
    escrowAddress: string,
    buyerMnemonic: string
  ): Promise<boolean> {
    try {
      console.log('⚠️ Raising dispute via script...');
      
      const env = {
        ...process.env,
        BUYER_MNEMONIC: buyerMnemonic,
        ESCROW_ADDRESS: escrowAddress
      };

      const result = execSync(
        'npx blueprint run scripts/ton/raise-dispute.ts -t testnet',
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      console.log('Raise dispute output:', result);
      return result.includes('✅');
    } catch (error) {
      console.error('❌ Error raising dispute:', error);
      return false;
    }
  }

  async resolveDispute(
    escrowAddress: string,
    adminMnemonic: string,
    resolveToBuyer: boolean
  ): Promise<boolean> {
    try {
      console.log('🔧 Resolving dispute via script...');
      
      const env = {
        ...process.env,
        ADMIN_MNEMONIC: adminMnemonic,
        ESCROW_ADDRESS: escrowAddress,
        RESOLVE_TO_BUYER: resolveToBuyer.toString(),
        RESOLVE_TO_SELLER: (!resolveToBuyer).toString()
      };

      const args = resolveToBuyer ? '-- --buyer' : '-- --seller';
      const result = execSync(
        `npx blueprint run scripts/ton/resolve-dispute.ts -t testnet ${args}`,
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      console.log('Resolve dispute output:', result);
      return result.includes('✅');
    } catch (error) {
      console.error('❌ Error resolving dispute:', error);
      return false;
    }
  }

  async retryPayout(
    escrowAddress: string,
    adminMnemonic: string
  ): Promise<boolean> {
    try {
      console.log('🔄 Retrying payout via script...');
      
      const env = {
        ...process.env,
        ADMIN_MNEMONIC: adminMnemonic,
        ESCROW_ADDRESS: escrowAddress
      };

      const result = execSync(
        'npx blueprint run scripts/ton/retry-payout.ts -t testnet',
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      console.log('Retry payout output:', result);
      return result.includes('✅');
    } catch (error) {
      console.error('❌ Error retrying payout:', error);
      return false;
    }
  }

  async cancelNoDeposit(
    escrowAddress: string,
    userMnemonic: string,
    isAdmin: boolean = false
  ): Promise<boolean> {
    try {
      console.log('❌ Cancelling trade via script...');
      
      const env: any = {
        ...process.env,
        ESCROW_ADDRESS: escrowAddress
      };

      if (isAdmin) {
        env.ADMIN_MNEMONIC = userMnemonic;
      } else {
        env.SELLER_MNEMONIC = userMnemonic;
      }

      const result = execSync(
        'npx blueprint run scripts/ton/cancel-no-deposit.ts -t testnet',
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      console.log('Cancel trade output:', result);
      return result.includes('✅');
    } catch (error) {
      console.error('❌ Error cancelling trade:', error);
      return false;
    }
  }

  async claimExpired(
    escrowAddress: string,
    buyerMnemonic: string
  ): Promise<boolean> {
    try {
      console.log('⏰ Claiming expired trade via script...');
      
      const env = {
        ...process.env,
        BUYER_MNEMONIC: buyerMnemonic,
        ESCROW_ADDRESS: escrowAddress
      };

      const result = execSync(
        'npx blueprint run scripts/ton/claim-expired.ts -t testnet',
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      console.log('Claim expired output:', result);
      return result.includes('✅');
    } catch (error) {
      console.error('❌ Error claiming expired trade:', error);
      return false;
    }
  }

  async getEscrowData(escrowAddress: string): Promise<any> {
    try {
      console.log('📊 Getting escrow data...');
      
      // In production, you'd create a script to query escrow data
      // For now, return mock data
      return {
        status: 0, // PendingDeposit
        seller: '0:mock_seller',
        buyer: '0:mock_buyer',
        admin: '0:mock_admin',
        amount: '1000000',
        deposited: '0',
        commissionBps: 250,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        depositVerified: false,
        payoutAttempted: false
      };
    } catch (error) {
      console.error('❌ Error getting escrow data:', error);
      return null;
    }
  }

  async computeJettonWallet(
    ownerAddress: string,
    jettonMasterAddress: string
  ): Promise<string | null> {
    try {
      console.log('🔍 Computing jetton wallet address...');
      
      const env = {
        ...process.env,
        OWNER_ADDRESS: ownerAddress,
        JETTON_MASTER: jettonMasterAddress
      };

      const result = execSync(
        'npx blueprint run scripts/ton/compute-jetton-wallet.ts -t testnet',
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      // Parse the result to extract jetton wallet address
      const addressMatch = result.match(/Jetton wallet address: (.+)/);
      if (addressMatch) {
        return addressMatch[1].trim();
      }

      console.log('Compute jetton wallet output:', result);
      return null;
    } catch (error) {
      console.error('❌ Error computing jetton wallet:', error);
      return null;
    }
  }

  async executeScript(
    scriptName: string,
    envVars: Record<string, string> = {},
    args: string = ''
  ): Promise<string> {
    try {
      console.log(`🔧 Executing script: ${scriptName}`);
      
      const env = {
        ...process.env,
        ...envVars
      };

      const result = execSync(
        `npx blueprint run scripts/ton/${scriptName} -t testnet ${args}`,
        {
          cwd: this.projectRoot,
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      console.log(`Script ${scriptName} output:`, result);
      return result;
    } catch (error) {
      console.error(`❌ Error executing script ${scriptName}:`, error);
      throw error;
    }
  }
}

export const scriptIntegration = new ScriptIntegration();
