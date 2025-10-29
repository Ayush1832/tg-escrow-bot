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
      // Validate input parameters
      if (!escrowId || !token || !network) {
        throw new Error('Missing required parameters: escrowId, token, or network');
      }

      if (amount === undefined || amount === null || isNaN(amount) || amount <= 0) {
        throw new Error(`Invalid amount: ${amount}. Amount must be a positive number.`);
      }

      // Get the fee percentage from config if not provided
      if (feePercent === null) {
        const config = require('../../config');
        feePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      }

      // Normalize inputs first
      const normalizedToken = token.toUpperCase();
      const normalizedNetwork = network.toUpperCase();
      const normalizedAmount = Number(amount);
      
      // Check if this escrow already has an address assigned
      const existingAssignment = await AddressPool.findOne({
        assignedEscrowId: escrowId,
        status: { $in: ['assigned', 'busy'] }
      });

      // If escrow already has an address assigned, check if it's for the same token/network
      if (existingAssignment) {
        // Normalize existing assignment values for comparison
        const existingToken = (existingAssignment.token || '').toUpperCase();
        const existingNetwork = (existingAssignment.network || '').toUpperCase();
        const existingAmount = existingAssignment.assignedAmount !== null ? Number(existingAssignment.assignedAmount) : null;
        
        if (existingToken === normalizedToken && existingNetwork === normalizedNetwork) {
          // Same token/network - allow if amount changed (will reassign)
          if (existingAmount !== null && existingAmount === normalizedAmount) {
            // Same address, token, network, and amount - just return the existing assignment
            return {
              address: existingAssignment.address,
              contractAddress: existingAssignment.contractAddress,
              sharedWithAmount: null
            };
          }
          // Different amount - release old assignment and get new one
          existingAssignment.status = 'available';
          existingAssignment.assignedEscrowId = null;
          existingAssignment.assignedAmount = null;
          existingAssignment.assignedAt = null;
          await existingAssignment.save();
        } else {
          // Different token/network - release old assignment immediately
          // This handles cases where user changes token selection
          existingAssignment.status = 'available';
          existingAssignment.assignedEscrowId = null;
          existingAssignment.assignedAmount = null;
          existingAssignment.assignedAt = null;
          await existingAssignment.save();
        }
      }
      
      // Find available address - try multiple strategies:
      // 1. Completely available address
      // 2. Address with different amount (can share)
      // 3. Address with same amount but different escrow (rotate addresses)
      let assignedAddress = await this.findAvailableAddress(token, network, amount, feePercent);

      if (!assignedAddress) {
        // Check if ALL addresses are busy with the same amount
        const allAddressesForToken = await AddressPool.find({
          token: normalizedToken,
          network: normalizedNetwork,
          feePercent: Number(feePercent)
        });

        if (allAddressesForToken.length === 0) {
          throw new Error(`No addresses available for ${normalizedToken} on ${normalizedNetwork}. Please contact admin to deploy contracts.`);
        }

        // Check if all addresses are busy with the same amount
        const allBusyWithSameAmount = allAddressesForToken.every(addr => {
          if (addr.status === 'available') return false; // Available addresses don't count as busy
          const addrAmount = addr.assignedAmount !== null ? Number(addr.assignedAmount) : null;
          return addrAmount === normalizedAmount;
        });

        if (allBusyWithSameAmount) {
          throw new Error(`All addresses for ${normalizedAmount} ${normalizedToken} are currently in use. Please try a different amount.`);
        }

        throw new Error(`No available addresses for ${token} on ${network}. Please try again later.`);
      }

      // Verify the assigned address matches the requested token/network before finalizing
      if (assignedAddress.token.toUpperCase() !== token.toUpperCase() || 
          assignedAddress.network.toUpperCase() !== network.toUpperCase()) {
        throw new Error(`Address mismatch: Found address for ${assignedAddress.token}/${assignedAddress.network}, but requested ${token}/${network}`);
      }
      
      // IMPORTANT: Store old assignedAmount BEFORE updating (for sharedWithAmount calculation)
      const oldAssignedAmount = assignedAddress.assignedAmount ? Number(assignedAddress.assignedAmount) : null;
      
      // Update address status
      assignedAddress.status = 'assigned';
      assignedAddress.assignedEscrowId = escrowId;
      assignedAddress.assignedAmount = Number(amount); // Ensure it's a number
      assignedAddress.assignedAt = new Date();
      await assignedAddress.save();

      // Calculate sharedWithAmount based on OLD assignedAmount, not the new one
      // If address was previously assigned to a different amount, it's being shared
      const sharedWithAmount = (oldAssignedAmount !== null && oldAssignedAmount !== Number(amount)) 
        ? oldAssignedAmount 
        : null;

      return {
        address: assignedAddress.address,
        contractAddress: assignedAddress.contractAddress,
        sharedWithAmount: sharedWithAmount
      };

    } catch (error) {
      console.error('Error assigning deposit address:', error);
      throw error;
    }
  }

  /**
   * Find available address - tries multiple strategies:
   * 1. Completely available address
   * 2. Address with different amount (can share)
   * 3. Address with same amount but different escrow (rotate addresses)
   */
  async findAvailableAddress(token, network, amount, feePercent) {
    try {
      // Normalize inputs for consistency
      const normalizedToken = token.toUpperCase();
      const normalizedNetwork = network.toUpperCase();
      const normalizedFeePercent = Number(feePercent);
      const normalizedAmount = Number(amount);
      
      // Strategy 1: Find a completely available address
      let address = await AddressPool.findOne({
        token: normalizedToken,
        network: normalizedNetwork,
        feePercent: normalizedFeePercent,
        status: 'available'
      });

      if (address) {
        // Verify token/network match to prevent false matches
        if (address.token.toUpperCase() === normalizedToken && 
            address.network.toUpperCase() === normalizedNetwork) {
          return address;
        }
      }

      // Strategy 2: Find address with different amount (can share)
      // Different amounts CAN share same address
      address = await AddressPool.findOne({
        token: normalizedToken,
        network: normalizedNetwork,
        feePercent: normalizedFeePercent,
        status: { $in: ['assigned', 'busy'] },
        assignedAmount: { $ne: normalizedAmount } // Must be different amount
      });

      if (address) {
        // Verify token/network/amount match requirements
        if (address.token.toUpperCase() === normalizedToken && 
            address.network.toUpperCase() === normalizedNetwork &&
            Number(address.assignedAmount) !== normalizedAmount) {
          return address;
        }
      }

      // Strategy 3: Find an available address even if some addresses have same amount (rotate addresses)
      // This allows multiple escrows with same amount to use different addresses
      // Get all addresses for this token/network
      const allAddressesForToken = await AddressPool.find({
        token: normalizedToken,
        network: normalizedNetwork,
        feePercent: normalizedFeePercent
      });

      if (allAddressesForToken.length > 0) {
        // Priority order:
        // 1. Available address (not assigned)
        // 2. Address with different amount (can share)
        // 3. Address with same amount but different escrow (rotate - use another address)
        
        // First, try to find an available address
        const availableAddr = allAddressesForToken.find(addr => 
          addr.status === 'available' &&
          addr.token.toUpperCase() === normalizedToken &&
          addr.network.toUpperCase() === normalizedNetwork
        );

        if (availableAddr) {
          return availableAddr;
        }

        // Second, try to find address with different amount (can share)
        const differentAmountAddr = allAddressesForToken.find(addr => 
          addr.status !== 'available' &&
          Number(addr.assignedAmount) !== normalizedAmount &&
          addr.token.toUpperCase() === normalizedToken &&
          addr.network.toUpperCase() === normalizedNetwork
        );

        if (differentAmountAddr) {
          return differentAmountAddr;
        }

        // Third, try to find ANY address for rotation (same amounts can use different addresses)
        // Business rule: Same amounts CANNOT share same address, but CAN use different addresses
        // So if Address 1 has amount 10 for ESC1, we can assign amount 10 to Address 2 for ESC2
        
        // Strategy 3: Address rotation - same amounts can use different addresses
        // Find addresses that currently have this amount assigned
        const addressesWithSameAmount = allAddressesForToken.filter(addr => 
          addr.status !== 'available' &&
          addr.assignedAmount !== null &&
          Number(addr.assignedAmount) === normalizedAmount &&
          addr.token.toUpperCase() === normalizedToken &&
          addr.network.toUpperCase() === normalizedNetwork
        );

        // If ALL non-available addresses have the same amount, we can't assign
        // But if there are available addresses OR addresses with different amounts, we can rotate
        const nonAvailableAddresses = allAddressesForToken.filter(addr => addr.status !== 'available');
        const allNonAvailableHaveSameAmount = nonAvailableAddresses.length > 0 && 
          nonAvailableAddresses.every(addr => {
            const addrAmount = addr.assignedAmount !== null ? Number(addr.assignedAmount) : null;
            return addrAmount === normalizedAmount;
          });

        // If not all addresses are busy with same amount, we can find one to use
        // CRITICAL: Never assign to an address that already has the same amount!
        // Same amounts can use DIFFERENT addresses, but cannot SHARE the same address.
        if (!allNonAvailableHaveSameAmount) {
          // Find any address that:
          // 1. Is available (not assigned) - preferred
          // 2. Has different amount (can share)
          // 3. NEVER an address that has the same amount (violates business rule)
          const alternativeAddr = allAddressesForToken.find(addr => {
            if (addr.status === 'available') return true; // Available addresses are best
            if (addr.assignedAmount === null) return true; // Unassigned addresses (shouldn't happen but safe)
            
            const addrAmount = Number(addr.assignedAmount);
            // Only use addresses with DIFFERENT amounts - same amounts cannot share!
            return addrAmount !== normalizedAmount;
          });

          if (alternativeAddr && 
              alternativeAddr.token.toUpperCase() === normalizedToken &&
              alternativeAddr.network.toUpperCase() === normalizedNetwork) {
            return alternativeAddr;
          }
        }
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
      const address = await AddressPool.findOne({
        assignedEscrowId: escrowId
      });

      if (!address) {
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
      } else {
        // No other escrows using this address, make it available
        address.status = 'available';
        address.assignedEscrowId = null;
        address.assignedAmount = null;
        address.assignedAt = null;
        address.releasedAt = new Date();
        await address.save();
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
        }
      }


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
        }
      }

      return cleanedCount;

    } catch (error) {
      console.error('Error cleaning up abandoned addresses:', error);
      throw error;
    }
  }
}

module.exports = new AddressAssignmentService();
