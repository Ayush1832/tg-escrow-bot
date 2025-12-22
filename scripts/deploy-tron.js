const TronWeb = require("tronweb");
require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

const ContractModel = require(path.join(
  __dirname,
  "..",
  "src",
  "models",
  "Contract"
));

/**
 * TRON Deployment Script for EscrowVault Contract
 *
 * Note: This script requires:
 * 1. The EscrowVault.sol contract compiled for TRON TVM
 * 2. The bytecode from compilation (saved in artifacts)
 * 3. TRON mainnet or testnet credentials
 *
 * To compile for TRON:
 * - Use TronIDE or TronBox to compile the contract
 * - Or use Hardhat with TRON network configuration
 */
async function main() {
  const {
    MONGODB_URI,
    USDT_TRON,
    FEE_WALLET_1,
    FEE_WALLET_2,
    HOT_WALLET_PRIVATE_KEY,
    TRC_PRIVATE_KEY,
    TRON_RPC_URL,
    TRON_API_KEY,
  } = process.env;

  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");
  if (!USDT_TRON) throw new Error("USDT_TRON missing");
  if (!FEE_WALLET_1) throw new Error("FEE_WALLET_1 missing");
  if (!TRC_PRIVATE_KEY && !HOT_WALLET_PRIVATE_KEY)
    throw new Error("TRC_PRIVATE_KEY (or HOT_WALLET_PRIVATE_KEY) missing");

  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  // Hardcoded 0% escrow fee
  const feePercent = 0;
  const w1 = FEE_WALLET_1;
  const w2 = FEE_WALLET_2 || FEE_WALLET_1;

  console.log(`🚀 Deploying TRON contracts with ${feePercent}% escrow fee...`);
  console.log(`📍 Network: TRON`);
  console.log(`💰 Fee: ${feePercent}%`);

  // Initialize TronWeb
  const fullNode = TRON_RPC_URL || "https://api.trongrid.io";
  const solidityNode = TRON_RPC_URL || "https://api.trongrid.io";
  const eventServer = TRON_RPC_URL || "https://api.trongrid.io";

  // Prefer TRC_PRIVATE_KEY for TRON deployments
  const privateKey = (TRC_PRIVATE_KEY || HOT_WALLET_PRIVATE_KEY).replace(
    /^0x/,
    ""
  ); // Remove 0x if present

  const tronWeb = new TronWeb({
    fullHost: fullNode,
    privateKey: privateKey,
    headers: TRON_API_KEY ? { "TRON-PRO-API-KEY": TRON_API_KEY } : {},
  });

  // Wait for TronWeb to be ready
  if (!tronWeb.isAddress(USDT_TRON)) {
    throw new Error(`Invalid USDT_TRON address: ${USDT_TRON}`);
  }

  // Convert fee wallets to base58 if they're in hex
  const feeWallet1 = tronWeb.isAddress(w1) ? w1 : tronWeb.address.fromHex(w1);
  const feeWallet2 = tronWeb.isAddress(w2) ? w2 : tronWeb.address.fromHex(w2);

  console.log(`\n📦 Reading EscrowVault contract bytecode...`);

  // Try to read bytecode from Hardhat artifacts
  // Note: Hardhat compiles for EVM, but TRON TVM is compatible
  // You may need to compile separately for TRON or use TronIDE/TronBox
  const artifactsPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "EscrowVault.sol",
    "EscrowVault.json"
  );

  let bytecode;
  let abi;

  if (fs.existsSync(artifactsPath)) {
    try {
      const artifact = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));
      bytecode = artifact.bytecode;
      abi = artifact.abi;
      console.log("✅ Found compiled contract in artifacts");
    } catch (error) {
      console.error("❌ Error reading artifact file:", error.message);
      throw new Error(
        "Could not read contract bytecode. Please compile the contract first using Hardhat."
      );
    }
  } else {
    throw new Error(
      `Contract artifact not found at ${artifactsPath}. Please compile the contract first using: npx hardhat compile`
    );
  }

  if (!bytecode || bytecode === "0x") {
    throw new Error(
      "Contract bytecode is empty. Please compile the contract first."
    );
  }

  // Remove 0x prefix from bytecode for TRON
  const contractBytecode = bytecode.startsWith("0x")
    ? bytecode.slice(2)
    : bytecode;

  console.log(`\n📦 Deploying EscrowVault contract...`);
  console.log(`📍 USDT Token Address: ${USDT_TRON}`);
  console.log(`📍 Fee Wallet 1: ${feeWallet1}`);
  console.log(`📍 Fee Wallet 2: ${feeWallet2}`);
  console.log(
    `📍 Fee Percent: ${feePercent}% (${feePercent * 100} basis points)`
  );

  const deployedContracts = [];

  try {
    // Create contract instance for deployment
    const contract = await tronWeb.contract().new({
      bytecode: contractBytecode,
      abi: abi,
      feeLimit: 100_000_000_000, // 100 TRX in sun
      callValue: 0,
      parameters: [
        USDT_TRON, // token address
        feeWallet1, // fee wallet 1
        feeWallet2, // fee wallet 2
        feePercent * 100, // fee percent in basis points
      ],
    });

    const contractAddress = contract.address;
    console.log(`✅ EscrowVault contract deployed at: ${contractAddress}`);
    console.log(
      `🔗 View on Tronscan: https://tronscan.org/#/contract/${contractAddress}`
    );

    // Wait a moment for transaction to confirm
    console.log(`⏳ Waiting for transaction confirmation...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Drop old unique index if it exists
    try {
      await ContractModel.collection.dropIndex("name_1");
    } catch (e) {
      // Index might not exist, ignore error
    }

    await ContractModel.updateOne(
      {
        name: "EscrowVault",
        token: "USDT",
        network: "TRON",
        feePercent: feePercent,
      },
      {
        name: "EscrowVault",
        token: "USDT",
        network: "TRON",
        address: contractAddress,
        feePercent: feePercent,
        status: "deployed",
        deployedAt: new Date(),
      },
      { upsert: true }
    );
    console.log(`💾 Contract saved to database`);

    deployedContracts.push({ token: "USDT", address: contractAddress });
  } catch (error) {
    console.error(`❌ Error deploying contract:`, error);
    console.error(`Error details:`, error.message);
    if (error.message && error.message.includes("bandwidth")) {
      console.error(
        `💡 Tip: Make sure your wallet has enough bandwidth or TRX for energy.`
      );
    }
    throw error;
  }

  console.log(`\n🎉 TRON Deployment Complete!`);
  console.log(`✅ Deployed ${deployedContracts.length} contracts`);
  console.log(`💰 Fee: ${feePercent}%`);
  console.log(`\n📋 Contract Addresses:`);
  deployedContracts.forEach((contract) => {
    console.log(`  • ${contract.token}: ${contract.address}`);
    console.log(
      `    Tronscan: https://tronscan.org/#/contract/${contract.address}`
    );
  });

  await mongoose.disconnect();
  console.log("✅ Disconnected from MongoDB");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
