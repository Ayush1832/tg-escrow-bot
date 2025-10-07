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
    this.provider = new ethers.JsonRpcProvider(config.BSC_RPC_URL);
    this.wallet = new ethers.Wallet(config.HOT_WALLET_PRIVATE_KEY, this.provider);
    this.vault = null;
  }

  async initialize() {
    const entry = await ContractModel.findOne({ name: 'EscrowVault' });
    if (!entry) throw new Error('EscrowVault not deployed / not saved');
    this.vault = new ethers.Contract(entry.address, ESCROW_VAULT_ABI, this.wallet);
    return entry.address;
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


