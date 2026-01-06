const mongoose = require("mongoose");
const GroupPool = require("../src/models/GroupPool");
const Contract = require("../src/models/Contract");
const BlockchainService = require("../src/services/BlockchainService");
const config = require("../config");

async function dump() {
  await mongoose.connect(config.MONGODB_URI);
  await BlockchainService.initialize();

  const groups = await GroupPool.find({});
  const contracts = await Contract.find({ network: "BSC", status: "deployed" });

  // Cache fees
  const feeMap = {};
  const FEE_ABI = ["function feePercent() view returns (uint256)"];

  for (const c of contracts) {
    try {
      const provider = BlockchainService.getProvider(c.network);
      const contract = new ethers.Contract(c.address, FEE_ABI, provider);
      const fee = await contract.feePercent();
      feeMap[c.address] = Number(fee) / 100;
    } catch (e) {
      feeMap[c.address] = "ERR";
    }
  }

  console.log("---------------------------------------------------");
  console.log("GROUP BSC CONTRACT DUMP");
  console.log("---------------------------------------------------");

  for (const group of groups) {
    console.log(`\nGroup ${group.groupId} [Target Fee: ${group.feePercent}%]`);

    const map = group.contracts || {};
    const usdt = map.get ? map.get("USDT") : map["USDT"];
    const usdc = map.get ? map.get("USDC") : map["USDC"];
    const busd = map.get ? map.get("BUSD") : map["BUSD"];

    const check = (token, obj) => {
      if (!obj) return `❌ ${token}: MISSING`;
      const addr = obj.address;
      const real = feeMap[addr];
      const status =
        real === group.feePercent ? "✅ MATCH" : `❌ MISMATCH (Act: ${real}%)`;
      return `${status} | ${token}: ${addr} | Fee on Chain: ${real}%`;
    };

    console.log("  " + check("USDT", usdt));
    console.log("  " + check("USDC", usdc));
    if (busd) console.log("  " + check("BUSD", busd));
  }

  await mongoose.disconnect();
}

const { ethers } = require("ethers");
dump().catch(console.error);
