const axios = require('axios');
const config = require('../../config');

class BSCService {
  constructor() {
    this.bscscanApiKey = config.BSCSCAN_API_KEY;
    this.bscscanBaseUrl = 'https://api.bscscan.com/api';
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
      } else {
        console.error('BscScan API error:', response.data.message);
        return [];
      }
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
}

module.exports = new BSCService();
