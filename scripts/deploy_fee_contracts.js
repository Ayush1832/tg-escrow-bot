const { ethers } = require("hardhat");
const Contract = require("../src/models/Contract");
const mongoose = require("mongoose");
const config = require("../config");

// Deployment Configuration
const DEPLOYMENTS = [
  {
    symbol: "USDT",
    address: config.USDT_BSC,
    configs: [
      // 15 contracts for 0.25% groups
      ...Array(15).fill({ fee: 0.25 }),
      // 3 contracts for 0.50% groups
      ...Array(3).fill({ fee: 0.5 }),
      // 2 contracts for 0.75% groups
      ...Array(2).fill({ fee: 0.75 }),
    ],
  },
  {
    symbol: "USDC",
    address: config.USDC_BSC || "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    configs: [
      // 4 contracts for 0.25% groups (1 contract per ~4 groups)
      ...Array(4).fill({ fee: 0.25 }),
      // 1 contract for 0.50% groups
      ...Array(1).fill({ fee: 0.5 }),
      // 1 contract for 0.75% groups
      ...Array(1).fill({ fee: 0.75 }),
    ],
  },
];

const NETWORK = "BSC";

async function main() {
  console.log("Starting deployment of fee-based contracts for USDT & USDC...");

  // Connect to MongoDB
  await mongoose.connect(config.MONGODB_URI);
  console.log("Connected to MongoDB.");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance));

  const EscrowVault = await ethers.getContractFactory("EscrowVault");

  for (const deployment of DEPLOYMENTS) {
    const { symbol, address: tokenAddress, configs } = deployment;

    if (!tokenAddress) {
      console.error(`❌ Missing token address for ${symbol}. Skipping.`);
      continue;
    }

    console.log(
      `\n=== Deploying ${configs.length} contracts for ${symbol} ===`
    );

    for (let i = 0; i < configs.length; i++) {
      const { fee } = configs[i];
      const feeBps = Math.floor(fee * 100);

      console.log(
        `[${symbol} ${i + 1}/${
          configs.length
        }] Deploying vault on ${NETWORK} with ${fee}% fee...`
      );

      try {
        const vault = await EscrowVault.deploy(
          tokenAddress,
          config.FEE_WALLET_BSC,
          feeBps
        );

        await vault.waitForDeployment();
        const vaultAddress = await vault.getAddress();

        console.log(`✅ Deployed at: ${vaultAddress}`);

        // Save to database
        const newContract = new Contract({
          name: "EscrowVault",
          token: symbol,
          network: NETWORK,
          address: vaultAddress,
          feePercent: fee,
        });

        await newContract.save();
        console.log(`💾 Saved to DB.`);

        // Optional: Wait slightly to avoid rate limiting
        await new Promise((r) => setTimeout(r, 2000));
      } catch (error) {
        console.error(
          `❌ Failed to deploy ${symbol} contract ${i + 1}:`,
          error.message
        );
      }
    }
  }

  console.log("\nAll deployments complete.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
