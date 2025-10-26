const mongoose = require('mongoose');

const escrowSchema = new mongoose.Schema({
  escrowId: {
    type: String,
    required: true,
    unique: true
  },
  creatorId: {
    type: Number,
    required: false
  },
  creatorUsername: {
    type: String,
    required: false
  },
  groupId: {
    type: String,
    required: true
  },
  assignedFromPool: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed', 'completed', 'refunded'],
    default: 'draft'
  },
  token: {
    type: String,
    default: 'USDT'
  },
  chain: {
    type: String,
    default: 'BSC'
  },
  quantity: {
    type: Number,
    required: false
  },
  rate: {
    type: Number,
    required: false
  },
  buyerId: {
    type: Number,
    required: false
  },
  buyerUsername: {
    type: String,
    required: false
  },
  sellerId: {
    type: Number,
    required: false
  },
  sellerUsername: {
    type: String,
    required: false
  },
  buyerAddress: String,
  sellerAddress: String,
  depositAddress: String,
  uniqueDepositAddress: String,
  tradeTimeout: {
    type: Date,
    default: null
  },
  timeoutStatus: {
    type: String,
    enum: ['active', 'expired', 'cancelled'],
    default: null
  },
  isAbandoned: {
    type: Boolean,
    default: false
  },
  abandonedAt: {
    type: Date,
    default: null
  },
  inviteLink: String,
  depositAmount: {
    type: Number,
    default: 0
  },
  confirmedAmount: {
    type: Number,
    default: 0
  },
  escrowFee: {
    type: Number,
    default: 0
  },
  networkFee: {
    type: Number,
    default: 0
  },
  buyerSentFiat: {
    type: Boolean,
    default: false
  },
  sellerReceivedFiat: {
    type: Boolean,
    default: false
  },
  buyerConfirmedRelease: {
    type: Boolean,
    default: false
  },
  sellerConfirmedRelease: {
    type: Boolean,
    default: false
  },
  buyerConfirmedRefund: {
    type: Boolean,
    default: false
  },
  sellerConfirmedRefund: {
    type: Boolean,
    default: false
  },
  isDisputed: {
    type: Boolean,
    default: false
  },
  disputeReason: String,
  disputeRaisedAt: Date,
  disputeRaisedBy: Number, // User ID who raised the dispute
  disputeResolvedBy: String, // Admin username who resolved
  disputeResolvedAt: Date,
  disputeResolution: {
    type: String,
    enum: ['release', 'refund', 'pending']
  },
  disputeResolutionReason: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Escrow', escrowSchema);
