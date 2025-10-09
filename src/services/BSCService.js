const axios = require('axios');
const { ethers } = require('ethers');
const config = require('../../config');

class BSCService {
  constructor() {
    this.bscscanApiKey = config.BSCSCAN_API_KEY;
    this.bscscanBaseUrl = 'https://api.bscscan.com/api';
    // Use Sepolia RPC if provided, else BSC
    const rpcUrl = config.SEPOLIA_RPC_URL || config.BSC_RPC_URL;
    this.provider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl) : null;
    this.usdtAddress = (config.USDT_CONTRACT_ADDRESS || '').toLowerCase();

    this.ERC20_ABI = [
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ];
  }

  async getUSDTTransactions(address, startBlock = 0) {
    try {
      const response = await axios.get(this.bscscanBaseUrl, {
        params: {
          module: 'account',
          action: 'tokentx',
          contractaddress: config.USDT_CONTRACT_ADDRESS,
          address: address,
          startblock: startBlock,
          endblock: 999999999,
          sort: 'desc',
          apikey: this.bscscanApiKey
        }
      });

      if (response.data.status === '1') {
        // Normalize amounts to decimal (USDT 6 decimals)
        return response.data.result.map((tx) => ({
          ...tx,
          valueDecimal: Number(tx.value) / 1_000_000
        }));
      }
      // Let caller decide to fallback to RPC
      return [];
    } catch (error) {
      console.error('Error fetching USDT transactions:', error);
      return [];
    }
  }

  async getLatestBlockNumber() {
    try {
      const response = await axios.get(this.bscscanBaseUrl, {
        params: {
          module: 'proxy',
          action: 'eth_blockNumber',
          apikey: this.bscscanApiKey
        }
      });

      return parseInt(response.data.result, 16);
    } catch (error) {
      console.error('Error getting latest block number:', error);
      return 0;
    }
  }

  async getTransactionReceipt(txHash) {
    try {
      const response = await axios.get(this.bscscanBaseUrl, {
        params: {
          module: 'proxy',
          action: 'eth_getTransactionReceipt',
          txhash: txHash,
          apikey: this.bscscanApiKey
        }
      });

      return response.data.result;
    } catch (error) {
      console.error('Error getting transaction receipt:', error);
      return null;
    }
  }

  async getUSDTBalance(address) {
    try {
      const response = await axios.get(this.bscscanBaseUrl, {
        params: {
          module: 'account',
          action: 'tokenbalance',
          contractaddress: config.USDT_CONTRACT_ADDRESS,
          address: address,
          tag: 'latest',
          apikey: this.bscscanApiKey
        }
      });

      if (response.data.status === '1') {
        // USDT has 6 decimals
        return parseFloat(response.data.result) / 1000000;
      } else {
        console.error('BscScan API error:', response.data.message);
        return 0;
      }
    } catch (error) {
      console.error('Error getting USDT balance:', error);
      return 0;
    }
  }

  formatUSDTAmountRaw(value) {
    return (Number(value) / 1_000_000).toFixed(6);
  }

  // RPC fallback: query ERC20 Transfer logs directly
  async getUSDTTransfersViaRPC(toAddress, fromBlock) {
    try {
      if (!this.provider || !this.usdtAddress) return [];
      const toAddrLc = toAddress.toLowerCase();
      const iface = new ethers.Interface(this.ERC20_ABI);

      // Default: scan last ~10,000 blocks if fromBlock not provided
      const latest = await this.provider.getBlockNumber();
      const start = Math.max(0, (fromBlock || (latest - 10000)));

      const filter = {
        address: this.usdtAddress,
        fromBlock: start,
        toBlock: latest,
        topics: [
          iface.getEvent('Transfer').topicHash,
          null,
          ethers.zeroPadValue(toAddrLc, 32)
        ]
      };

      const logs = await this.provider.getLogs(filter);
      return logs.map((log) => {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        const from = parsed.args[0];
        const to = parsed.args[1];
        const value = parsed.args[2];
        // Assume USDT 6 decimals
        const valueDecimal = Number(ethers.formatUnits(value, 6));
        return { from, to, valueDecimal };
      });
    } catch (error) {
      console.error('RPC fallback error fetching USDT transfers:', error);
      return [];
    }
  }
}

module.exports = new BSCService();
