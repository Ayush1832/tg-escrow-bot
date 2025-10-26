const AddressPool = require('../models/AddressPool');
const Escrow = require('../models/Escrow');
const Contract = require('../models/Contract');
const config = require('../../config');

class AddressAssignmentService {
  /**
   * Assign a unique deposit address for an escrow
   * Logic: Different amounts can share addresses, same amounts cannot
   */
  async assignDepositAddress(escrowId, token, network, amount, feePercent = null) {
    try {
      console.log(`🔍 Assigning deposit address for escrow ${escrowId}, amount: ${amount} ${token} on ${network}, fee: ${feePercent}%`);

      // Get the fee percentage from config if not provided
      if (feePercent === null) {
        const config = require('../../config');
        feePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      }

      // First, check if any address is already assigned to this exact amount for a DIFFERENT escrow
      const existingSameAmount = await AddressPool.findOne({
        token,
        network,
        assignedAmount: amount,
        assignedEscrowId: { $ne: escrowId }, // Different escrow
        status: { $in: ['assigned', 'busy'] }
      });

      if (existingSameAmount) {
        console.log(`❌ Address with amount ${amount} ${token} already exists for different escrow: ${existingSameAmount.address}`);
        throw new Error(`Address with amount ${amount} ${token} already exists. Please enter a different amount.`);
      }

      // Find available address or one with different amount (with correct fee percentage)
      let assignedAddress = await this.findAvailableAddress(token, network, amount, feePercent);

      if (!assignedAddress) {
        console.log(`❌ No available addresses for ${token} on ${network}`);
        throw new Error(`No available addresses for ${token} on ${network}. Please try again later.`);
      }

      // Update address status
      assignedAddress.status = 'assigned';
      assignedAddress.assignedEscrowId = escrowId;
      assignedAddress.assignedAmount = amount;
      assignedAddress.assignedAt = new Date();
      await assignedAddress.save();

      console.log(`✅ Assigned address ${assignedAddress.address} for escrow ${escrowId} with amount ${amount} ${token}`);

      return {
        address: assignedAddress.address,
        contractAddress: assignedAddress.contractAddress,
        sharedWithAmount: assignedAddress.assignedAmount !== amount ? assignedAddress.assignedAmount : null
      };

    } catch (error) {
      console.error('Error assigning deposit address:', error);
      throw error;
    }
  }

  /**
   * Find available address or one with different amount
   */
  async findAvailableAddress(token, network, amount, feePercent) {
    try {
      // First, try to find a completely available address with correct fee percentage
      let address = await AddressPool.findOne({
        token,
        network,
        feePercent,
        status: 'available'
      });

      if (address) {
        console.log(`✅ Found available address: ${address.address} (fee: ${feePercent}%)`);
        return address;
      }

      // If no available address, find one with different amount and correct fee percentage
      address = await AddressPool.findOne({
        token,
        network,
        feePercent,
        status: { $in: ['assigned', 'busy'] },
        assignedAmount: { $ne: amount }
      });

      if (address) {
        console.log(`✅ Found address with different amount: ${address.address} (current: ${address.assignedAmount}, requested: ${amount}, fee: ${feePercent}%)`);
        return address;
      }

      return null;

    } catch (error) {
      console.error('Error finding available address:', error);
      throw error;
    }
  }

  /**
   * Release address back to pool after trade completion
   */
  async releaseDepositAddress(escrowId) {
    try {
      console.log(`🔄 Releasing deposit address for escrow ${escrowId}`);

      const address = await AddressPool.findOne({
        assignedEscrowId: escrowId
      });

      if (!address) {
        console.log(`⚠️ No address found for escrow ${escrowId}`);
        return null;
      }

      // Check if there are other escrows using this address
      const otherEscrows = await AddressPool.find({
        address: address.address,
        assignedEscrowId: { $ne: escrowId },
        status: { $in: ['assigned', 'busy'] }
      });

      if (otherEscrows.length > 0) {
        // Other escrows are using this address, just mark as released but keep assigned
        address.releasedAt = new Date();
        await address.save();
        console.log(`✅ Address ${address.address} marked as released but kept assigned (other escrows using it)`);
      } else {
        // No other escrows using this address, make it available
        address.status = 'available';
        address.assignedEscrowId = null;
        address.assignedAmount = null;
        address.assignedAt = null;
        address.releasedAt = new Date();
        await address.save();
        console.log(`✅ Address ${address.address} released and made available`);
      }

      return address;

    } catch (error) {
      console.error('Error releasing deposit address:', error);
      throw error;
    }
  }

  /**
   * Initialize address pool with deployed contracts
   */
  async initializeAddressPool(feePercent = null) {
    try {
      console.log('🚀 Initializing address pool...');

      // Get the fee percentage from config if not provided
      if (feePercent === null) {
        const config = require('../../config');
        feePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      }

      // Get deployed contracts with the specified fee percentage
      const contracts = await Contract.find({
        name: 'EscrowVault',
        status: 'deployed',
        feePercent: feePercent
      });

      if (contracts.length === 0) {
        console.log(`⚠️ No deployed contracts found with ${feePercent}% fee`);
        return;
      }

      let addedCount = 0;
      for (const contract of contracts) {
        // Check if address already exists in pool
        const existingAddress = await AddressPool.findOne({
          address: contract.address
        });

        if (!existingAddress) {
          const addressPool = new AddressPool({
            address: contract.address,
            token: contract.token,
            network: contract.network,
            contractAddress: contract.address,
            feePercent: contract.feePercent,
            status: 'available'
          });

          await addressPool.save();
          addedCount++;
          console.log(`✅ Added address ${contract.address} for ${contract.token} on ${contract.network}`);
        }
      }

      console.log(`🎉 Address pool initialized with ${addedCount} addresses`);

    } catch (error) {
      console.error('Error initializing address pool:', error);
      throw error;
    }
  }

  /**
   * Get address pool statistics
   */
  async getAddressPoolStats() {
    try {
      const stats = await AddressPool.aggregate([
        {
          $group: {
            _id: { token: '$token', network: '$network', status: '$status' },
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {};
      stats.forEach(stat => {
        const key = `${stat._id.token}-${stat._id.network}`;
        if (!result[key]) {
          result[key] = {
            token: stat._id.token,
            network: stat._id.network,
            total: 0,
            available: 0,
            assigned: 0,
            busy: 0
          };
        }
        result[key][stat._id.status] = stat.count;
        result[key].total += stat.count;
      });

      return Object.values(result);

    } catch (error) {
      console.error('Error getting address pool stats:', error);
      throw error;
    }
  }

  /**
   * Get addresses by status
   */
  async getAddressesByStatus(status, token = null, network = null) {
    try {
      const query = { status };
      if (token) query.token = token;
      if (network) query.network = network;

      const addresses = await AddressPool.find(query).sort({ createdAt: -1 });
      return addresses;

    } catch (error) {
      console.error('Error getting addresses by status:', error);
      throw error;
    }
  }

  /**
   * Clean up abandoned addresses (assigned but no active escrow)
   */
  async cleanupAbandonedAddresses() {
    try {
      console.log('🧹 Cleaning up abandoned addresses...');

      // Find addresses assigned to non-existent or completed escrows
      const abandonedAddresses = await AddressPool.find({
        status: { $in: ['assigned', 'busy'] },
        assignedEscrowId: { $ne: null }
      });

      let cleanedCount = 0;
      for (const address of abandonedAddresses) {
        const escrow = await Escrow.findOne({
          escrowId: address.assignedEscrowId,
          status: { $in: ['draft', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] },
          isDisputed: { $ne: true }
        });

        if (!escrow) {
          // Escrow doesn't exist or is completed, release address
          address.status = 'available';
          address.assignedEscrowId = null;
          address.assignedAmount = null;
          address.assignedAt = null;
          address.releasedAt = new Date();
          await address.save();
          cleanedCount++;
          console.log(`✅ Cleaned up abandoned address ${address.address}`);
        }
      }

      console.log(`🎉 Cleaned up ${cleanedCount} abandoned addresses`);
      return cleanedCount;

    } catch (error) {
      console.error('Error cleaning up abandoned addresses:', error);
      throw error;
    }
  }
}

module.exports = new AddressAssignmentService();
