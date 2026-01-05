require("dotenv").config();
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const Contract = require("../src/models/Contract");
const config = require("../config");

async function auditFees() {
  console.log("🔍 Starting BSC Fee Audit...");

  // 1. Connect to MongoDB
  await mongoose.connect(config.MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  // 2. Connect to BSC
  const provider = new ethers.JsonRpcProvider(config.BSC_RPC_URL);
  console.log("✅ Connected to BSC RPC");

  // 3. Fetch Contracts
  const contracts = await Contract.find({
    network: { $in: ["BSC", "BNB"] },
  });
  console.log(`📋 Found ${contracts.length} BSC contracts in DB.`);

  // 4. Audit Loop
  const ABI = ["function feePercent() view returns (uint256)"];

  console.log("\n---------------------------------------------------");
  console.log("AUDIT RESULTS (Fee % in Basis Points: 100 = 1%)");
  console.log("---------------------------------------------------");
  console.log(
    `${"Token".padEnd(8)} | ${"Address".padEnd(42)} | ${"DB %".padEnd(
      6
    )} | ${"Chain %".padEnd(8)} | ${"Status"}`
  );
  console.log("-".repeat(90));

  for (const c of contracts) {
    try {
      const contract = new ethers.Contract(c.address, ABI, provider);
      const onChainFee = await contract.feePercent();
      const onChainFeeNum = Number(onChainFee);

      // DB stores as percent? e.g. 0.5 or 1? Or basis points?
      // Contract model says default 0. Usually user stores 0.5 for 0.5%.
      // Solidity stores 50 for 0.5% (if Basis Points is 10000) OR 100 for 1%.
      // EscrowVault.sol comment says: "feePercent in basis points (e.g., 100 = 1.00%)".
      // So 1% = 100.
      // If DB says 1, it means 1%.

      // Let's display raw values.

      const match = c.feePercent * 100 === onChainFeeNum;
      // Assumption: DB uses float (1.0), Chain uses BP (100).
      // Or if DB uses BP, then direct match.
      // I'll display both raw values to be safe.

      const status = match ? "✅ Match" : "⚠️ Mismatch?";

      console.log(
        `${c.token.padEnd(8)} | ${c.address} | ${c.feePercent
          .toString()
          .padEnd(6)} | ${onChainFeeNum.toString().padEnd(8)}`
      );
    } catch (e) {
      console.log(
        `${c.token.padEnd(8)} | ${c.address} | ${c.feePercent
          .toString()
          .padEnd(6)} | ${"ERROR".padEnd(8)} | ${e.message.slice(0, 20)}`
      );
    }
    // Rate limit friendly
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("\n✅ Audit Complete.");
  process.exit(0);
}

auditFees().catch((e) => {
  console.error(e);
  process.exit(1);
});
