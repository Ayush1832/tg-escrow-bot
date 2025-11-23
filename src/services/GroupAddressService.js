const { ethers } = require('ethers');
const config = require('../../config');
const GroupPool = require('../models/GroupPool');

class GroupAddressService {
  constructor() {
    this.addressCache = new Map(); // Cache for generated addresses
    this.init();
  }

  init() {
    // Ensure private key has 0x prefix
    // Note: HOT_WALLET_PRIVATE_KEY is used for address generation seed, but actual addresses
    // are derived deterministically from groupId + token + network, not from this key
    if (!config.HOT_WALLET_PRIVATE_KEY) {
      console.warn('HOT_WALLET_PRIVATE_KEY not set in config. Address generation will still work.');
      this.masterPrivateKey = null;
      return;
    }
    
    const privateKey = config.HOT_WALLET_PRIVATE_KEY.startsWith('0x') 
      ? config.HOT_WALLET_PRIVATE_KEY 
      : '0x' + config.HOT_WALLET_PRIVATE_KEY;
    
    // Store the private key for HD derivation (currently not used, but kept for future use)
    this.masterPrivateKey = privateKey;
  }

  /**
   * Generate a deterministic unique address for a group + token + network combination
   * Uses HD wallet derivation based on groupId + token + network
   */
  generateAddressForGroup(groupId, token, network) {
    const normalizedToken = (token || '').toUpperCase();
    const normalizedNetwork = (network || 'BSC').toUpperCase();
    const cacheKey = `${groupId}_${normalizedToken}_${normalizedNetwork}`;

    // Check cache first
    if (this.addressCache.has(cacheKey)) {
      return this.addressCache.get(cacheKey);
    }

    // Generate deterministic address using keccak256 hash
    // Combine groupId, token, and network to create unique seed
    const seed = `${groupId}_${normalizedToken}_${normalizedNetwork}`;
    const hash = ethers.keccak256(ethers.toUtf8Bytes(seed));
    
    // Use the hash to derive a private key (deterministic)
    // Take first 32 bytes of hash as private key
    const derivedPrivateKey = '0x' + hash.slice(2, 66); // 32 bytes = 64 hex chars
    
    // Create wallet from derived private key
    const wallet = new ethers.Wallet(derivedPrivateKey);
    const address = wallet.address;

    // Cache the address
    this.addressCache.set(cacheKey, address);

    return address;
  }

  /**
   * Helper to safely get value from assignedAddresses (handles both Map and Object)
   */
  getAddressValue(assignedAddresses, key) {
    if (!assignedAddresses) return null;
    
    // If it's a Map, use .get()
    if (assignedAddresses instanceof Map) {
      return assignedAddresses.get(key) || null;
    }
    
    // If it's an object (from MongoDB), use bracket notation
    if (typeof assignedAddresses === 'object') {
      return assignedAddresses[key] || null;
    }
    
    return null;
  }

  /**
   * Helper to safely set value in assignedAddresses (handles both Map and Object)
   */
  setAddressValue(assignedAddresses, key, value) {
    if (!assignedAddresses) {
      return new Map([[key, value]]);
    }
    
    // If it's a Map, use .set()
    if (assignedAddresses instanceof Map) {
      assignedAddresses.set(key, value);
      return assignedAddresses;
    }
    
    // If it's an object, convert to Map for consistency
    const map = new Map();
    for (const [k, v] of Object.entries(assignedAddresses)) {
      map.set(k, v);
    }
    map.set(key, value);
    return map;
  }

  /**
   * Get or assign address for a group for a specific token/network
   * If address doesn't exist, generates and saves it
   */
  async getOrAssignAddress(groupId, token, network) {
    try {
      const group = await GroupPool.findOne({ groupId });
      
      if (!group) {
        throw new Error(`Group not found: ${groupId}`);
      }

      const normalizedToken = (token || '').toUpperCase();
      const normalizedNetwork = (network || 'BSC').toUpperCase();
      const addressKey = `${normalizedToken}_${normalizedNetwork}`;

      // Check if address already assigned (handle both Map and Object formats)
      const existingAddress = this.getAddressValue(group.assignedAddresses, addressKey);
      if (existingAddress) {
        return existingAddress;
      }

      // Generate new address
      const address = this.generateAddressForGroup(groupId, token, network);

      // Save to database (ensure it's a Map for Mongoose)
      group.assignedAddresses = this.setAddressValue(group.assignedAddresses, addressKey, address);
      await group.save();

      return address;
    } catch (error) {
      console.error('Error getting/assigning address for group:', error);
      throw error;
    }
  }

  /**
   * Get address for a group (returns null if not assigned)
   */
  async getAddress(groupId, token, network) {
    try {
      const group = await GroupPool.findOne({ groupId });
      
      if (!group) {
        return null;
      }

      const normalizedToken = (token || '').toUpperCase();
      const normalizedNetwork = (network || 'BSC').toUpperCase();
      const addressKey = `${normalizedToken}_${normalizedNetwork}`;

      return this.getAddressValue(group.assignedAddresses, addressKey);
    } catch (error) {
      console.error('Error getting address for group:', error);
      return null;
    }
  }

  /**
   * Assign addresses for multiple tokens/networks to a group
   */
  async assignAddressesForGroup(groupId, tokenNetworkPairs) {
    try {
      const group = await GroupPool.findOne({ groupId });
      
      if (!group) {
        throw new Error(`Group not found: ${groupId}`);
      }

      // Ensure assignedAddresses is initialized as a Map
      if (!group.assignedAddresses) {
        group.assignedAddresses = new Map();
      } else if (!(group.assignedAddresses instanceof Map)) {
        // Convert object to Map if needed
        const map = new Map();
        for (const [key, value] of Object.entries(group.assignedAddresses)) {
          map.set(key, value);
        }
        group.assignedAddresses = map;
      }

      const assigned = {};

      for (const { token, network } of tokenNetworkPairs) {
        const normalizedToken = (token || '').toUpperCase();
        const normalizedNetwork = (network || 'BSC').toUpperCase();
        const addressKey = `${normalizedToken}_${normalizedNetwork}`;

        // Check if address already assigned
        const existingAddress = this.getAddressValue(group.assignedAddresses, addressKey);
        
        if (!existingAddress) {
          // Generate new address
          const address = this.generateAddressForGroup(groupId, token, network);
          group.assignedAddresses = this.setAddressValue(group.assignedAddresses, addressKey, address);
          assigned[addressKey] = address;
        } else {
          assigned[addressKey] = existingAddress;
        }
      }

      await group.save();
      return assigned;
    } catch (error) {
      console.error('Error assigning addresses for group:', error);
      throw error;
    }
  }

  /**
   * Get all assigned addresses for a group
   */
  async getAllAddressesForGroup(groupId) {
    try {
      const group = await GroupPool.findOne({ groupId });
      
      if (!group) {
        return {};
      }

      if (!group.assignedAddresses) {
        return {};
      }

      const addresses = {};
      
      // Handle both Map and Object formats
      if (group.assignedAddresses instanceof Map) {
        // Convert Map to object
        for (const [key, value] of group.assignedAddresses.entries()) {
          addresses[key] = value;
        }
      } else if (typeof group.assignedAddresses === 'object') {
        // Already an object
        Object.assign(addresses, group.assignedAddresses);
      }

      return addresses;
    } catch (error) {
      console.error('Error getting all addresses for group:', error);
      return {};
    }
  }
}

module.exports = new GroupAddressService();

