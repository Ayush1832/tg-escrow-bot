const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  escrowId: {
    type: String,
    required: true
  },
  actorId: {
    type: Number,
    required: true
  },
  action: {
    type: String,
    required: true
  },
  payload: mongoose.Schema.Types.Mixed,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Event', eventSchema);
