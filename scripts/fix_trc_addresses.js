const mongoose = require("mongoose");
const GroupPool = require("../src/models/GroupPool");
const Contract = require("../src/models/Contract");
const config = require("../config");
const TronWeb = require("tronweb");

async function main() {
  console.log("🛠️ Starting TRON Address Fixer (Hex -> Base58)...");

  await mongoose.connect(config.MONGODB_URI);
  console.log("✅ Connected to MongoDB.");

  // Dummy TronWeb instance for utilities
  const tronWeb = new TronWeb({
    fullNode: "https://api.trongrid.io",
    solidityNode: "https://api.trongrid.io",
    eventServer: "https://api.trongrid.io",
  });

  // 1. Fix Contracts
  const contracts = await Contract.find({ network: "TRON", token: "USDT" });
  let contractsFixed = 0;

  for (const contract of contracts) {
    if (contract.address.startsWith("41")) {
      const base58 = tronWeb.address.fromHex(contract.address);
      console.log(`🔹 Converting Contract ${contract.address} -> ${base58}`);
      contract.address = base58;
      await contract.save();
      contractsFixed++;
    }
  }
  console.log(`✅ Fixed ${contractsFixed} contracts.`);

  // 2. Fix Groups
  const groups = await GroupPool.find({});
  let groupsFixed = 0;

  for (const group of groups) {
    let isModified = false;

    // Check legacy contractAddress
    if (group.contractAddress && group.contractAddress.startsWith("41")) {
      // Only fix if it looks like a Tron address (starts with 41 is generic for hex but safe enough context here)
      // But legacy field might be BSC? BSC addresses start with 0x. Tron Hex starts with 41.
      // Safe to assume 41 is Tron.
      try {
        group.contractAddress = tronWeb.address.fromHex(group.contractAddress);
        isModified = true;
      } catch (e) {}
    }

    // Check contracts Map
    if (group.contracts) {
      // Handle Map or Object
      let usdtTron =
        group.contracts instanceof Map
          ? group.contracts.get("USDT_TRON")
          : group.contracts.USDT_TRON;

      if (usdtTron && usdtTron.address && usdtTron.address.startsWith("41")) {
        const base58 = tronWeb.address.fromHex(usdtTron.address);
        console.log(
          `🔹 Converting Group ${group.groupTitle} TRON: ${usdtTron.address} -> ${base58}`
        );

        if (group.contracts instanceof Map) {
          usdtTron.address = base58;
          group.contracts.set("USDT_TRON", usdtTron);
        } else {
          group.contracts.USDT_TRON.address = base58;
          // Mark modified if using Mixed type, but Map needs set
        }
        isModified = true;
      }
    }

    if (isModified) {
      await group.save();
      groupsFixed++;
    }
  }

  console.log(`✅ Fixed ${groupsFixed} groups.`);
  console.log("🎉 All Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
