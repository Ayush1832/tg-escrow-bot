const mongoose = require('mongoose');

const depositAddressSchema = new mongoose.Schema({
  escrowId: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true,
    unique: true
  },
  derivationPath: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'used'],
    default: 'active'
  },
  observedAmount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('DepositAddress', depositAddressSchema);
