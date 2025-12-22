const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config();

const ContractModel = require(path.join("..", "src", "models", "Contract"));
const BlockchainService = require(path.join(
  "..",
  "src",
  "services",
  "BlockchainService"
));
const config = require("../config");

async function main() {
  const { MONGODB_URI } = process.env;

  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI missing from environment");
    process.exit(1);
  }

  // Get admin wallet address from config or environment
  // Check for admin wallet in config, or use the hot wallet address
  let adminAddress = process.env.ADMIN_WALLET_ADDRESS;

  if (!adminAddress) {
    // Try to get from config or use hot wallet
    const { HOT_WALLET_PRIVATE_KEY } = process.env;
    if (HOT_WALLET_PRIVATE_KEY) {
      const { ethers } = require("ethers");
      const privateKey = HOT_WALLET_PRIVATE_KEY.startsWith("0x")
        ? HOT_WALLET_PRIVATE_KEY
        : "0x" + HOT_WALLET_PRIVATE_KEY;
      const wallet = new ethers.Wallet(privateKey);
      adminAddress = wallet.address;
      console.log("ℹ️  Using hot wallet address as admin address");
    } else {
      console.error(
        "❌ ADMIN_WALLET_ADDRESS or HOT_WALLET_PRIVATE_KEY must be set"
      );
      process.exit(1);
    }
  }

  console.log("🔌 Connecting to database...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to database\n");

  // Fetch all deployed contracts
  const contracts = await ContractModel.find({ status: "deployed" }).sort({
    network: 1,
    token: 1,
    feePercent: 1,
  });

  if (contracts.length === 0) {
    console.log("❌ No deployed contracts found");
    await mongoose.disconnect();
    return;
  }

  console.log(`📋 Found ${contracts.length} deployed contract(s)`);
  console.log(`📍 Withdrawal Address: ${adminAddress}\n`);
  console.log("=".repeat(80));
  console.log("💰 CHECKING CONTRACT BALANCES");
  console.log("=".repeat(80));
  console.log("");

  const contractsWithBalance = [];

  // Check balances for all contracts
  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    const contractAddress = contract.address;
    const token = contract.token;
    const network = contract.network;
    const feePercent = contract.feePercent || 0;

    try {
      // Get token balance for this contract
      const balance = await BlockchainService.getTokenBalance(
        token,
        network,
        contractAddress
      );

      if (balance > 0) {
        const balanceFormatted = balance.toFixed(6);
        console.log(`${i + 1}. ${token} on ${network.toUpperCase()}`);
        console.log(`   Contract: ${contractAddress}`);
        console.log(`   Fee: ${feePercent}%`);
        console.log(`   💰 Balance: ${balanceFormatted} ${token}`);
        console.log("");

        contractsWithBalance.push({
          contract,
          balance,
          balanceFormatted,
        });
      }
    } catch (error) {
      console.log(`${i + 1}. ${token} on ${network.toUpperCase()}`);
      console.log(`   Contract: ${contractAddress}`);
      console.log(`   ❌ Error checking balance: ${error.message}`);
      console.log("");
    }
  }

  if (contractsWithBalance.length === 0) {
    console.log("ℹ️  No contracts with balance found. Nothing to withdraw.");
    await mongoose.disconnect();
    return;
  }

  console.log("=".repeat(80));
  console.log(
    `📊 Found ${contractsWithBalance.length} contract(s) with balance`
  );
  console.log("=".repeat(80));
  console.log("");

  // Ask for confirmation
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const totalAmount = contractsWithBalance.reduce(
    (sum, item) => sum + item.balance,
    0
  );
  console.log(
    `⚠️  WARNING: This will withdraw all funds from ${contractsWithBalance.length} contract(s)`
  );
  console.log(`💰 Total amount to withdraw: ${totalAmount.toFixed(6)}`);
  console.log(`📍 To address: ${adminAddress}\n`);

  const answer = await new Promise((resolve) => {
    rl.question("Do you want to proceed? (yes/no): ", resolve);
  });

  rl.close();

  if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
    console.log("❌ Withdrawal cancelled by user");
    await mongoose.disconnect();
    return;
  }

  console.log("\n" + "=".repeat(80));
  console.log("🚀 STARTING WITHDRAWALS");
  console.log("=".repeat(80));
  console.log("");

  let successCount = 0;
  let failCount = 0;
  const results = [];

  // Withdraw from each contract
  for (let i = 0; i < contractsWithBalance.length; i++) {
    const { contract, balance, balanceFormatted } = contractsWithBalance[i];
    const contractAddress = contract.address;
    const token = contract.token;
    const network = contract.network;

    try {
      console.log(
        `${i + 1}/${
          contractsWithBalance.length
        }. Withdrawing from ${token} on ${network.toUpperCase()}`
      );
      console.log(`   Contract: ${contractAddress}`);
      console.log(`   Amount: ${balanceFormatted} ${token}`);

      // Withdraw full balance
      const txHash = await BlockchainService.withdrawToAdmin(
        contractAddress,
        adminAddress,
        token,
        network,
        balance
      );

      console.log(`   ✅ Success! Transaction: ${txHash}`);
      console.log("");

      successCount++;
      results.push({
        contract: contractAddress,
        token,
        network,
        amount: balance,
        txHash,
        status: "success",
      });

      // Small delay between transactions to avoid nonce issues
      if (i < contractsWithBalance.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
      console.log("");

      failCount++;
      results.push({
        contract: contractAddress,
        token,
        network,
        amount: balance,
        txHash: null,
        status: "failed",
        error: error.message,
      });
    }
  }

  // Summary
  console.log("=".repeat(80));
  console.log("📊 WITHDRAWAL SUMMARY");
  console.log("=".repeat(80));
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log("");

  if (successCount > 0) {
    console.log("✅ Successful Withdrawals:");
    results
      .filter((r) => r.status === "success")
      .forEach((result, idx) => {
        console.log(
          `   ${idx + 1}. ${result.token} on ${result.network.toUpperCase()}`
        );
        console.log(`      Contract: ${result.contract}`);
        console.log(
          `      Amount: ${result.amount.toFixed(6)} ${result.token}`
        );
        console.log(`      TX: ${result.txHash}`);
        console.log("");
      });
  }

  if (failCount > 0) {
    console.log("❌ Failed Withdrawals:");
    results
      .filter((r) => r.status === "failed")
      .forEach((result, idx) => {
        console.log(
          `   ${idx + 1}. ${result.token} on ${result.network.toUpperCase()}`
        );
        console.log(`      Contract: ${result.contract}`);
        console.log(
          `      Amount: ${result.amount.toFixed(6)} ${result.token}`
        );
        console.log(`      Error: ${result.error}`);
        console.log("");
      });
  }

  console.log("=".repeat(80));

  await mongoose.disconnect();
  console.log("\n✅ Disconnected from database");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
