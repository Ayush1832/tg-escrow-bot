const hre = require("hardhat");
require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");

const ContractModel = require(path.join(
  __dirname,
  "..",
  "src",
  "models",
  "Contract"
));

async function main() {
  const { MONGODB_URI, USDT_BSC, USDC_BSC, FEE_WALLET_1, FEE_WALLET_2 } =
    process.env;

  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");
  if (!USDT_BSC) throw new Error("USDT_BSC missing");
  if (!USDC_BSC) throw new Error("USDC_BSC missing");
  if (!FEE_WALLET_1) throw new Error("FEE_WALLET_1 missing");

  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  // Hardcoded 0% escrow fee
  const feePercent = 0;
  const w1 = FEE_WALLET_1;
  const w2 = FEE_WALLET_2 || FEE_WALLET_1;

  console.log(`🚀 Deploying BSC contracts with ${feePercent}% escrow fee...`);
  console.log(`📍 Network: BSC`);
  console.log(`💰 Fee: ${feePercent}%`);

  const EscrowVault = await hre.ethers.getContractFactory("EscrowVault");
  const deployedContracts = [];

  // Deploy USDT contract
  try {
    console.log(`\n📦 Deploying USDT contract...`);
    console.log(`📍 USDT Token Address: ${USDT_BSC}`);

    const usdtContract = await EscrowVault.deploy(
      USDT_BSC,
      w1,
      w2,
      feePercent * 100 // Convert percentage to basis points (0% = 0)
    );
    await usdtContract.waitForDeployment();
    const usdtAddress = await usdtContract.getAddress();
    console.log(`✅ USDT-BSC EscrowVault deployed at: ${usdtAddress}`);

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
        network: "BSC",
        feePercent: feePercent,
      },
      {
        name: "EscrowVault",
        token: "USDT",
        network: "BSC",
        address: usdtAddress,
        feePercent: feePercent,
        status: "deployed",
        deployedAt: new Date(),
      },
      { upsert: true }
    );
    console.log(`💾 USDT contract saved to database`);

    deployedContracts.push({ token: "USDT", address: usdtAddress });
  } catch (error) {
    console.error(`❌ Error deploying USDT contract:`, error);
    throw error;
  }

  // Wait 2 seconds before deploying next contract
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Deploy USDC contract
  try {
    console.log(`\n📦 Deploying USDC contract...`);
    console.log(`📍 USDC Token Address: ${USDC_BSC}`);

    const usdcContract = await EscrowVault.deploy(
      USDC_BSC,
      w1,
      w2,
      feePercent * 100 // Convert percentage to basis points (0% = 0)
    );
    await usdcContract.waitForDeployment();
    const usdcAddress = await usdcContract.getAddress();
    console.log(`✅ USDC-BSC EscrowVault deployed at: ${usdcAddress}`);

    await ContractModel.updateOne(
      {
        name: "EscrowVault",
        token: "USDC",
        network: "BSC",
        feePercent: feePercent,
      },
      {
        name: "EscrowVault",
        token: "USDC",
        network: "BSC",
        address: usdcAddress,
        feePercent: feePercent,
        status: "deployed",
        deployedAt: new Date(),
      },
      { upsert: true }
    );
    console.log(`💾 USDC contract saved to database`);

    deployedContracts.push({ token: "USDC", address: usdcAddress });
  } catch (error) {
    console.error(`❌ Error deploying USDC contract:`, error);
    throw error;
  }

  console.log(`\n🎉 BSC Deployment Complete!`);
  console.log(`✅ Deployed ${deployedContracts.length} contracts`);
  console.log(`💰 Fee: ${feePercent}%`);
  console.log(`\n📋 Contract Addresses:`);
  deployedContracts.forEach((contract) => {
    console.log(`  • ${contract.token}: ${contract.address}`);
  });

  await mongoose.disconnect();
  console.log("✅ Disconnected from MongoDB");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
