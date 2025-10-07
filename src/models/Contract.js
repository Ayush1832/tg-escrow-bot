const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  address: { type: String, required: true },
  network: { type: String, required: true },
  deployedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Contract', contractSchema);


