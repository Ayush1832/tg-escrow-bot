const { ethers } = require('ethers');
const config = require('../../config');
const Contract = require('../models/Contract');

class AddressAssignmentService {
  async assignDepositAddress(escrowId, token, network, amount, feePercent = null) {
    try {
      const normalizedToken = (token || '').toUpperCase();
      const normalizedNetwork = (network || 'BSC').toUpperCase();
      const normalizedFeePercent = feePercent !== null ? Number(feePercent) : Number(config.ESCROW_FEE_PERCENT || 0);

      // Get the EscrowVault contract address from database
      const contract = await Contract.findOne({
        name: 'EscrowVault',
        token: normalizedToken,
        network: normalizedNetwork,
        feePercent: normalizedFeePercent,
        status: 'deployed'
      });

      if (!contract) {
        throw new Error(
          `No EscrowVault contract found for ${normalizedToken} on ${normalizedNetwork} with ${normalizedFeePercent}% fee. ` +
          `Please deploy the contract first using: npm run deploy`
        );
      }

      const contractAddress = contract.address;

      return {
        address: contractAddress,
        contractAddress: contractAddress,
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
