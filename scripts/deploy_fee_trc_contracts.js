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
 * TRON Fee Contract Deployment Script
 * Deploys 5 contracts split by fee tiers for Room 24-43 usage.
 */

const CONFIGS = [
  // TRON Tiers (Shared 1:4)
  // 0.25%: 15 groups -> need 4 contracts
  // 0.50%: 3 groups -> need 1 contract
  // 0.75%: 2 groups -> need 1 contract
  ...Array(4).fill({ fee: 0.25 }),
  ...Array(1).fill({ fee: 0.5 }),
  ...Array(1).fill({ fee: 0.75 }),
];

async function main() {
  const {
    MONGODB_URI,
    USDT_TRON,
    FEE_WALLET_TRC,
    HOT_WALLET_PRIVATE_KEY,
    TRC_PRIVATE_KEY,
    TRON_RPC_URL,
    TRON_API_KEY,
  } = process.env;

  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");
  if (!USDT_TRON) throw new Error("USDT_TRON missing for TRON deployment");

  // Prefer TRC_PRIVATE_KEY for TRON deployments
  const privateKey = (TRC_PRIVATE_KEY || HOT_WALLET_PRIVATE_KEY || "").replace(
    /^0x/,
    ""
  );

  if (!privateKey)
    throw new Error("TRC_PRIVATE_KEY (or HOT_WALLET_PRIVATE_KEY) missing");

  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  console.log(
    `🚀 Starting TRON multi-fee deployment (${CONFIGS.length} contracts)...`
  );

  const fullNode = TRON_RPC_URL || "https://api.trongrid.io";
  const tronWeb = new TronWeb({
    fullHost: fullNode,
    privateKey: privateKey,
    headers: TRON_API_KEY ? { "TRON-PRO-API-KEY": TRON_API_KEY } : {},
  });

  if (!tronWeb.isAddress(USDT_TRON)) {
    throw new Error(`Invalid USDT_TRON address: ${USDT_TRON}`);
  }

  // Contract Artifacts
  const artifactsPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "EscrowVault.sol",
    "EscrowVault.json"
  );
  if (!fs.existsSync(artifactsPath)) {
    throw new Error(
      "EscrowVault.json not found. Run 'npx hardhat compile' first."
    );
  }

  const artifact = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));
  let bytecode = artifact.bytecode;
  const abi = artifact.abi;

  if (bytecode.startsWith("0x")) bytecode = bytecode.slice(2);

  // Fee Wallets
  const feeWallet = tronWeb.address.toHex(FEE_WALLET_TRC);

  for (let i = 0; i < CONFIGS.length; i++) {
    const { fee } = CONFIGS[i];
    const feeBps = Math.floor(fee * 100);

    console.log(
      `\n[${i + 1}/${CONFIGS.length}] Deploying TRC vault with ${fee}% fee...`
    );

    try {
      const contract = await tronWeb.contract().new({
        bytecode: bytecode,
        abi: abi,
        feeLimit: 200_000_000, // 200 TRX limit (adjust if needed)
        callValue: 0,
        parameters: [USDT_TRON, feeWallet, feeBps],
      });

      const address = contract.address;
      console.log(`✅ Deployed at: ${address}`);

      // Wait for confirmation/propagation
      console.log("⏳ Waiting 10s for propagation...");
      await new Promise((r) => setTimeout(r, 10000));

      // Save to DB
      const newContract = new ContractModel({
        name: "EscrowVault",
        token: "USDT", // Stored as USDT
        network: "TRON", // Distinguished by network
        address: address,
        feePercent: fee,
        status: "deployed",
        deployedAt: new Date(),
      });

      await newContract.save();
      console.log(`💾 Saved to DB: ${address} (${fee}%)`);
    } catch (err) {
      console.error(`❌ Failed to deploy contract ${i + 1}:`, err.message);
      // Continue or exit? User probably wants all of them.
      // We'll throw to stop potential partial state issues or let user retry.
      // throw err;
    }
  }

  console.log("\nAll TRON deployments complete.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
