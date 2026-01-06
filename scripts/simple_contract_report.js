const mongoose = require("mongoose");
const GroupPool = require("../src/models/GroupPool");
const config = require("../config");
const Table = require("cli-table3");

async function simpleContractReport() {
  console.log("📊 GROUP CONTRACT ASSIGNMENT REPORT\n");
  await mongoose.connect(config.MONGODB_URI);

  const groups = await GroupPool.find({}).sort({ groupTitle: 1 });

  const room24to45 = [];
  for (const group of groups) {
    const title = group.groupTitle || "";
    const match = title.match(/Room (\d+)/);

    if (match) {
      const roomNum = parseInt(match[1]);
      if (roomNum >= 24 && roomNum <= 45) {
        room24to45.push(group);
      }
    }
  }

  console.log(`Total Groups: ${room24to45.length}\n`);
  console.log("=".repeat(120));

  // Create master table
  const masterTable = new Table({
    head: [
      "Group",
      "Group Fee",
      "Token",
      "Network",
      "Contract Address",
      "Contract Fee",
      "Match",
    ],
    colWidths: [12, 12, 15, 10, 45, 14, 8],
  });

  let perfectMatches = 0;
  let mismatches = 0;

  // Track unique contracts
  const uniqueContracts = new Set();

  for (const group of room24to45) {
    const title = group.groupTitle;
    const groupFee = group.feePercent;

    if (!group.contracts || group.contracts.size === 0) {
      masterTable.push([
        title,
        `${groupFee}%`,
        "N/A",
        "N/A",
        "NO CONTRACTS",
        "N/A",
        "❌",
      ]);
      mismatches++;
      continue;
    }

    let firstRow = true;
    for (const [key, value] of group.contracts) {
      const contractAddress = value.address;
      const contractFee = value.feePercent;
      const network = value.network;

      const match = contractFee === groupFee ? "✅" : "❌";
      if (match === "✅") perfectMatches++;
      else mismatches++;

      uniqueContracts.add(contractAddress);

      if (firstRow) {
        masterTable.push([
          title,
          `${groupFee}%`,
          key,
          network,
          contractAddress,
          `${contractFee}%`,
          match,
        ]);
        firstRow = false;
      } else {
        masterTable.push([
          "",
          "",
          key,
          network,
          contractAddress,
          `${contractFee}%`,
          match,
        ]);
      }
    }
  }

  console.log(masterTable.toString());

  // Summary
  console.log("\n" + "=".repeat(120));
  console.log("SUMMARY");
  console.log("=".repeat(120));
  console.log(`Total Contracts Checked: ${perfectMatches + mismatches}`);
  console.log(`Perfect Matches (✅): ${perfectMatches}`);
  console.log(`Mismatches (❌): ${mismatches}`);
  console.log(`Unique Contract Addresses Used: ${uniqueContracts.size}`);

  if (mismatches === 0) {
    console.log("\n🎉 ALL CONTRACTS PERFECTLY ALIGNED!");
  } else {
    console.log("\n⚠️  Some contracts don't match group fees");
  }

  await mongoose.disconnect();
}

simpleContractReport().catch(console.error);
