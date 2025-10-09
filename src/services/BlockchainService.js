const { ethers } = require('ethers');
const config = require('../../config');
const ContractModel = require('../models/Contract');

const ESCROW_VAULT_ABI = [
  'function token() view returns (address)',
  'function feePercent() view returns (uint256)',
  'function feeWallet1() view returns (address)',
  'function feeWallet2() view returns (address)',
  'function feeWallet3() view returns (address)',
  'function release(address to, uint256 amount) external',
  'function refund(address to, uint256 amount) external'
];

class BlockchainService {
  constructor() {
    // Use Sepolia RPC if available, otherwise BSC
    const rpcUrl = config.SEPOLIA_RPC_URL || config.BSC_RPC_URL;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // Ensure private key has 0x prefix
    const privateKey = config.HOT_WALLET_PRIVATE_KEY.startsWith('0x') 
      ? config.HOT_WALLET_PRIVATE_KEY 
      : '0x' + config.HOT_WALLET_PRIVATE_KEY;
    
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.vault = null;
  }

  async initialize() {
    try {
      const entry = await ContractModel.findOne({ name: 'EscrowVault' });
      if (!entry) {
        console.log('No EscrowVault found in database');
        throw new Error('EscrowVault not deployed / not saved');
      }
      console.log('Found EscrowVault in DB:', entry.address, 'on', entry.network);
      this.vault = new ethers.Contract(entry.address, ESCROW_VAULT_ABI, this.wallet);
      return entry.address;
    } catch (error) {
      console.error('Error initializing BlockchainService:', error);
      throw error;
    }
  }

  async release(to, amountUSDT) {
    // amountUSDT is decimal amount, convert to 6 decimals
    const amount = ethers.parseUnits(String(amountUSDT), 6);
    const tx = await this.vault.release(to, amount);
    return await tx.wait();
  }

  async refund(to, amountUSDT) {
    const amount = ethers.parseUnits(String(amountUSDT), 6);
    const tx = await this.vault.refund(to, amount);
    return await tx.wait();
  }
}

module.exports = new BlockchainService();


