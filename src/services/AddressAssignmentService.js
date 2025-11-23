const { ethers } = require('ethers');
const config = require('../../config');
const Contract = require('../models/Contract');
const Escrow = require('../models/Escrow');
const GroupPool = require('../models/GroupPool');
const GroupAddressService = require('./GroupAddressService');

class AddressAssignmentService {
  /**
   * Normalize chain name to network name
   * Maps: BNB -> BSC, ETHEREUM -> ETH, etc.
   */
  normalizeChainToNetwork(chain) {
    if (!chain) return 'BSC';
    const upper = chain.toUpperCase();
    // Map common chain names to network names
    if (upper === 'BNB' || upper === 'BEP-20') return 'BSC';
    if (upper === 'ETHEREUM') return 'ETH';
    if (upper === 'MATIC' || upper === 'POLYGON') return 'POLYGON';
    return upper; // Return as-is if no mapping needed
  }

  async assignDepositAddress(escrowId, token, network, amount, feePercent = null, groupId = null) {
    try {
      const normalizedToken = (token || '').toUpperCase();
      let normalizedNetwork = network ? this.normalizeChainToNetwork(network) : 'BSC';
      const normalizedFeePercent = feePercent !== null ? Number(feePercent) : Number(config.ESCROW_FEE_PERCENT || 0);

      // If groupId is not provided, try to get it from the escrow
      if (!groupId) {
        const escrow = await Escrow.findOne({ escrowId });
        if (escrow && escrow.groupId) {
          groupId = escrow.groupId;
          // If escrow has chain but network wasn't provided, use chain and normalize it
          if (escrow.chain && !network) {
            normalizedNetwork = this.normalizeChainToNetwork(escrow.chain);
          }
        }
      }
      
      // Ensure network is uppercase
      normalizedNetwork = normalizedNetwork.toUpperCase();

      // If we have a groupId, use group-specific contract address
      if (groupId) {
        try {
          // First, get the EscrowVault contract address assigned to this group
          let contract = await Contract.findOne({
            name: 'EscrowVault',
            token: normalizedToken,
            network: normalizedNetwork,
            feePercent: normalizedFeePercent,
            groupId: groupId,
            status: 'deployed'
          });

          // Fallback to any contract if group-specific not found
          if (!contract) {
            contract = await Contract.findOne({
              name: 'EscrowVault',
              token: normalizedToken,
              network: normalizedNetwork,
              feePercent: normalizedFeePercent,
              status: 'deployed'
            });
          }

          if (!contract) {
            throw new Error(
              `No EscrowVault contract found for ${normalizedToken} on ${normalizedNetwork} with ${normalizedFeePercent}% fee. ` +
              `Please deploy the contract first using: npm run deploy`
            );
          }

          // Use the contract address as the deposit address
          const contractAddress = contract.address;

          // Ensure this address is stored in GroupPool.assignedAddresses for consistency
          try {
            const group = await GroupPool.findOne({ groupId });
            if (group) {
              const addressKey = `${normalizedToken}_${normalizedNetwork}`;
              const existingAddress = GroupAddressService.getAddressValue(group.assignedAddresses, addressKey);
              
              // Update if different or missing
              if (existingAddress !== contractAddress) {
                group.assignedAddresses = GroupAddressService.setAddressValue(
                  group.assignedAddresses,
                  addressKey,
                  contractAddress
                );
                await group.save();
              }
            }
          } catch (updateError) {
            // Non-critical error, log but continue
            console.warn('Warning: Could not update GroupPool assignedAddresses:', updateError.message);
          }

          return {
            address: contractAddress, // Use contract address as deposit address
            contractAddress: contractAddress, // Contract address for reference
            sharedWithAmount: null
          };
        } catch (groupError) {
          console.error('Error getting group-specific contract address, falling back to contract address:', groupError);
          // Fall through to contract address fallback
        }
      }

      // Fallback: Use contract address (for backward compatibility or if no group assigned)
      // Try to find group-specific contract first if groupId exists
      let contract = null;
      if (groupId) {
        contract = await Contract.findOne({
          name: 'EscrowVault',
          token: normalizedToken,
          network: normalizedNetwork,
          feePercent: normalizedFeePercent,
          groupId: groupId,
          status: 'deployed'
        });
      }
      
      // Fallback to any contract
      if (!contract) {
        contract = await Contract.findOne({
          name: 'EscrowVault',
          token: normalizedToken,
          network: normalizedNetwork,
          feePercent: normalizedFeePercent,
          status: 'deployed'
        });
      }

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
