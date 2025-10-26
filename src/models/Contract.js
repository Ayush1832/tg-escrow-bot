const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "EscrowVault"
  token: { type: String, required: true }, // e.g., "USDT"
  network: { type: String, required: true }, // e.g., "SEPOLIA"
  address: { type: String, required: true },
  feePercent: { type: Number, required: true, default: 0 }, // Fee percentage (1 = 1%)
  status: { type: String, default: 'deployed' }, // Status of the contract
  deployedAt: { type: Date, default: Date.now }
});

// Each contract address should be unique
contractSchema.index({ address: 1 }, { unique: true });

module.exports = mongoose.model('Contract', contractSchema);


