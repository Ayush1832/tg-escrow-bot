const { ethers } = require('ethers');
const config = require('../../config');

class AddressAssignmentService {
  async assignDepositAddress(escrowId, token, network, amount, feePercent = null) {
    try {
      const normalizedNetwork = (network || 'BSC').toUpperCase();
      const privateKey = config.HOT_WALLET_PRIVATE_KEY.startsWith('0x') 
        ? config.HOT_WALLET_PRIVATE_KEY 
        : '0x' + config.HOT_WALLET_PRIVATE_KEY;
      
      const wallet = new ethers.Wallet(privateKey);
      const depositAddress = wallet.address;

      return {
        address: depositAddress,
        contractAddress: depositAddress,
        sharedWithAmount: null
      };
    } catch (error) {
      console.error('Error getting deposit address:', error);
      throw error;
    }
  }

  async releaseDepositAddress(escrowId) {
    return true;
  }

  async cleanupAbandonedAddresses() {
    return 0;
  }

  async getAddressPoolStats() {
    try {
      const privateKey = config.HOT_WALLET_PRIVATE_KEY.startsWith('0x') 
        ? config.HOT_WALLET_PRIVATE_KEY 
        : '0x' + config.HOT_WALLET_PRIVATE_KEY;
      const wallet = new ethers.Wallet(privateKey);
      const depositAddress = wallet.address;
      
      return {
        total: 1,
        singleAddress: depositAddress,
        byToken: {
          'ALL_TOKENS': depositAddress
        }
      };
    } catch (error) {
      console.error('Error getting address pool stats:', error);
      return { total: 0, singleAddress: null, byToken: {} };
    }
  }

  async initializeAddressPool(feePercent = null) {
    return { message: 'Address pool initialization no longer needed. Single deposit address is used for all tokens.' };
  }
}

module.exports = new AddressAssignmentService();
