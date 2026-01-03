const mongoose = require("mongoose");
const GroupPool = require("../src/models/GroupPool");
const Contract = require("../src/models/Contract");
const config = require("../config");

async function main() {
  console.log("Starting group-contract linking (USDT & USDC)...");

  await mongoose.connect(config.MONGODB_URI);
  console.log("Connected to MongoDB.");

  // Fetch 40 available groups
  // We assume we are setting up a fresh batch or updating existing ones.
  const groups = await GroupPool.find({ status: "available" })
    .sort({ createdAt: 1 })
    .limit(40);

  if (groups.length < 40) {
    console.warn(
      `⚠️ Warning: Found only ${groups.length} available groups. Logic expects 40.`
    );
  }

  // Fetch Contracts (Newest first)
  const usdtContracts = await Contract.find({
    token: "USDT",
    network: "BSC",
  }).sort({ createdAt: -1 }); // Get the "new" ones from recent deployment
  const usdcContracts = await Contract.find({
    token: "USDC",
    network: "BSC",
  }).sort({ createdAt: -1 });

  // Helper to filter by fee
  const getContracts = (list, fee, count) =>
    list.filter((c) => c.feePercent === fee).slice(0, count);

  // USDT Allocations (Unique 1:1) - Scaled for 40
  const usdt025 = getContracts(usdtContracts, 0.25, 24);
  const usdt050 = getContracts(usdtContracts, 0.5, 8);
  const usdt075 = getContracts(usdtContracts, 0.75, 8);

  // USDC Allocations (Shared) - Scaled
  const usdc025 = getContracts(usdcContracts, 0.25, 6);
  const usdc050 = getContracts(usdcContracts, 0.5, 2);
  const usdc075 = getContracts(usdcContracts, 0.75, 2);

  console.log(
    `USDT Available: 0.25%(${usdt025.length}/24), 0.50%(${usdt050.length}/8), 0.75%(${usdt075.length}/8)`
  );
  console.log(
    `USDC Available: 0.25%(${usdc025.length}/6), 0.50%(${usdc050.length}/2), 0.75%(${usdc075.length}/2)`
  );

  let groupIndex = 0;

  // --- Tier 1: 0.25% (24 Groups) ---
  for (let i = 0; i < 24; i++) {
    if (groupIndex >= groups.length) break;
    const group = groups[groupIndex];
    const usdt = usdt025[i];

    // Distribute 6 USDC contracts among 24 groups (4 groups per contract)
    const usdcIndex = Math.floor(i / 4);
    const usdc = usdc025[usdcIndex];

    if (usdt && usdc) {
      group.contracts = {
        USDT: {
          address: usdt.address,
          feePercent: usdt.feePercent,
          network: "BSC",
        },
        USDC: {
          address: usdc.address,
          feePercent: usdc.feePercent,
          network: "BSC",
        },
      };

      // Legacy fallback (optional)
      group.contractAddress = usdt.address;
      group.feePercent = 0.25;

      await group.save();
      console.log(
        `✅ [${
          group.groupTitle || group.groupId
        }] Linked 0.25%: USDT(${usdt.address.slice(
          0,
          6
        )}) / USDC(${usdc.address.slice(0, 6)})`
      );
    } else {
      console.error(`❌ Missing contracts for 0.25% group ${group.groupId}`);
    }
    groupIndex++;
  }

  // --- Tier 2: 0.50% (8 Groups) ---
  for (let i = 0; i < 8; i++) {
    if (groupIndex >= groups.length) break;
    const group = groups[groupIndex];
    const usdt = usdt050[i];

    // Distribute 2 USDC contracts among 8 groups (4 groups per contract)
    const usdcIndex = Math.floor(i / 4);
    const usdc = usdc050[usdcIndex];

    if (usdt && usdc) {
      group.contracts = {
        USDT: {
          address: usdt.address,
          feePercent: usdt.feePercent,
          network: "BSC",
        },
        USDC: {
          address: usdc.address,
          feePercent: usdc.feePercent,
          network: "BSC",
        },
      };
      group.contractAddress = usdt.address;
      group.feePercent = 0.5;
      await group.save();
      console.log(
        `✅ [${
          group.groupTitle || group.groupId
        }] Linked 0.50%: USDT(${usdt.address.slice(
          0,
          6
        )}) / USDC(${usdc.address.slice(0, 6)})`
      );
    } else {
      console.error(`❌ Missing contracts for 0.50% group ${group.groupId}`);
    }
    groupIndex++;
  }

  // --- Tier 3: 0.75% (8 Groups) ---
  for (let i = 0; i < 8; i++) {
    if (groupIndex >= groups.length) break;
    const group = groups[groupIndex];
    const usdt = usdt075[i];

    // Distribute 2 USDC contracts among 8 groups (4 groups per contract)
    const usdcIndex = Math.floor(i / 4);
    const usdc = usdc075[usdcIndex];

    if (usdt && usdc) {
      group.contracts = {
        USDT: {
          address: usdt.address,
          feePercent: usdt.feePercent,
          network: "BSC",
        },
        USDC: {
          address: usdc.address,
          feePercent: usdc.feePercent,
          network: "BSC",
        },
      };
      group.contractAddress = usdt.address;
      group.feePercent = 0.75;
      await group.save();
      console.log(
        `✅ [${
          group.groupTitle || group.groupId
        }] Linked 0.75%: USDT(${usdt.address.slice(
          0,
          6
        )}) / USDC(${usdc.address.slice(0, 6)})`
      );
    } else {
      console.error(`❌ Missing contracts for 0.75% group ${group.groupId}`);
    }
    groupIndex++;
  }

  console.log(`\n🎉 Linking complete. Processed ${groupIndex} groups.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
