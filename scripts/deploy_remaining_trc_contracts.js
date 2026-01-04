const TronWeb = require("tronweb");
const mongoose = require("mongoose");
const Contract = require("../src/models/Contract");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

// Configuration
const CONFIGS = [
  // Skip 0.25% as user confirmed 3 are enough
  { fee: 0.5 }, // Index 4
  { fee: 0.75 }, // Index 5
];

async function main() {
  console.log("🚀 Starting deployment of REMAINING TRON fee contracts...");

  const {
    MONGODB_URI,
    USDT_TRON,
    FEE_WALLET_TRC,
    TRC_PRIVATE_KEY,
    TRON_RPC_URL,
    TRON_API_KEY,
  } = process.env;

  if (!TRC_PRIVATE_KEY || !TRON_RPC_URL) {
    throw new Error("❌ Missing TRC_PRIVATE_KEY or TRON_RPC_URL in .env");
  }

  // Initialize TronWeb
  const tronWeb = new TronWeb({
    fullNode: TRON_RPC_URL,
    solidityNode: TRON_RPC_URL,
    eventServer: TRON_RPC_URL,
    privateKey: TRC_PRIVATE_KEY,
    headers: { "TRON-PRO-API-KEY": TRON_API_KEY },
  });

  console.log(`Connected to TRON node: ${TRON_RPC_URL}`);
  console.log(
    `Deployer Address: ${tronWeb.address.fromPrivateKey(TRC_PRIVATE_KEY)}`
  );

  // Connect to MongoDB
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  // Load Artifact
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/EscrowVault.sol/EscrowVault.json"
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      "❌ Contract artifact not found. Please run 'npx hardhat compile' first."
    );
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const { abi } = artifact;
  let { bytecode } = artifact;

  // Ensure bytecode format
  if (bytecode.startsWith("0x")) bytecode = bytecode.slice(2);

  // Fee Wallets
  const feeWallet = tronWeb.address.toHex(FEE_WALLET_TRC);

  // Loop through remaining configs
  for (let i = 0; i < CONFIGS.length; i++) {
    const { fee } = CONFIGS[i];
    const feeBps = Math.floor(fee * 100);

    // Adjust display index to match original sequence (4, 5, 6)
    const originalIndex = i + 4;
    console.log(
      `\n[${originalIndex}/6] Deploying TRC vault with ${fee}% fee...`
    );

    try {
      const contract = await tronWeb.contract().new({
        abi: abi,
        bytecode: bytecode,
        feeLimit: 1000_000_000, // Increased fee limit just in case
        callValue: 0,
        parameters: [USDT_TRON, feeWallet, feeBps],
      });

      const address = contract.address;
      // Convert to hex/base58 if needed, usually tronWeb returns Base58
      const addressBase58 = tronWeb.address.fromHex(address);

      console.log(`✅ Deployed at: ${addressBase58}`);

      // Wait for propagation
      console.log("⏳ Waiting 10s for propagation...");
      await new Promise((r) => setTimeout(r, 10000));

      // Save to database
      const newContract = new Contract({
        name: "EscrowVault",
        token: "USDT",
        network: "TRON",
        address: addressBase58,
        feePercent: fee,
      });

      await newContract.save();
      console.log(`💾 Saved to DB: ${addressBase58} (${fee}%)`);

      // Add delay between deployments
      await new Promise((r) => setTimeout(r, 5000));
    } catch (error) {
      console.error(
        `❌ Failed to deploy contract ${originalIndex}:`,
        error.message || error
      );
      // Don't exit process, try next if possible, but usually resource error blocks all
      if (error.message && error.message.includes("resource")) {
        console.error("Critical resource error. Stopping.");
        process.exit(1);
      }
    }
  }

  console.log("\nAll REMAINING TRON deployments complete.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
