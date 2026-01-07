const TronWeb = require("tronweb");
const config = require("../config");
const Contract = require("../src/models/Contract");
const mongoose = require("mongoose");
const fs = require("fs");

async function checkAndFixOwnership() {
  const output = [];
  output.push("🔍 Checking TRON Contract Ownership\n");

  await mongoose.connect(config.MONGODB_URI);

  const privateKey = config.TRC_PRIVATE_KEY;
  if (!privateKey) {
    output.push("❌ TRC_PRIVATE_KEY not found in config!");
    console.log(output.join("\n"));
    process.exit(1);
  }

  const tronWeb = new TronWeb({
    fullHost: "https://api.trongrid.io",
    privateKey: privateKey,
  });

  const myAddress = tronWeb.address.fromPrivateKey(privateKey);
  output.push(`Current Wallet: ${myAddress}\n`);

  // Get all TRON contracts
  const contracts = await Contract.find({
    network: "TRON",
    status: "deployed",
  });

  output.push(`Found ${contracts.length} TRON contracts\n`);
  output.push("=".repeat(80));

  for (const contractDoc of contracts) {
    output.push(`\nContract: ${contractDoc.address}`);
    output.push(`Token: ${contractDoc.token}, Fee: ${contractDoc.feePercent}%`);

    try {
      const contract = await tronWeb.contract().at(contractDoc.address);

      // Get owner
      const ownerHex = await contract.owner().call();
      const owner = tronWeb.address.fromHex(ownerHex);

      output.push(`Owner: ${owner}`);
      output.push(`Am I owner? ${owner === myAddress ? "✅ YES" : "❌ NO"}`);

      if (owner !== myAddress) {
        output.push(`⚠️  WARNING: You are NOT the owner of this contract!`);
        output.push(
          `   Withdrawals will FAIL unless ownership is transferred.`
        );
      }

      // Check balance
      try {
        const balance = await contract.getBalance(config.USDT_TRON).call();
        const balanceDecimal = Number(balance) / 1e6;
        output.push(`Balance: ${balanceDecimal} USDT`);
      } catch (e) {
        output.push(`Could not get balance: ${e.message}`);
      }
    } catch (error) {
      output.push(`❌ Error: ${error.message}`);
    }
  }

  output.push("\n" + "=".repeat(80));
  output.push("\n📋 SUMMARY:");
  output.push("If you see 'Am I owner? ❌ NO', you need to:");
  output.push(
    "1. Use the original deployer wallet's private key in TRC_PRIVATE_KEY"
  );
  output.push(
    "2. OR transfer ownership using setOwner() from the current owner"
  );
  output.push("\nThe TRC_PRIVATE_KEY in .env must match the deployer's key.");

  const result = output.join("\n");
  console.log(result);
  fs.writeFileSync("scripts/tron_ownership_report.txt", result);
  output.push("\n✅ Report saved to scripts/tron_ownership_report.txt");

  await mongoose.disconnect();
}

checkAndFixOwnership().catch(console.error);
