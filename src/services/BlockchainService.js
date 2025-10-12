const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../../config');
const ContractModel = require('../models/Contract');

const ESCROW_VAULT_ABI = [
  'function token() view returns (address)',
  'function feePercent() view returns (uint256)',
  'function feeWallet1() view returns (address)',
  'function feeWallet2() view returns (address)',
  'function feeWallet3() view returns (address)',
  'function release(address to, uint256 amount) external',
  'function refund(address to, uint256 amount) external'
];

const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

class BlockchainService {
  constructor() {
    // Initialize providers for different networks
    this.providers = {
      BSC: new ethers.JsonRpcProvider(config.BSC_RPC_URL),
      SEPOLIA: new ethers.JsonRpcProvider(config.SEPOLIA_RPC_URL),
      ETH: new ethers.JsonRpcProvider(config.ETH_RPC_URL || 'https://eth.llamarpc.com'),
      LTC: new ethers.JsonRpcProvider(config.LTC_RPC_URL || 'https://ltc.llamarpc.com')
    };
    
    // Ensure private key has 0x prefix
    const privateKey = config.HOT_WALLET_PRIVATE_KEY.startsWith('0x') 
      ? config.HOT_WALLET_PRIVATE_KEY 
      : '0x' + config.HOT_WALLET_PRIVATE_KEY;
    
    // Create wallet instances for each network
    this.wallets = {};
    Object.keys(this.providers).forEach(network => {
      this.wallets[network] = new ethers.Wallet(privateKey, this.providers[network]);
    });
    
    this.vault = null;
    this.etherscanApiKey = config.ETHERSCAN_API_KEY;
    this.etherscanBaseUrl = 'https://api.etherscan.io/api';
  }

  async initialize() {
    try {
      // Initialize with USDT on Sepolia for backward compatibility
      const entry = await ContractModel.findOne({ 
        name: 'EscrowVault',
        token: 'USDT',
        network: 'SEPOLIA'
      });
      if (!entry) {
        console.log('No EscrowVault found in database');
        throw new Error('EscrowVault not deployed / not saved');
      }
      console.log('Found EscrowVault in DB:', entry.address, 'for', entry.token, 'on', entry.network);
      this.vault = new ethers.Contract(entry.address, ESCROW_VAULT_ABI, this.wallet);
      return entry.address;
    } catch (error) {
      console.error('Error initializing BlockchainService:', error);
      throw error;
    }
  }

  async getVaultForToken(token, network) {
    try {
      const entry = await ContractModel.findOne({ 
        name: 'EscrowVault',
        token: token.toUpperCase(),
        network: network.toUpperCase()
      });
      if (!entry) {
        throw new Error(`EscrowVault not found for ${token} on ${network}`);
      }
      const wallet = this.wallets[network.toUpperCase()];
      return new ethers.Contract(entry.address, ESCROW_VAULT_ABI, wallet);
    } catch (error) {
      console.error(`Error getting vault for ${token} on ${network}:`, error);
      throw error;
    }
  }

  // Get token contract address for a specific token-network pair
  getTokenAddress(token, network) {
    const key = `${token}_${network}`.toUpperCase();
    return config[key];
  }

  // Get provider for a specific network
  getProvider(network) {
    return this.providers[network.toUpperCase()];
  }

  // Get wallet for a specific network
  getWallet(network) {
    return this.wallets[network.toUpperCase()];
  }

  async release(to, amountUSDT, token = 'USDT', network = 'SEPOLIA') {
    const vault = await this.getVaultForToken(token, network);
    // amountUSDT is decimal amount, convert to 6 decimals (assuming most tokens use 6 decimals)
    const amount = ethers.parseUnits(String(amountUSDT), 6);
    const tx = await vault.release(to, amount);
    return await tx.wait();
  }

  async refund(to, amountUSDT, token = 'USDT', network = 'SEPOLIA') {
    const vault = await this.getVaultForToken(token, network);
    // amountUSDT is decimal amount, convert to 6 decimals (assuming most tokens use 6 decimals)
    const amount = ethers.parseUnits(String(amountUSDT), 6);
    const tx = await vault.refund(to, amount);
    return await tx.wait();
  }

  // Etherscan API methods for transaction fetching
  async getTokenTransactions(token, network, address, startBlock = 0) {
    try {
      const tokenAddress = this.getTokenAddress(token, network);
      if (!tokenAddress) {
        console.error(`Token address not found for ${token} on ${network}`);
        return [];
      }

      // Use Etherscan API for all networks
      // Note: Etherscan API works for Ethereum mainnet and testnets
      // For BSC and other networks, we'll use RPC fallback
      if (network.toUpperCase() === 'ETH' || network.toUpperCase() === 'SEPOLIA') {
        const response = await axios.get(this.etherscanBaseUrl, {
          params: {
            module: 'account',
            action: 'tokentx',
            contractaddress: tokenAddress,
            address: address,
            startblock: startBlock,
            endblock: 999999999,
            sort: 'desc',
            apikey: this.etherscanApiKey
          }
        });

        if (response.data.status === '1') {
          // Normalize amounts to decimal (assuming 6 decimals for most tokens)
          return response.data.result.map((tx) => ({
            ...tx,
            valueDecimal: Number(tx.value) / 1_000_000
          }));
        }
        return [];
      } else {
        // For BSC and other networks, use RPC logs
        return await this.getTokenTransfersViaRPC(token, network, address, startBlock);
      }
    } catch (error) {
      console.error('Error fetching token transactions:', error);
      // Fallback to RPC logs if explorer fails
      return await this.getTokenTransfersViaRPC(token, network, address, startBlock);
    }
  }

  // RPC fallback: query ERC20 Transfer logs directly
  async getTokenTransfersViaRPC(token, network, toAddress, fromBlock) {
    try {
      const provider = this.getProvider(network);
      const tokenAddress = this.getTokenAddress(token, network);
      
      if (!provider || !tokenAddress) return [];
      
      const toAddrLc = toAddress.toLowerCase();
      const iface = new ethers.Interface(ERC20_ABI);

      // Default: scan last ~10,000 blocks if fromBlock not provided
      const latest = await provider.getBlockNumber();
      const start = Math.max(0, (fromBlock || (latest - 10000)));

      const filter = {
        address: tokenAddress,
        fromBlock: start,
        toBlock: latest,
        topics: [
          iface.getEvent('Transfer').topicHash,
          null,
          ethers.zeroPadValue(toAddrLc, 32)
        ]
      };

      const logs = await provider.getLogs(filter);
      return logs.map((log) => {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        const from = parsed.args[0];
        const to = parsed.args[1];
        const value = parsed.args[2];
        // Assume 6 decimals for most tokens
        const valueDecimal = Number(ethers.formatUnits(value, 6));
        return { from, to, valueDecimal };
      });
    } catch (error) {
      console.error('RPC fallback error fetching token transfers:', error);
      return [];
    }
  }

  async getLatestBlockNumber(network = 'ETH') {
    try {
      // Use Etherscan API for Ethereum networks
      if (network.toUpperCase() === 'ETH' || network.toUpperCase() === 'SEPOLIA') {
        const response = await axios.get(this.etherscanBaseUrl, {
          params: {
            module: 'proxy',
            action: 'eth_blockNumber',
            apikey: this.etherscanApiKey
          }
        });
        return parseInt(response.data.result, 16);
      } else {
        // For BSC and other networks, use RPC
        const provider = this.getProvider(network);
        return await provider.getBlockNumber();
      }
    } catch (error) {
      console.error('Error getting latest block number:', error);
      return 0;
    }
  }

  async getTokenBalance(token, network, address) {
    try {
      const tokenAddress = this.getTokenAddress(token, network);
      if (!tokenAddress) return 0;

      // Use Etherscan API for Ethereum networks
      if (network.toUpperCase() === 'ETH' || network.toUpperCase() === 'SEPOLIA') {
        const response = await axios.get(this.etherscanBaseUrl, {
          params: {
            module: 'account',
            action: 'tokenbalance',
            contractaddress: tokenAddress,
            address: address,
            tag: 'latest',
            apikey: this.etherscanApiKey
          }
        });

        if (response.data.status === '1') {
          // Assuming 6 decimals for most tokens
          return parseFloat(response.data.result) / 1000000;
        }
        return 0;
      } else {
        // For BSC and other networks, use RPC
        const provider = this.getProvider(network);
        const contract = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], provider);
        const balance = await contract.balanceOf(address);
        return parseFloat(ethers.formatUnits(balance, 6));
      }
    } catch (error) {
      console.error('Error getting token balance:', error);
      return 0;
    }
  }

  /**
   * Release funds from escrow vault to buyer
   */
  async releaseFunds(token, network, buyerAddress, amount) {
    try {
      const contractAddress = await this.getEscrowContractAddress(token, network);
      if (!contractAddress) {
        throw new Error(`No escrow contract found for ${token} on ${network}`);
      }

      const wallet = this.wallets[network.toUpperCase()];
      if (!wallet) {
        throw new Error(`Wallet not configured for network: ${network}`);
      }

      const vaultContract = new ethers.Contract(contractAddress, ESCROW_VAULT_ABI, wallet);
      const amountWei = ethers.parseUnits(amount.toString(), 6); // USDT has 6 decimals

      console.log(`Releasing ${amount} ${token} to ${buyerAddress} on ${network}`);
      
      const tx = await vaultContract.release(buyerAddress, amountWei);
      const receipt = await tx.wait();

      console.log(`✅ Release transaction successful: ${receipt.transactionHash}`);
      return {
        success: true,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
      };

    } catch (error) {
      console.error('Error releasing funds:', error);
      throw error;
    }
  }

  /**
   * Refund funds from escrow vault to seller
   */
  async refundFunds(token, network, sellerAddress, amount) {
    try {
      const contractAddress = await this.getEscrowContractAddress(token, network);
      if (!contractAddress) {
        throw new Error(`No escrow contract found for ${token} on ${network}`);
      }

      const wallet = this.wallets[network.toUpperCase()];
      if (!wallet) {
        throw new Error(`Wallet not configured for network: ${network}`);
      }

      const vaultContract = new ethers.Contract(contractAddress, ESCROW_VAULT_ABI, wallet);
      const amountWei = ethers.parseUnits(amount.toString(), 6); // USDT has 6 decimals

      console.log(`Refunding ${amount} ${token} to ${sellerAddress} on ${network}`);
      
      const tx = await vaultContract.refund(sellerAddress, amountWei);
      const receipt = await tx.wait();

      console.log(`✅ Refund transaction successful: ${receipt.transactionHash}`);
      return {
        success: true,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
      };

    } catch (error) {
      console.error('Error refunding funds:', error);
      throw error;
    }
  }

  /**
   * Get escrow contract address for token/network pair
   */
  async getEscrowContractAddress(token, network) {
    try {
      const contract = await ContractModel.findOne({
        name: 'EscrowVault',
        token: token.toUpperCase(),
        network: network.toUpperCase()
      });

      return contract ? contract.address : null;
    } catch (error) {
      console.error('Error getting escrow contract address:', error);
      return null;
    }
  }
}

module.exports = new BlockchainService();


