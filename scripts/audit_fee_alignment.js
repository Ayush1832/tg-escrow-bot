const mongoose = require("mongoose");
const { ethers } = require("ethers");
const Contract = require("../src/models/Contract");
const GroupPool = require("../src/models/GroupPool");
const BlockchainService = require("../src/services/BlockchainService"); // Instance
const config = require("../config");

// Minimal ABI to check fee
const FEE_ABI = ["function feePercent() view returns (uint256)"];

async function audit() {
  console.log("🔍 Starting Fee Alignment Audit...");
  await mongoose.connect(config.MONGODB_URI);
  console.log("✅ Connected to database");

  await BlockchainService.initialize();

  // 1. Audit Contracts (DB vs Blockchain)
  console.log("\n==================================================");
  console.log("PHASE 1: CONTRACT AUDIT (DB vs Blockchain)");
  console.log("==================================================");

  const contracts = await Contract.find({ status: "deployed" });
  console.log(`📋 Found ${contracts.length} deployed contracts.`);

  const contractFeeMap = {}; // address -> realFeePercent

  for (const contract of contracts) {
    let logPrefix = `[${contract.network} ${
      contract.token
    } ${contract.address.slice(0, 6)}...]`;

    try {
      let realFeePercent = -1;

      if (contract.network === "TRON") {
        // Use TronService via BlockchainService or directly?
        // Since BlockchainService delegates, let's try getting vault and calling feePercent
        // But simplest is using TronService helper if available, or direct call.
        // Let's use BlockchainService.getFeeSettings which handles TRON delegation
        const settings = await BlockchainService.getFeeSettings(
          contract.token,
          contract.network,
          contract.address
        );
        realFeePercent = settings.feePercent;
      } else {
        // EVM
        const provider = BlockchainService.getProvider(contract.network);
        const c = new ethers.Contract(contract.address, FEE_ABI, provider);
        const fee = await c.feePercent();
        realFeePercent = Number(fee);
      }

      // Store for Phase 2
      contractFeeMap[contract.address] = realFeePercent;

      // Normalize chain fee (25 -> 0.25)
      realFeePercent = realFeePercent / 100;

      // DB usually stores as number e.g. 0.5. Blockchain might verify differently?
      // Wait, contract returns uint256 feePercent.
      // If deployed code says "50" for 0.5% or "5000" for 50%, we need to know the basis.
      // Usually fee is basis points or direct percentage scaled.
      // Looking at `audit_bsc_fees.js` (if I recall) or `adminHandler` output, fees were displayed as percentages.
      // Let's assume on-chain value IS the value we expect (e.g. 25 for 0.25%? Or 2500?).
      // Let's simply compare DB value vs Chain value.

      // Actually, looking at `getFeeSettings` in `BlockchainService.js`:
      // `feePercent: Number(feePercent)`
      // So checking `contract.feePercent` vs `realFeePercent`.

      const dbFee = contract.feePercent;
      if (dbFee !== realFeePercent) {
        console.log(
          `${logPrefix} ❌ MISMATCH! DB: ${dbFee}% | Chain: ${realFeePercent}%`
        );
        // We can buffer a fix here
      } else {
        console.log(`${logPrefix} ✅ OK. Fee: ${realFeePercent}%`);
      }
    } catch (e) {
      console.log(`${logPrefix} ⚠️ Error checking fee: ${e.message}`);
    }
    // Rate limit
    await new Promise((r) => setTimeout(r, 200));
  }

  // 2. Audit Groups (Group Config vs Assigned Contract Real Fee)
  console.log("\n==================================================");
  console.log("PHASE 2: GROUP POOL AUDIT");
  console.log("==================================================");

  const groups = await GroupPool.find({});
  console.log(`📋 Found ${groups.length} groups.`);

  for (const group of groups) {
    console.log(`\n👥 Group ${group.groupId} (Expects: ${group.feePercent}%)`);

    // Check contracts map
    if (group.contracts) {
      // group.contracts is a Map in Mongoose, prints as object or Map
      // We need to iterate it.
      // Mongoose Map: use .get() or .keys()
      // But in a loop over docs, it might be a POJO if .lean() ? No, it's Mongoose doc.
      // Let's assume standard iteration

      let mapData = group.contracts;
      // Contracts map keys: "USDT_BSC", "USDC_BSC" etc.
      // Or just "USDT" if legacy? AddressAssignmentService handles both.

      for (const [key, contractObj] of mapData.entries
        ? mapData.entries()
        : Object.entries(mapData)) {
        if (!contractObj || !contractObj.address) continue;

        const address = contractObj.address;
        let realFee = contractFeeMap[address];

        if (realFee === undefined) {
          console.log(
            `   🔸 ${key}: Contract ${address} not audited (not in deployed list?)`
          );
          continue;
        }

        // Normalize chain fee (25 -> 0.25)
        realFee = realFee / 100;

        if (realFee !== group.feePercent) {
          console.log(
            `   ❌ ${key}: MISMATCH! Uses ${address} (Fee: ${realFee}%) but Group wants ${group.feePercent}%`
          );
        } else {
          console.log(`   ✅ ${key}: OK (${address})`);
        }
      }
    } else {
      console.log(`   ⚠️ No contracts map found.`);
    }
  }

  await mongoose.disconnect();
  console.log("\n✅ Audit complete.");
}

audit().catch(console.error);
