const mongoose = require("mongoose");
const GroupPool = require("../src/models/GroupPool");
const Contract = require("../src/models/Contract");
const config = require("../config");

async function main() {
  console.log("🔍 Verifying Group Contract Assignments...");

  await mongoose.connect(config.MONGODB_URI);
  console.log("✅ Connected to MongoDB.");

  // Fetch groups
  const targetRegex = /^Room (2[4-9]|3[0-9]|4[0-5])$/; // Room 24-45
  const allGroups = await GroupPool.find({}).sort({ createdAt: 1 });
  const groups = allGroups.filter((g) => targetRegex.test(g.groupTitle));

  // Fetch deployed contracts
  const contracts = await Contract.find({ network: "TRON", token: "USDT" });

  console.log(`Found ${groups.length} groups to check.`);
  console.log(`Found ${contracts.length} deployed TRON contracts.`);

  contracts.forEach((c) => {
    console.log(`Contract [${c.feePercent}%]: ${c.address}`);
  });

  let errors = 0;

  for (const group of groups) {
    let groupTron;
    if (group.contracts instanceof Map) {
      groupTron = group.contracts.get("USDT_TRON");
    } else {
      groupTron = group.contracts?.USDT_TRON;
    }

    if (!groupTron) {
      console.error(`❌ [${group.groupTitle}] No TRON contract assigned.`);
      errors++;
      continue;
    }

    // Check if assigned address exists in contracts DB
    const matchedContract = contracts.find(
      (c) => c.address === groupTron.address
    );

    if (!matchedContract) {
      console.error(
        `❌ [${group.groupTitle}] Assigned TRON address ${groupTron.address} NOT FOUND in contracts DB!`
      );
      errors++;
    } else {
      // Check fee mismatch
      if (matchedContract.feePercent !== group.feePercent) {
        console.error(
          `❌ [${group.groupTitle}] Fee Mismatch! Group: ${group.feePercent}%, Contract: ${matchedContract.feePercent}% (${matchedContract.address})`
        );
        errors++;
      } else {
        // console.log(`✅ [${group.groupTitle}] Verified. ${groupTron.address} (${group.feePercent}%)`);
      }
    }
  }

  if (errors === 0) {
    console.log("\n✅ All group assignments match deployed contracts.");
  } else {
    console.log(`\n❌ Found ${errors} errors.`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
