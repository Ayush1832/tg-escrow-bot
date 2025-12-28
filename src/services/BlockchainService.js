const { ethers } = require("ethers");
const axios = require("axios");
const config = require("../../config");
const ContractModel = require("../models/Contract");
const TronService = require("./TronService");

const ESCROW_VAULT_ABI = [
  "function token() view returns (address)",
  "function feePercent() view returns (uint256)",
  "function feeWallet1() view returns (address)",
  "function feeWallet2() view returns (address)",
  "function release(address to, uint256 amount) external",
  "function refund(address to, uint256 amount) external",
  "function withdrawToken(address erc20Token, address to) external",
];

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

class BlockchainService {
  constructor() {
    const providerOptions = {
      staticNetwork: null,
      batchMaxCount: 1,
    };

    this.providers = {
      BSC: new ethers.JsonRpcProvider(
        config.BSC_RPC_URL,
        null,
        providerOptions
      ),
      SEPOLIA: new ethers.JsonRpcProvider(
        config.SEPOLIA_RPC_URL,
        null,
        providerOptions
      ),
      ETH: new ethers.JsonRpcProvider(
        config.ETH_RPC_URL || "https://eth.llamarpc.com",
        null,
        providerOptions
      ),
      LTC: new ethers.JsonRpcProvider(
        config.LTC_RPC_URL || "https://ltc.llamarpc.com",
        null,
        providerOptions
      ),
      TRON: new ethers.JsonRpcProvider(
        config.TRON_RPC_URL || "https://api.trongrid.io",
        null,
        providerOptions
      ),
    };

    const privateKey = config.HOT_WALLET_PRIVATE_KEY.startsWith("0x")
      ? config.HOT_WALLET_PRIVATE_KEY
      : "0x" + config.HOT_WALLET_PRIVATE_KEY;

    this.wallets = {};
    Object.keys(this.providers).forEach((network) => {
      this.wallets[network] = new ethers.Wallet(
        privateKey,
        this.providers[network]
      );
    });

    this.vault = null;
    this.etherscanApiKey = config.ETHERSCAN_API_KEY;
    this.etherscanBaseUrl = "https://api.etherscan.io/api";
  }

  async initialize() {
    try {
      const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);

      const contracts = await ContractModel.find({
        name: "EscrowVault",
        feePercent: desiredFeePercent,
      });

      if (contracts.length === 0) {
        throw new Error(
          `No EscrowVault contracts found with ${desiredFeePercent}% fee. Please deploy contracts with this fee percentage.`
        );
      }

      return contracts[0].address;
    } catch (error) {
      console.error("Error initializing BlockchainService:", error);
      throw error;
    }
  }

  async getVaultForNetwork(network, token = null) {
    try {
      const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      const query = {
        name: "EscrowVault",
        network: network.toUpperCase(),
        feePercent: desiredFeePercent,
      };

      if (token) {
        query.token = token.toUpperCase();
      }

      const entry = await ContractModel.findOne(query);
      if (!entry) {
        const errorMsg = token
          ? `EscrowVault not found for ${token} on ${network} with ${desiredFeePercent}% fee`
          : `EscrowVault not found on ${network} with ${desiredFeePercent}% fee`;
        throw new Error(errorMsg);
      }
      const wallet = this.wallets[network.toUpperCase()];
      return new ethers.Contract(entry.address, ESCROW_VAULT_ABI, wallet);
    } catch (error) {
      console.error(`Error getting vault on ${network}:`, error);
      throw error;
    }
  }

  getTokenAddress(token, network) {
    const key = `${token}_${network}`.toUpperCase();
    return config[key];
  }

  getTokenDecimals(token, network) {
    const decimalsMap = {
      USDT_SEPOLIA: 6, // USDT on Ethereum/Sepolia has 6 decimals
      USDT_BSC: 18, // USDT on BSC has 18 decimals
      USDC_BSC: 18, // USDC on BSC has 18 decimals
      BUSD_BSC: 18, // BUSD on BSC has 18 decimals
      BNB_BSC: 18, // BNB has 18 decimals
      ETH_ETH: 18, // ETH has 18 decimals
      BTC_BSC: 18, // BTC on BSC has 18 decimals
      LTC_LTC: 8, // LTC has 8 decimals
      DOGE_DOGE: 8, // DOGE has 8 decimals
      DOGE_BSC: 18, // DOGE on BSC has 18 decimals
      SOL_SOL: 9, // SOL has 9 decimals
      TRX_TRON: 6, // TRX has 6 decimals
      USDT_TRON: 6,
    };

    const key = `${token}_${network}`.toUpperCase();
    return decimalsMap[key] || 18;
  }

  getProvider(network) {
    return this.providers[network.toUpperCase()];
  }

  getWallet(network) {
    return this.wallets[network.toUpperCase()];
  }

  async release(to, amountUSDT, token = "USDT", network = "SEPOLIA") {
    const vault = await this.getVaultForNetwork(network);
    const wallet = this.wallets[network.toUpperCase()];
    const provider = this.providers[network.toUpperCase()];
    const decimals = this.getTokenDecimals(token, network);
    const amount = ethers.parseUnits(String(amountUSDT), decimals);

    let nonce;
    try {
      nonce = await provider.getTransactionCount(wallet.address, "latest");
    } catch (nonceError) {
      try {
        nonce = await provider.getTransactionCount(wallet.address);
      } catch (fallbackError) {
        throw new Error(
          `Failed to get transaction nonce: ${fallbackError.message}`
        );
      }
    }

    const tx = await vault.release(to, amount, { nonce: nonce });
    return await tx.wait();
  }

  async refund(to, amountUSDT, token = "USDT", network = "SEPOLIA") {
    const vault = await this.getVaultForNetwork(network);
    const wallet = this.wallets[network.toUpperCase()];
    const provider = this.providers[network.toUpperCase()];
    const decimals = this.getTokenDecimals(token, network);
    const amount = ethers.parseUnits(String(amountUSDT), decimals);

    let nonce;
    try {
      nonce = await provider.getTransactionCount(wallet.address, "latest");
    } catch (nonceError) {
      try {
        nonce = await provider.getTransactionCount(wallet.address);
      } catch (fallbackError) {
        throw new Error(
          `Failed to get transaction nonce: ${fallbackError.message}`
        );
      }
    }

    const tx = await vault.refund(to, amount, { nonce: nonce });
    return await tx.wait();
  }

  async getTokenTransactions(token, network, address, startBlock = 0) {
    try {
      const tokenAddress = this.getTokenAddress(token, network);
      if (!tokenAddress) {
        console.error(`Token address not found for ${token} on ${network}`);
        return [];
      }

      if (
        network.toUpperCase() === "ETH" ||
        network.toUpperCase() === "SEPOLIA"
      ) {
        const response = await axios.get(this.etherscanBaseUrl, {
          params: {
            module: "account",
            action: "tokentx",
            contractaddress: tokenAddress,
            address: address,
            startblock: startBlock,
            endblock: 999999999,
            sort: "desc",
            apikey: this.etherscanApiKey,
          },
        });

        if (response.data.status === "1") {
          return response.data.result.map((tx) => ({
            ...tx,
            valueDecimal: Number(tx.value) / 1_000_000,
          }));
        }
        return [];
      } else {
        return await this.getTokenTransfersViaRPC(
          token,
          network,
          address,
          startBlock
        );
      }
    } catch (error) {
      console.error("Error fetching token transactions:", error);
      return await this.getTokenTransfersViaRPC(
        token,
        network,
        address,
        startBlock
      );
    }
  }

  async getTokenTransfersViaRPC(token, network, toAddress, fromBlock) {
    try {
      if (network && network.toUpperCase() === "TRON") {
        return await TronService.getTokenTransfers(token, toAddress, fromBlock);
      }
      const provider = this.getProvider(network);
      const tokenAddress = this.getTokenAddress(token, network);

      if (!provider || !tokenAddress) return [];

      const toAddrLc = toAddress.toLowerCase();
      const iface = new ethers.Interface(ERC20_ABI);

      const latest = await provider.getBlockNumber();
      const start = Number.isFinite(fromBlock)
        ? Math.max(0, fromBlock)
        : Math.max(0, latest - 2000);

      const maxRange = 500;
      const totalRange = latest - start;

      if (totalRange <= maxRange) {
        const filter = {
          address: tokenAddress,
          fromBlock: start,
          toBlock: latest,
          topics: [
            iface.getEvent("Transfer").topicHash,
            null,
            ethers.zeroPadValue(toAddrLc, 32),
          ],
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
                iface.getEvent("Transfer").topicHash,
                null,
                ethers.zeroPadValue(toAddrLc, 32),
              ],
            };

            const logs = await provider.getLogs(filter);
            allLogs.push(...logs);

            currentStart = currentEnd + 1;
          } catch (chunkError) {
            console.error(
              `Error scanning blocks ${currentStart}-${currentEnd}:`,
              chunkError
            );
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
      console.error("Error fetching token transfers:", error);
      return [];
    }
  }

  async getLatestBlockNumber(network = "ETH") {
    try {
      if (network && network.toUpperCase() === "TRON") {
        return await TronService.getLatestBlockNumber();
      }
      if (
        network.toUpperCase() === "ETH" ||
        network.toUpperCase() === "SEPOLIA"
      ) {
        const response = await axios.get(this.etherscanBaseUrl, {
          params: {
            module: "proxy",
            action: "eth_blockNumber",
            apikey: this.etherscanApiKey,
          },
        });
        return parseInt(response.data.result, 16);
      } else {
        const provider = this.getProvider(network);
        return await provider.getBlockNumber();
      }
    } catch (error) {
      console.error("Error getting latest block number:", error);
      return 0;
    }
  }

  async getTokenBalance(token, network, address) {
    try {
      const tokenAddress = this.getTokenAddress(token, network);
      if (!tokenAddress) return 0;

      if (
        network.toUpperCase() === "ETH" ||
        network.toUpperCase() === "SEPOLIA"
      ) {
        const response = await axios.get(this.etherscanBaseUrl, {
          params: {
            module: "account",
            action: "tokenbalance",
            contractaddress: tokenAddress,
            address: address,
            tag: "latest",
            apikey: this.etherscanApiKey,
          },
        });

        if (response.data.status === "1") {
          return parseFloat(response.data.result) / 1000000;
        }
        return 0;
      } else {
        const provider = this.getProvider(network);
        const contract = new ethers.Contract(
          tokenAddress,
          ["function balanceOf(address) view returns (uint256)"],
          provider
        );
        const balance = await contract.balanceOf(address);
        const decimals = this.getTokenDecimals(token, network);
        return parseFloat(ethers.formatUnits(balance, decimals));
      }
    } catch (error) {
      console.error("Error getting token balance:", error);
      return 0;
    }
  }

  async releaseFunds(
    token,
    network,
    buyerAddress,
    amount,
    amountWeiOverride = null,
    groupId = null
  ) {
    try {
      if (network && network.toUpperCase() === "TRON") {
        const tronResult = await TronService.releaseFunds({
          token,
          to: buyerAddress,
          amount,
          groupId,
        });
        return {
          success: true,
          transactionHash: tronResult.transactionHash,
          blockNumber: null,
        };
      }

      const contractAddress = await this.getEscrowContractAddress(
        token,
        network,
        groupId
      );
      if (!contractAddress) {
        throw new Error(
          `No escrow contract found for ${token} on ${network}${
            groupId ? ` for group ${groupId}` : ""
          }`
        );
      }

      const wallet = this.wallets[network.toUpperCase()];
      if (!wallet) {
        throw new Error(`Wallet not configured for network: ${network}`);
      }

      const provider = this.providers[network.toUpperCase()];
      const vaultContract = new ethers.Contract(
        contractAddress,
        ESCROW_VAULT_ABI,
        wallet
      );
      const decimals = this.getTokenDecimals(token, network);
      const amountWei = amountWeiOverride
        ? BigInt(amountWeiOverride)
        : ethers.parseUnits(amount.toString(), decimals);

      let nonce;
      try {
        nonce = await provider.getTransactionCount(wallet.address, "latest");
      } catch (nonceError) {
        try {
          nonce = await provider.getTransactionCount(wallet.address);
        } catch (fallbackError) {
          throw new Error(
            `Failed to get transaction nonce: ${fallbackError.message}`
          );
        }
      }

      // SAFETY CHECK: Verify Contract Balance
      // Re-initialize token contract to check balance
      const tokenAddressForCheck = await vaultContract.token();
      const tokenContractForCheck = new ethers.Contract(
        tokenAddressForCheck,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );
      const contractBalanceWei = await tokenContractForCheck.balanceOf(
        contractAddress
      );

      if (contractBalanceWei < amountWei) {
        throw new Error(
          `Insufficient Vault Balance: Contract has ${ethers.formatUnits(
            contractBalanceWei,
            decimals
          )} but needs ${ethers.formatUnits(amountWei, decimals)}`
        );
      }

      const tx = await vaultContract.release(buyerAddress, amountWei, {
        nonce: nonce,
      });
      const receipt = await tx.wait();

      const transactionHash =
        receipt.transactionHash || receipt.hash || tx.hash;

      return {
        success: true,
        transactionHash: transactionHash,
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      // Handle "already known" / nonce errors
      // Handle "already known" / nonce errors
      // Use exhaustive check for various provider error formats
      const isNonceError =
        (error?.code === -32000 && error?.message === "already known") ||
        (error?.message && error?.message.includes("already known")) ||
        (error?.message &&
          error?.message.includes("could not coalesce error")) ||
        (error?.shortMessage &&
          error?.shortMessage.includes("could not coalesce error")) ||
        error?.error?.message === "already known" ||
        error?.info?.error?.message === "already known";

      if (isNonceError) {
        console.warn(
          `⚠️ Nonce error detected in releaseFunds. Retrying with fresh nonce...`
        );
        try {
          const freshNonce = await provider.getTransactionCount(
            wallet.address,
            "latest"
          );
          const tx = await vaultContract.release(buyerAddress, amountWei, {
            nonce: freshNonce + 1, // Try incrementing if strictly needed, but fresh fetch usually enough
          });
          const receipt = await tx.wait();
          return {
            success: true,
            transactionHash: receipt.transactionHash || receipt.hash || tx.hash,
            blockNumber: receipt.blockNumber,
          };
        } catch (retryError) {
          console.error("Retry failed:", retryError);
          // Verify if it actually succeeded despite error (idempotency check would be ideal here but complex)
          throw retryError;
        }
      }

      // Provide a concise log for common provider errors (like insufficient gas funds)
      const code = error?.code || error?.shortMessage || "";
      const providerMessage =
        error?.info?.error?.message || error?.message || "";
      if (
        code === "INSUFFICIENT_FUNDS" ||
        providerMessage.toLowerCase().includes("insufficient funds")
      ) {
        console.error(
          `Error releasing funds: Insufficient gas balance on ${network}. Details: ${providerMessage}`
        );
      } else {
        console.error("Error releasing funds:", error);
      }
      throw error;
    }
  }

  async refundFunds(
    token,
    network,
    sellerAddress,
    amount,
    amountWeiOverride = null,
    groupId = null
  ) {
    try {
      if (network && network.toUpperCase() === "TRON") {
        const tronResult = await TronService.refundFunds({
          token,
          to: sellerAddress,
          amount,
          groupId,
        });
        return {
          success: true,
          transactionHash: tronResult.transactionHash,
          blockNumber: null,
        };
      }

      const contractAddress = await this.getEscrowContractAddress(
        token,
        network,
        groupId
      );
      if (!contractAddress) {
        throw new Error(
          `No escrow contract found for ${token} on ${network}${
            groupId ? ` for group ${groupId}` : ""
          }`
        );
      }

      const wallet = this.wallets[network.toUpperCase()];
      if (!wallet) {
        throw new Error(`Wallet not configured for network: ${network}`);
      }

      const provider = this.providers[network.toUpperCase()];
      const vaultContract = new ethers.Contract(
        contractAddress,
        ESCROW_VAULT_ABI,
        wallet
      );
      const decimals = this.getTokenDecimals(token, network);
      const amountWei = amountWeiOverride
        ? BigInt(amountWeiOverride)
        : ethers.parseUnits(amount.toString(), decimals);

      let nonce;
      try {
        nonce = await provider.getTransactionCount(wallet.address, "latest");
      } catch (nonceError) {
        try {
          nonce = await provider.getTransactionCount(wallet.address);
        } catch (fallbackError) {
          throw new Error(
            `Failed to get transaction nonce: ${fallbackError.message}`
          );
        }
      }

      // SAFETY CHECK: Verify Contract Balance
      // Re-initialize token contract to check balance
      const tokenAddressForCheck = await vaultContract.token();
      const tokenContractForCheck = new ethers.Contract(
        tokenAddressForCheck,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );
      const contractBalanceWei = await tokenContractForCheck.balanceOf(
        contractAddress
      );

      if (contractBalanceWei < amountWei) {
        throw new Error(
          `Insufficient Vault Balance: Contract has ${ethers.formatUnits(
            contractBalanceWei,
            decimals
          )} but needs ${ethers.formatUnits(amountWei, decimals)}`
        );
      }

      const tx = await vaultContract.refund(sellerAddress, amountWei, {
        nonce: nonce,
      });
      const receipt = await tx.wait();

      const transactionHash =
        receipt.transactionHash || receipt.hash || tx.hash;

      return {
        success: true,
        transactionHash: transactionHash,
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      // Handle "already known" / nonce errors
      // Use exhaustive check for various provider error formats
      const isNonceError =
        (error?.code === -32000 && error?.message === "already known") ||
        (error?.message && error?.message.includes("already known")) ||
        (error?.message &&
          error?.message.includes("could not coalesce error")) ||
        (error?.shortMessage &&
          error?.shortMessage.includes("could not coalesce error")) ||
        error?.error?.message === "already known" ||
        error?.info?.error?.message === "already known";

      if (isNonceError) {
        console.warn(
          `⚠️ Nonce error detected in refundFunds. Retrying with fresh nonce...`
        );
        try {
          const freshNonce = await provider.getTransactionCount(
            wallet.address,
            "latest"
          );
          const tx = await vaultContract.refund(sellerAddress, amountWei, {
            nonce: freshNonce + 1,
          });
          const receipt = await tx.wait();
          return {
            success: true,
            transactionHash: receipt.transactionHash || receipt.hash || tx.hash,
            blockNumber: receipt.blockNumber,
          };
        } catch (retryError) {
          console.error("Retry failed:", retryError);
          throw retryError;
        }
      }

      // Provide a concise log for common provider errors (like insufficient gas funds)
      const code = error?.code || error?.shortMessage || "";
      const providerMessage =
        error?.info?.error?.message || error?.message || "";
      if (
        code === "INSUFFICIENT_FUNDS" ||
        providerMessage.toLowerCase().includes("insufficient funds")
      ) {
        console.error(
          `Error refunding funds: Insufficient gas balance on ${network}. Details: ${providerMessage}`
        );
      } else {
        console.error("Error refunding funds:", error);
      }
      throw error;
    }
  }

  async getEscrowContractAddress(token, network, groupId = null) {
    try {
      const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);

      if (groupId) {
        const groupContract = await ContractModel.findOne({
          name: "EscrowVault",
          token: token.toUpperCase(),
          network: network.toUpperCase(),
          feePercent: desiredFeePercent,
          groupId: groupId,
          status: "deployed",
        });

        if (groupContract) {
          return groupContract.address;
        }
      }

      const contract = await ContractModel.findOne({
        name: "EscrowVault",
        token: token.toUpperCase(),
        network: network.toUpperCase(),
        feePercent: desiredFeePercent,
        status: "deployed",
      });

      return contract ? contract.address : null;
    } catch (error) {
      console.error("Error getting escrow contract address:", error);
      return null;
    }
  }

  getTokenAddress(token, network) {
    const tokenKey = `${token}_${network.toUpperCase()}`;
    return config[tokenKey];
  }

  async withdrawToAdmin(contractAddress, adminAddress, token, network, amount) {
    try {
      const wallet = this.wallets[network.toUpperCase()];
      if (!wallet) {
        throw new Error(`Wallet not configured for network: ${network}`);
      }

      const provider = this.providers[network.toUpperCase()];
      const vaultContract = new ethers.Contract(
        contractAddress,
        ESCROW_VAULT_ABI,
        wallet
      );
      const decimals = this.getTokenDecimals(token, network);
      const amountWei = ethers.parseUnits(amount.toString(), decimals);

      const tokenAddress = this.getTokenAddress(token, network);
      if (!tokenAddress) {
        throw new Error(`Token address not found for ${token} on ${network}`);
      }

      let nonce;
      try {
        nonce = await provider.getTransactionCount(wallet.address, "latest");
      } catch (nonceError) {
        try {
          nonce = await provider.getTransactionCount(wallet.address);
        } catch (fallbackError) {
          throw new Error(
            `Failed to get transaction nonce: ${fallbackError.message}`
          );
        }
      }

      const tx = await vaultContract.withdrawToken(tokenAddress, adminAddress, {
        nonce: nonce,
      });
      const receipt = await tx.wait();

      const transactionHash =
        receipt.transactionHash || receipt.hash || tx.hash;

      return transactionHash;
    } catch (error) {
      console.error("Error withdrawing to admin:", error);
      throw error;
    }
  }
}

module.exports = new BlockchainService();
