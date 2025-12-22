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
