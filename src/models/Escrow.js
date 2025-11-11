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
    enum: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'completed', 'refunded'],
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
  paymentMethod: {
    type: String,
    required: false
  },
  // Track which step in the trade details flow we're on
  tradeDetailsStep: {
    type: String,
    enum: ['step1_amount', 'step2_rate', 'step3_payment', 'step4_chain_coin', 'step5_buyer_address', 'step6_seller_address', 'completed'],
    required: false
  },
  // Store Step 5 message ID for deletion
  step5BuyerAddressMessageId: {
    type: Number,
    required: false
  },
  // Store Step 6 message ID for deletion
  step6SellerAddressMessageId: {
    type: Number,
    required: false
  },
  // Store OTC Deal Summary message ID for editing approval status
  dealSummaryMessageId: {
    type: Number,
    required: false
  },
  // Track deal approvals
  buyerApproved: {
    type: Boolean,
    default: false
  },
  sellerApproved: {
    type: Boolean,
    default: false
  },
  // Store transaction hash message ID for editing
  transactionHashMessageId: {
    type: Number,
    required: false
  },
  // Store confirmed transaction hash (deposit transaction)
  transactionHash: {
    type: String,
    required: false,
    index: true // Index for faster duplicate checking
  },
  // Store the actual from address of the deposit transaction (can be any address)
  depositTransactionFromAddress: {
    type: String,
    required: false
  },
  // Store release transaction hash (when funds are released)
  releaseTransactionHash: {
    type: String,
    required: false
  },
  // Store Step 4 message IDs for deletion
  step4ChainMessageId: {
    type: Number,
    required: false
  },
  step4CoinMessageId: {
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
  // Origin message details (main group where /deal was initiated)
  originChatId: {
    type: String,
    required: false
  },
  originInviteMessageId: {
    type: Number,
    required: false
  },
  // Allowed usernames for restricted join requests (when room is created via /deal in a group)
  allowedUsernames: {
    type: [String],
    default: undefined
  },
  // Track which users have been approved and joined (user ids)
  approvedUserIds: {
    type: [Number],
    default: undefined
  },
  // Allowed user ids (used when initiator has no username)
  allowedUserIds: {
    type: [Number],
    default: undefined
  },
  // Store role selection message ID for editing
  roleSelectionMessageId: {
    type: Number,
    required: false
  },
  buyerAddress: String,
  sellerAddress: String,
  depositAddress: String,
  uniqueDepositAddress: String,
  tradeStartTime: {
    type: Date,
    default: null
  },
  lastCheckedBlock: {
    type: Number,
    default: 0
  },
  // Track close trade confirmations
  buyerClosedTrade: {
    type: Boolean,
    default: false
  },
  sellerClosedTrade: {
    type: Boolean,
    default: false
  },
  // Store close trade message ID for editing
  closeTradeMessageId: {
    type: Number,
    required: false
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
  pendingSellerAddress: {
    type: String,
    default: null
  },
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
