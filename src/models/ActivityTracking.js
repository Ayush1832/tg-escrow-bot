const mongoose = require('mongoose');

const activityTrackingSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true,
    index: true
  },
  escrowId: {
    type: String,
    required: true,
    index: true
  },
  buyerId: {
    type: Number,
    required: false
  },
  sellerId: {
    type: Number,
    required: false
  },
  lastBuyerActivity: {
    type: Date,
    required: false
  },
  lastSellerActivity: {
    type: Date,
    required: false
  },
  lastAnyActivity: {
    type: Date,
    required: true,
    default: Date.now
  },
  inactivityWarningSent: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'completed', 'cancelled'],
    default: 'active'
  },
  tradeCompletedAt: {
    type: Date,
    required: false
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

// Indexes for efficient querying
activityTrackingSchema.index({ groupId: 1, status: 1 });
activityTrackingSchema.index({ lastAnyActivity: 1 });
activityTrackingSchema.index({ tradeCompletedAt: 1 });

// Update the updatedAt field on save
activityTrackingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ActivityTracking', activityTrackingSchema);
