const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "EscrowVault"
  token: { type: String, required: true }, // e.g., "USDT"
  network: { type: String, required: true }, // e.g., "SEPOLIA"
  address: { type: String, required: true },
  feePercent: { type: Number, required: true, default: 0 }, // Fee percentage in basis points (100 = 1%)
  deployedAt: { type: Date, default: Date.now }
});

// Compound unique index for token-network-feePercent combinations
contractSchema.index({ name: 1, token: 1, network: 1, feePercent: 1 }, { unique: true });

module.exports = mongoose.model('Contract', contractSchema);


