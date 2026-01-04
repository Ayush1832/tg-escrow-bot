const TronWeb = require("tronweb");
const ContractModel = require("../models/Contract");
const config = require("../../config");

const ESCROW_VAULT_ABI = [
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "release",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "refund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "erc20Token", type: "address" },
      { internalType: "address", name: "to", type: "address" },
    ],
    name: "withdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawFees",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "accumulatedFees",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feeWallet",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

class TronService {
  constructor() {
    this.tronWeb = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    const rawKey = config.TRC_PRIVATE_KEY || config.HOT_WALLET_PRIVATE_KEY;
    const privateKey = rawKey.startsWith("0x") ? rawKey.slice(2) : rawKey;

    this.tronWeb = new TronWeb({
      fullHost: config.TRON_RPC_URL || "https://api.trongrid.io",
      privateKey,
    });

    this.initialized = true;
  }

  toSun(amount) {
    return this.tronWeb.toBigNumber(Math.round(Number(amount) * 1e6));
  }

  async getVaultContract(token = "USDT", groupId = null) {
    await this.init();

    const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
    const query = {
      name: "EscrowVault",
      token: token.toUpperCase(),
      network: "TRON",
      feePercent: desiredFeePercent,
      status: "deployed",
    };

    if (groupId) {
      query.groupId = groupId;
    }

    const contractEntry = await ContractModel.findOne(query);
    if (!contractEntry) {
      throw new Error(
        `EscrowVault not found for ${token} on TRON with ${desiredFeePercent}% fee${
          groupId ? ` (group ${groupId})` : ""
        }`
      );
    }

    const contract = await this.tronWeb.contract(
      ESCROW_VAULT_ABI,
      contractEntry.address
    );
    return { contract, address: contractEntry.address };
  }

  async releaseFunds({ token = "USDT", to, amount, groupId = null }) {
    try {
      const { contract, address } = await this.getVaultContract(token, groupId);
      const amountSun = this.toSun(amount);

      const tx = await contract.release(to, amountSun).send({
        feeLimit: 100_000_000, // 100 TRX sun
        callValue: 0,
      });

      return {
        success: true,
        transactionHash: tx,
        contractAddress: address,
      };
    } catch (error) {
      console.error("TRON releaseFunds error:", error);
      throw error;
    }
  }

  async refundFunds({ token = "USDT", to, amount, groupId = null }) {
    try {
      const { contract, address } = await this.getVaultContract(token, groupId);
      const amountSun = this.toSun(amount);

      const tx = await contract.refund(to, amountSun).send({
        feeLimit: 100_000_000, // 100 TRX sun
        callValue: 0,
      });

      return {
        success: true,
        transactionHash: tx,
        contractAddress: address,
      };
    } catch (error) {
      console.error("TRON refundFunds error:", error);
      throw error;
    }
  }

  async withdrawToken({ contractAddress, token = "USDT", to }) {
    await this.init();
    try {
      // If token is USDT, resolve address from config
      const tokenAddress =
        token.toUpperCase() === "USDT" ? config.USDT_TRON : token;

      const contract = await this.tronWeb.contract(
        ESCROW_VAULT_ABI,
        contractAddress
      );

      const tx = await contract.withdrawToken(tokenAddress, to).send({
        feeLimit: 100_000_000,
        callValue: 0,
      });

      return {
        success: true,
        transactionHash: tx,
        contractAddress: contractAddress,
      };
    } catch (error) {
      console.error("TRON withdrawToken error:", error);
      throw error;
    }
  }

  async getFeeSettings({ token = "USDT" }) {
    await this.init();
    try {
      const { contract } = await this.getVaultContract(token);

      // TRON calls
      const feeWallet = await contract.feeWallet().call();
      const accumulated = await contract.accumulatedFees().call();
      // feePercent might be in the contract if you added it to ABI, but sticking to basics:
      // If feePercent is not in ABI, we return config value or fetch if added.
      // The user's Solidity likely has feePercent(). Check ABI first.
      // ABI from previous step HAS accumulatedFees and feeWallet.
      // It DOES NOT have feePercent in the snippet I pasted (Step 3770/3736).
      // But EscrowVault.sol usually has it.
      // For now, let's assume we can rely on config or add feePercent to ABI if needed.
      // The BlockchainService uses vault.feePercent().
      // Let's add feePercent to ABI in TronService just in case, or just return from config.
      // Let's fetch it from config for now to be safe, or check ABI.
      // Actually, let's check ABI in Step 3770. It ends at line 50.
      // Step 3610 shows lines 1-36.
      // I added withdrawToken etc.
      // I should update ABI to include feePercent too if I want to read it.
      // But looking at BlockchainService, it uses vault.feePercent().
      // Let's assume I need to add it to ABI.

      // But first, let's write the function assuming 0 if not dynamic, or fetching from contract if I update ABI.
      // Wait, getVaultContract uses config.ESCROW_FEE_PERCENT to find the contract.
      // So returning that is safe.

      // Return raw values, normalizer will handle formatting
      return {
        feeWallet: this.tronWeb.address.fromHex(feeWallet),
        feePercent: Number(config.ESCROW_FEE_PERCENT || 0),
        accumulated: accumulated.toString(),
      };
    } catch (error) {
      console.error("TRON getFeeSettings error:", error);
      throw error;
    }
  }

  async withdrawFees({ token = "USDT" }) {
    await this.init();
    try {
      const { contract, address } = await this.getVaultContract(token);
      const tx = await contract.withdrawFees().send({
        feeLimit: 100_000_000,
        callValue: 0,
      });

      return {
        success: true,
        transactionHash: tx,
        contractAddress: address,
      };
    } catch (error) {
      console.error("TRON withdrawFees error:", error);
      throw error;
    }
  }

  /**
   * Fetch TRC20 Transfer events to a given address (best-effort via TronGrid)
   * @param {string} token
   * @param {string} toAddress
   * @param {number} fromBlock
   * @returns {Promise<Array<{from:string,to:string,valueDecimal:number,blockNumber:number}>>}
   */
  async getTokenTransfers(token = "USDT", toAddress, fromBlock = 0) {
    await this.init();
    const tokenAddress =
      token.toUpperCase() === "USDT" ? config.USDT_TRON : null;
    if (!tokenAddress || !toAddress) return [];

    try {
      const events = await this.tronWeb.getEventResult(tokenAddress, {
        eventName: "Transfer",
        size: 200,
        page: 1,
        onlyConfirmed: true,
        filters: { to: toAddress },
      });

      return (events || [])
        .filter(
          (ev) => ev && ev.result && (!fromBlock || ev.block_number > fromBlock)
        )
        .map((ev) => {
          const from = ev.result.from;
          const to = ev.result.to;
          const value = ev.result.value || "0";
          const valueDecimal = Number(value) / 1e6; // USDT TRON has 6 decimals
          return {
            from,
            to,
            valueDecimal,
            blockNumber: ev.block_number,
          };
        });
    } catch (error) {
      console.error("TRON getTokenTransfers error:", error);
      return [];
    }
  }

  async getLatestBlockNumber() {
    await this.init();
    try {
      const block = await this.tronWeb.trx.getCurrentBlock();
      return block?.block_header?.raw_data?.number || 0;
    } catch (error) {
      console.error("TRON getLatestBlockNumber error:", error);
      return 0;
    }
  }
}

module.exports = new TronService();
