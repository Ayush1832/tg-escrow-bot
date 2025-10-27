const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../../config');
const ContractModel = require('../models/Contract');

const ESCROW_VAULT_ABI = [
  'function token() view returns (address)',
  'function feePercent() view returns (uint256)',
  'function feeWallet1() view returns (address)',
  'function feeWallet2() view returns (address)',
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
      // Get the desired fee percentage from environment
      const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      console.log(`🎯 Looking for contracts with ${desiredFeePercent}% fee (${desiredFeePercent * 100} basis points)`);
      
      // Show all available EscrowVault contracts
      const contracts = await ContractModel.find({ name: 'EscrowVault' });
      if (contracts.length === 0) {
        console.log('No EscrowVault contracts found in database');
        throw new Error('EscrowVault not deployed / not saved');
      }
      
      console.log('📋 Available EscrowVault contracts:');
      contracts.forEach(contract => {
        const feeDisplay = contract.feePercent !== undefined && contract.feePercent !== null ? `${contract.feePercent}%` : 'Unknown';
        console.log(`  • ${contract.token} on ${contract.network}: ${contract.address} (Fee: ${feeDisplay})`);
      });
      
      // Find contract with matching fee percentage
      const matchingContract = contracts.find(contract => 
        contract.feePercent === desiredFeePercent
      );
      
      if (!matchingContract) {
        console.log(`❌ No contract found with ${desiredFeePercent}% fee`);
        console.log('Available fee percentages:');
        const uniqueFees = [...new Set(contracts.map(c => c.feePercent))];
        uniqueFees.forEach(fee => console.log(`  • ${fee}%`));
        throw new Error(`No EscrowVault contract found with ${desiredFeePercent}% fee. Please deploy a contract with this fee percentage.`);
      }
      
      console.log(`✅ Using contract: ${matchingContract.token} on ${matchingContract.network} (${matchingContract.feePercent}% fee)`);
      
      const wallet = this.wallets[matchingContract.network.toUpperCase()];
      this.vault = new ethers.Contract(matchingContract.address, ESCROW_VAULT_ABI, wallet);
      return matchingContract.address;
    } catch (error) {
      console.error('Error initializing BlockchainService:', error);
      throw error;
    }
  }

  async getVaultForToken(token, network) {
    try {
      const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      const entry = await ContractModel.findOne({ 
        name: 'EscrowVault',
        token: token.toUpperCase(),
        network: network.toUpperCase(),
        feePercent: desiredFeePercent
      });
      if (!entry) {
        throw new Error(`EscrowVault not found for ${token} on ${network} with ${desiredFeePercent}% fee`);
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

  // Get token decimals for a specific token-network pair
  getTokenDecimals(token, network) {
    // Most tokens use 18 decimals, but some have different decimals
    const decimalsMap = {
      'USDT_SEPOLIA': 6,    // USDT on Ethereum/Sepolia has 6 decimals
      'USDT_BSC': 18,       // USDT on BSC has 18 decimals
      'USDC_BSC': 18,       // USDC on BSC has 18 decimals
      'BUSD_BSC': 18,       // BUSD on BSC has 18 decimals
      'BNB_BSC': 18,        // BNB has 18 decimals
      'ETH_ETH': 18,        // ETH has 18 decimals
      'BTC_BSC': 18,        // BTC on BSC has 18 decimals
      'LTC_LTC': 8,         // LTC has 8 decimals
      'DOGE_DOGE': 8,       // DOGE has 8 decimals
      'DOGE_BSC': 18,       // DOGE on BSC has 18 decimals
      'SOL_SOL': 9,         // SOL has 9 decimals
      'TRX_TRON': 6,        // TRX has 6 decimals
      'USDT_TRON': 6,       // USDT on TRON has 6 decimals
    };
    
    const key = `${token}_${network}`.toUpperCase();
    return decimalsMap[key] || 18; // Default to 18 decimals if not specified
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
    const decimals = this.getTokenDecimals(token, network);
    const amount = ethers.parseUnits(String(amountUSDT), decimals);
    const tx = await vault.release(to, amount);
    return await tx.wait();
  }

  async refund(to, amountUSDT, token = 'USDT', network = 'SEPOLIA') {
    const vault = await this.getVaultForToken(token, network);
    const decimals = this.getTokenDecimals(token, network);
    const amount = ethers.parseUnits(String(amountUSDT), decimals);
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

      // Get latest block and calculate start block
      const latest = await provider.getBlockNumber();
      const start = fromBlock || Math.max(0, latest - 2000); // Reduced to 2000 blocks max
      
      // If range is too large, scan in chunks of 500 blocks
      const maxRange = 500;
      const totalRange = latest - start;
      
      if (totalRange <= maxRange) {
        // Small range, scan directly
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
          const decimals = this.getTokenDecimals(token, network);
          const valueDecimal = Number(ethers.formatUnits(value, decimals));
          return { from, to, valueDecimal };
        });
      } else {
        // Large range, scan in chunks
        const allLogs = [];
        let currentStart = start;
        
        while (currentStart < latest) {
          const currentEnd = Math.min(currentStart + maxRange, latest);
          
          try {
            const filter = {
              address: tokenAddress,
              fromBlock: currentStart,
              toBlock: currentEnd,
              topics: [
                iface.getEvent('Transfer').topicHash,
                null,
                ethers.zeroPadValue(toAddrLc, 32)
              ]
            };

            const logs = await provider.getLogs(filter);
            allLogs.push(...logs);
            
            currentStart = currentEnd + 1;
          } catch (chunkError) {
            console.error(`Error scanning blocks ${currentStart}-${currentEnd}:`, chunkError);
            // Continue with next chunk
            currentStart = currentEnd + 1;
          }
        }
        
        return allLogs.map((log) => {
          const parsed = iface.parseLog({ topics: log.topics, data: log.data });
          const from = parsed.args[0];
          const to = parsed.args[1];
          const value = parsed.args[2];
          const decimals = this.getTokenDecimals(token, network);
          const valueDecimal = Number(ethers.formatUnits(value, decimals));
          return { from, to, valueDecimal };
        });
      }
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
        const decimals = this.getTokenDecimals(token, network);
        return parseFloat(ethers.formatUnits(balance, decimals));
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
      const decimals = this.getTokenDecimals(token, network);
      const amountWei = ethers.parseUnits(amount.toString(), decimals);

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
      const decimals = this.getTokenDecimals(token, network);
      const amountWei = ethers.parseUnits(amount.toString(), decimals);

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
      const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      const contract = await ContractModel.findOne({
        name: 'EscrowVault',
        token: token.toUpperCase(),
        network: network.toUpperCase(),
        feePercent: desiredFeePercent
      });

      return contract ? contract.address : null;
    } catch (error) {
      console.error('Error getting escrow contract address:', error);
      return null;
    }
  }

  /**
   * Get token contract address for a given token and network
   */
  getTokenAddress(token, network) {
    const tokenKey = `${token}_${network.toUpperCase()}`;
    return config[tokenKey];
  }

  /**
   * Withdraw all funds from escrow contract to admin wallet
   */
  async withdrawToAdmin(contractAddress, adminAddress, token, network, amount) {
    try {
      const wallet = this.wallets[network.toUpperCase()];
      if (!wallet) {
        throw new Error(`Wallet not configured for network: ${network}`);
      }

      const vaultContract = new ethers.Contract(contractAddress, ESCROW_VAULT_ABI, wallet);
      const decimals = this.getTokenDecimals(token, network);
      const amountWei = ethers.parseUnits(amount.toString(), decimals);

      console.log(`Withdrawing ${amount} ${token} to admin wallet ${adminAddress} on ${network}`);
      
      // Get the token contract address
      const tokenAddress = this.getTokenAddress(token, network);
      if (!tokenAddress) {
        throw new Error(`Token address not found for ${token} on ${network}`);
      }
      
      // Use the withdrawToken function from the contract
      const tx = await vaultContract.withdrawToken(tokenAddress, adminAddress);
      const receipt = await tx.wait();

      console.log(`✅ Admin withdrawal transaction successful: ${receipt.transactionHash}`);
      return receipt.transactionHash;

    } catch (error) {
      console.error('Error withdrawing to admin:', error);
      throw error;
    }
  }
}

module.exports = new BlockchainService();


