const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "EscrowVault"
  token: { type: String, required: true }, // e.g., "USDT", "USDC"
  network: { type: String, required: true }, // e.g., "BSC", "ETH", "SEPOLIA"
  address: { type: String, required: true },
  feePercent: { type: Number, required: true, default: 0 }, // Fee percentage (1 = 1%)
  status: { type: String, default: 'deployed' }, // Status of the contract
  deployedAt: { type: Date, default: Date.now }
});

// Each contract address should be unique
contractSchema.index({ address: 1 }, { unique: true });
// Index for efficient querying by token, network, and feePercent
contractSchema.index({ token: 1, network: 1, feePercent: 1 });

module.exports = mongoose.model('Contract', contractSchema);


