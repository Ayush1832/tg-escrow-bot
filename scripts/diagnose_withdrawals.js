const mongoose = require("mongoose");
const { ethers } = require("ethers");
const Contract = require("../src/models/Contract");
const Escrow = require("../src/models/Escrow"); // Adjust path if needed
const BlockchainService = require("../src/services/BlockchainService");
const config = require("../config");

async function diagnose() {
  console.log("🔍 Starting diagnostic scan for BSC...");

  await mongoose.connect(config.MONGODB_URI);
  console.log("✅ Connected to database");

  const contracts = await Contract.find({
    network: "BSC",
    status: "deployed",
  });

  console.log(`📋 Found ${contracts.length} deployed contracts.`);

  // BlockchainService exports a singleton instance
  const service = BlockchainService;
  await service.initialize();

  console.log("\n==================================================");
  console.log("DIAGNOSTIC REPORT");
  console.log("==================================================\n");

  for (const contract of contracts) {
    let logPrefix = `[${contract.address.slice(0, 6)}... ${contract.token}]`;

    // 1. Fee Settings
    let accumulated = "0";
    try {
      const settings = await service.getFeeSettings(
        contract.token,
        "BSC",
        contract.address
      );
      accumulated = settings.accumulated;
    } catch (e) {
      console.log(`${logPrefix} ❌ Error fetching fees: ${e.message}`);
      continue;
    }

    // 2. Active Deals
    const activeCount = await Escrow.countDocuments({
      contractAddress: contract.address,
      status: {
        $in: [
          "awaiting_deposit",
          "deposited",
          "in_fiat_transfer",
          "ready_to_release",
        ],
      },
    });

    // 3. Actual Balance
    let balance = 0;
    try {
      balance = await service.getTokenBalance(
        contract.token,
        "BSC",
        contract.address
      );
    } catch (e) {
      console.log(`${logPrefix} ❌ Error fetching balance: ${e.message}`);
    }

    // Analysis
    if (balance > 0 || parseFloat(accumulated) > 0) {
      console.log(
        `${logPrefix} Balance: ${balance.toFixed(
          4
        )} | Fees Pending: ${accumulated} | Active Deals: ${activeCount}`
      );

      if (parseFloat(accumulated) > 0) {
        console.log(`   -> 💰 Should Withdraw Fees: YES`);
      } else {
        console.log(`   -> 💰 Should Withdraw Fees: NO (0 accumulated)`);
      }

      if (activeCount === 0) {
        if (balance > 0) {
          console.log(`   -> 🧹 Should Sweep Surplus: YES`);
        } else {
          console.log(`   -> 🧹 Should Sweep Surplus: NO (0 balance)`);
        }
      } else {
        console.log(
          `   -> 🧹 Should Sweep Surplus: NO (Contract Busy - Safety Lock)`
        );
        if (balance > 10) {
          console.log(
            `      ⚠️ WARNING: Large balance (${balance}) locked by active deals!`
          );
        }
      }
      console.log("--------------------------------------------------");
    }
  }

  await mongoose.disconnect();
  console.log("\n✅ Diagnostic complete.");
}

diagnose().catch(console.error);
