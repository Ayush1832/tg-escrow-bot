/* eslint-disable no-console */
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
const GroupPool = require(path.join(
  __dirname,
  "..",
  "src",
  "models",
  "GroupPool"
));

async function main() {
  const {
    MONGODB_URI,
    USDT_BSC,
    USDC_BSC,
    FEE_WALLET_1,
    FEE_WALLET_2,
    HOT_WALLET_PRIVATE_KEY,
  } = process.env;

  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");
  if (!USDT_BSC) throw new Error("USDT_BSC missing");
  if (!USDC_BSC) throw new Error("USDC_BSC missing");
  if (!FEE_WALLET_1) throw new Error("FEE_WALLET_1 missing");
  if (!HOT_WALLET_PRIVATE_KEY) {
    throw new Error(
      "HOT_WALLET_PRIVATE_KEY missing from .env file. This is required for deployment."
    );
  }

  // Verify we're deploying to BSC mainnet
  const network = await hre.ethers.provider.getNetwork();
  console.log(`\n🌐 Network: ${network.name} (Chain ID: ${network.chainId})`);

  // BSC mainnet chain ID is 56
  if (network.chainId !== 56n) {
    console.error(
      `\n❌ ERROR: This script must be run on BSC Mainnet (Chain ID: 56)`
    );
    console.error(
      `   Current network: ${network.name} (Chain ID: ${network.chainId})`
    );
    console.error(`\n   To deploy to BSC mainnet, run:`);
    console.error(
      `   npx hardhat run scripts/deploy-contracts-for-groups.js --network bsc`
    );
    process.exit(1);
  }

  console.log("🔗 Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  // Check for existing contracts to prevent duplicates
  console.log("🔍 Checking for existing contracts...");
  const existingContracts = await ContractModel.find({
    name: "EscrowVault",
    network: "BSC",
    feePercent: 0,
    groupId: { $exists: true, $ne: null },
  });

  if (existingContracts.length > 0) {
    console.error(
      `\n❌ ERROR: Found ${existingContracts.length} existing contracts with groupId assigned!`
    );
    console.error(
      "   This script should only be run once. Existing contracts:"
    );
    existingContracts.forEach((contract) => {
      console.error(
        `   • ${contract.token} for group ${contract.groupId}: ${contract.address}`
      );
    });
    console.error(
      "\n   If you want to redeploy, please remove existing contracts from the database first."
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log("✅ No existing group-specific contracts found\n");

  // Get all groups sorted by room number (Room 1-20)
  const groups = await GroupPool.find({}).sort({ createdAt: 1 }).limit(20);

  if (groups.length !== 20) {
    console.error(`❌ Expected 20 groups, found ${groups.length}`);
    console.error(
      "   Please ensure you have exactly 20 groups (Room 1-20) in the pool"
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  // Validate all groups have groupId
  const invalidGroups = groups.filter((g) => !g.groupId);
  if (invalidGroups.length > 0) {
    console.error(
      `❌ ERROR: Found ${invalidGroups.length} groups without groupId!`
    );
    invalidGroups.forEach((g) => {
      console.error(`   • ${g.groupTitle || "Unknown"}: Missing groupId`);
    });
    await mongoose.disconnect();
    process.exit(1);
  }

  // Check for duplicate groupIds
  const groupIds = groups.map((g) => g.groupId);
  const uniqueGroupIds = [...new Set(groupIds)];
  if (groupIds.length !== uniqueGroupIds.length) {
    console.error(`❌ ERROR: Found duplicate groupIds!`);
    console.error(
      `   Total groups: ${groupIds.length}, Unique groupIds: ${uniqueGroupIds.length}`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`📋 Found ${groups.length} groups in pool`);
  groups.forEach((group, index) => {
    console.log(
      `   ${index + 1}. ${group.groupTitle || group.groupId} (ID: ${
        group.groupId
      })`
    );
  });

  // Hardcoded 0% escrow fee
  const feePercent = 0;
  const w1 = FEE_WALLET_1;
  const w2 = FEE_WALLET_2 || FEE_WALLET_1;

  console.log(`\n🚀 Deploying contracts with ${feePercent}% escrow fee...`);
  console.log(`📍 Network: BSC Mainnet`);
  console.log(`💰 Fee: ${feePercent}%`);
  console.log(`📦 Total contracts to deploy: 40 (20 USDT + 20 USDC)`);
  console.log(
    `\n⚠️  WARNING: This will deploy 40 REAL contracts to BSC Mainnet!`
  );
  console.log(`   Each deployment costs gas fees.`);
  console.log(`   Press Ctrl+C to cancel, or wait 10 seconds to continue...\n`);

  await new Promise((resolve) => setTimeout(resolve, 10000));

  const EscrowVault = await hre.ethers.getContractFactory("EscrowVault");
  const deployedContracts = [];
  const errors = [];

  // Get deployer wallet (uses HOT_WALLET_PRIVATE_KEY from hardhat.config.js)
  const [deployer] = await hre.ethers.getSigners();

  // Verify the deployer address matches the private key
  const expectedAddress = new hre.ethers.Wallet(HOT_WALLET_PRIVATE_KEY).address;
  if (deployer.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    console.error(`\n❌ ERROR: Deployer address mismatch!`);
    console.error(`   Expected: ${expectedAddress}`);
    console.error(`   Got: ${deployer.address}`);
    console.error(
      `   Please check your HOT_WALLET_PRIVATE_KEY in .env and hardhat.config.js`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const balanceBNB = hre.ethers.formatEther(balance);

  console.log(`\n${"=".repeat(60)}`);
  console.log("🔐 DEPLOYER WALLET");
  console.log(`${"=".repeat(60)}`);
  console.log(`👤 Address: ${deployer.address}`);
  console.log(
    `🔑 Private Key: ${HOT_WALLET_PRIVATE_KEY.slice(
      0,
      10
    )}...${HOT_WALLET_PRIVATE_KEY.slice(-8)} (hidden)`
  );
  console.log(`💰 Balance: ${balanceBNB} BNB`);
  console.log(`${"=".repeat(60)}\n`);

  if (parseFloat(balanceBNB) < 0.1) {
    console.error(`\n❌ WARNING: Low BNB balance (${balanceBNB} BNB)`);
    console.error(
      `   You may need more BNB for gas fees (recommended: at least 0.5 BNB)`
    );
    console.error(
      `   Each contract deployment costs approximately 0.01-0.02 BNB`
    );
    console.error(`   For 40 contracts, you'll need approximately 0.4-0.8 BNB`);
    console.error(
      `\n   Press Ctrl+C to cancel, or wait 5 seconds to continue anyway...`
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Deploy 20 USDT contracts
  console.log(`\n${"=".repeat(60)}`);
  console.log("📦 Deploying 20 USDT Contracts");
  console.log(`${"=".repeat(60)}\n`);

  for (let i = 0; i < 20; i++) {
    const group = groups[i];
    const roomNumber = i + 1;

    try {
      // Check if contract already exists for this group/token combination
      const existingContract = await ContractModel.findOne({
        name: "EscrowVault",
        token: "USDT",
        network: "BSC",
        feePercent: feePercent,
        groupId: group.groupId,
        status: "deployed",
      });

      if (existingContract) {
        console.log(
          `\n[${roomNumber}/20] ⚠️  USDT contract already exists for ${
            group.groupTitle || group.groupId
          }`
        );
        console.log(`   Address: ${existingContract.address}`);
        console.log(`   Skipping deployment...`);
        deployedContracts.push({
          token: "USDT",
          address: existingContract.address,
          groupId: group.groupId,
          groupTitle: group.groupTitle || group.groupId,
          roomNumber,
          existing: true,
        });
        continue;
      }

      console.log(
        `\n[${roomNumber}/20] Deploying USDT contract for ${
          group.groupTitle || group.groupId
        }...`
      );
      console.log(`   Group ID: ${group.groupId}`);
      console.log(`   Token: ${USDT_BSC}`);
      console.log(`   Fee Wallets: ${w1}, ${w2 || w1}`);
      console.log(
        `   Fee Percent: ${feePercent}% (${feePercent * 100} basis points)`
      );

      // Estimate gas before deploying
      const EscrowVaultFactory = await hre.ethers.getContractFactory(
        "EscrowVault"
      );
      const deployTx = EscrowVaultFactory.getDeployTransaction(
        USDT_BSC,
        w1,
        w2,
        feePercent * 100
      );
      const gasEstimate = await hre.ethers.provider.estimateGas(deployTx);
      const gasPrice = await hre.ethers.provider.getFeeData();
      const estimatedCost =
        gasEstimate * (gasPrice.gasPrice || gasPrice.maxFeePerGas || 0n);
      const estimatedCostBNB = hre.ethers.formatEther(estimatedCost);
      console.log(`   ⛽ Estimated gas: ${gasEstimate.toString()}`);
      console.log(`   💰 Estimated cost: ${estimatedCostBNB} BNB`);

      const usdtContract = await EscrowVault.deploy(
        USDT_BSC,
        w1,
        w2,
        feePercent * 100 // Convert percentage to basis points (0% = 0)
      );

      console.log(`   ⏳ Waiting for deployment confirmation...`);
      const deployTxReceipt = await usdtContract.waitForDeployment();
      const contractAddress = await usdtContract.getAddress();

      // Verify contract is actually deployed on-chain
      const code = await hre.ethers.provider.getCode(contractAddress);
      if (code === "0x") {
        throw new Error("Contract deployment failed - no code at address");
      }

      // Verify contract parameters
      const deployedToken = await usdtContract.token();
      const deployedOwner = await usdtContract.owner();
      const deployedFeePercent = await usdtContract.feePercent();

      if (deployedToken.toLowerCase() !== USDT_BSC.toLowerCase()) {
        throw new Error(
          `Token mismatch: expected ${USDT_BSC}, got ${deployedToken}`
        );
      }
      if (deployedOwner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(
          `Owner mismatch: expected ${deployer.address}, got ${deployedOwner}`
        );
      }
      if (deployedFeePercent.toString() !== (feePercent * 100).toString()) {
        throw new Error(
          `Fee mismatch: expected ${
            feePercent * 100
          }, got ${deployedFeePercent}`
        );
      }

      console.log(`   ✅ Deployed: ${contractAddress}`);
      console.log(
        `   ✅ Verified: Token=${deployedToken}, Owner=${deployedOwner}, Fee=${deployedFeePercent}`
      );
      console.log(`   🔗 https://bscscan.com/address/${contractAddress}`);

      // Save to database with groupId (with error handling)
      try {
        await ContractModel.create({
          name: "EscrowVault",
          token: "USDT",
          network: "BSC",
          address: contractAddress,
          feePercent: feePercent,
          status: "deployed",
          groupId: group.groupId,
          deployedAt: new Date(),
        });
        console.log(
          `   💾 Saved to database (assigned to ${
            group.groupTitle || group.groupId
          })`
        );
      } catch (dbError) {
        // If database save fails, we still have a deployed contract
        console.error(
          `   ⚠️  WARNING: Contract deployed but database save failed!`
        );
        console.error(`   Address: ${contractAddress}`);
        console.error(`   Error: ${dbError.message}`);
        console.error(`   Please manually add this contract to the database.`);
        throw new Error(`Database save failed: ${dbError.message}`);
      }

      deployedContracts.push({
        token: "USDT",
        address: contractAddress,
        groupId: group.groupId,
        groupTitle: group.groupTitle || group.groupId,
        roomNumber,
      });

      // Wait 3 seconds between deployments to avoid rate limiting and allow block confirmation
      if (i < 19) {
        console.log(`   ⏳ Waiting 3 seconds before next deployment...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(
        `   ❌ Error deploying USDT contract for ${
          group.groupTitle || group.groupId
        }:`,
        error.message
      );
      if (error.stack) {
        console.error(`   Stack: ${error.stack}`);
      }
      errors.push({
        token: "USDT",
        group: group.groupTitle || group.groupId,
        groupId: group.groupId,
        error: error.message,
      });
    }
  }

  // Wait a bit before starting USDC deployments
  console.log(`\n⏳ Waiting 5 seconds before deploying USDC contracts...\n`);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Deploy 20 USDC contracts
  console.log(`\n${"=".repeat(60)}`);
  console.log("📦 Deploying 20 USDC Contracts");
  console.log(`${"=".repeat(60)}\n`);

  for (let i = 0; i < 20; i++) {
    const group = groups[i];
    const roomNumber = i + 1;

    try {
      // Check if contract already exists for this group/token combination
      const existingContract = await ContractModel.findOne({
        name: "EscrowVault",
        token: "USDC",
        network: "BSC",
        feePercent: feePercent,
        groupId: group.groupId,
        status: "deployed",
      });

      if (existingContract) {
        console.log(
          `\n[${roomNumber}/20] ⚠️  USDC contract already exists for ${
            group.groupTitle || group.groupId
          }`
        );
        console.log(`   Address: ${existingContract.address}`);
        console.log(`   Skipping deployment...`);
        deployedContracts.push({
          token: "USDC",
          address: existingContract.address,
          groupId: group.groupId,
          groupTitle: group.groupTitle || group.groupId,
          roomNumber,
          existing: true,
        });
        continue;
      }

      console.log(
        `\n[${roomNumber}/20] Deploying USDC contract for ${
          group.groupTitle || group.groupId
        }...`
      );
      console.log(`   Group ID: ${group.groupId}`);
      console.log(`   Token: ${USDC_BSC}`);
      console.log(`   Fee Wallets: ${w1}, ${w2 || w1}`);
      console.log(
        `   Fee Percent: ${feePercent}% (${feePercent * 100} basis points)`
      );

      // Estimate gas before deploying
      const EscrowVaultFactory = await hre.ethers.getContractFactory(
        "EscrowVault"
      );
      const deployTx = EscrowVaultFactory.getDeployTransaction(
        USDC_BSC,
        w1,
        w2,
        feePercent * 100
      );
      const gasEstimate = await hre.ethers.provider.estimateGas(deployTx);
      const gasPrice = await hre.ethers.provider.getFeeData();
      const estimatedCost =
        gasEstimate * (gasPrice.gasPrice || gasPrice.maxFeePerGas || 0n);
      const estimatedCostBNB = hre.ethers.formatEther(estimatedCost);
      console.log(`   ⛽ Estimated gas: ${gasEstimate.toString()}`);
      console.log(`   💰 Estimated cost: ${estimatedCostBNB} BNB`);

      const usdcContract = await EscrowVault.deploy(
        USDC_BSC,
        w1,
        w2,
        feePercent * 100 // Convert percentage to basis points (0% = 0)
      );

      console.log(`   ⏳ Waiting for deployment confirmation...`);
      await usdcContract.waitForDeployment();
      const contractAddress = await usdcContract.getAddress();

      // Verify contract is actually deployed on-chain
      const code = await hre.ethers.provider.getCode(contractAddress);
      if (code === "0x") {
        throw new Error("Contract deployment failed - no code at address");
      }

      // Verify contract parameters
      const deployedToken = await usdcContract.token();
      const deployedOwner = await usdcContract.owner();
      const deployedFeePercent = await usdcContract.feePercent();

      if (deployedToken.toLowerCase() !== USDC_BSC.toLowerCase()) {
        throw new Error(
          `Token mismatch: expected ${USDC_BSC}, got ${deployedToken}`
        );
      }
      if (deployedOwner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(
          `Owner mismatch: expected ${deployer.address}, got ${deployedOwner}`
        );
      }
      if (deployedFeePercent.toString() !== (feePercent * 100).toString()) {
        throw new Error(
          `Fee mismatch: expected ${
            feePercent * 100
          }, got ${deployedFeePercent}`
        );
      }

      console.log(`   ✅ Deployed: ${contractAddress}`);
      console.log(
        `   ✅ Verified: Token=${deployedToken}, Owner=${deployedOwner}, Fee=${deployedFeePercent}`
      );
      console.log(`   🔗 https://bscscan.com/address/${contractAddress}`);

      // Save to database with groupId (with error handling)
      try {
        await ContractModel.create({
          name: "EscrowVault",
          token: "USDC",
          network: "BSC",
          address: contractAddress,
          feePercent: feePercent,
          status: "deployed",
          groupId: group.groupId,
          deployedAt: new Date(),
        });
        console.log(
          `   💾 Saved to database (assigned to ${
            group.groupTitle || group.groupId
          })`
        );
      } catch (dbError) {
        // If database save fails, we still have a deployed contract
        console.error(
          `   ⚠️  WARNING: Contract deployed but database save failed!`
        );
        console.error(`   Address: ${contractAddress}`);
        console.error(`   Error: ${dbError.message}`);
        console.error(`   Please manually add this contract to the database.`);
        throw new Error(`Database save failed: ${dbError.message}`);
      }

      deployedContracts.push({
        token: "USDC",
        address: contractAddress,
        groupId: group.groupId,
        groupTitle: group.groupTitle || group.groupId,
        roomNumber,
      });

      // Wait 3 seconds between deployments
      if (i < 19) {
        console.log(`   ⏳ Waiting 3 seconds before next deployment...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(
        `   ❌ Error deploying USDC contract for ${
          group.groupTitle || group.groupId
        }:`,
        error.message
      );
      if (error.stack) {
        console.error(`   Stack: ${error.stack}`);
      }
      errors.push({
        token: "USDC",
        group: group.groupTitle || group.groupId,
        groupId: group.groupId,
        error: error.message,
      });
    }
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 DEPLOYMENT SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(
    `✅ Successfully deployed: ${deployedContracts.length} contracts`
  );
  console.log(`❌ Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log(`\n❌ Failed Deployments:`);
    errors.forEach((err) => {
      console.log(`   • ${err.token} for ${err.group}: ${err.error}`);
    });
  }

  // Group by room
  console.log(`\n📋 Contracts by Group:`);
  for (let i = 0; i < 20; i++) {
    const group = groups[i];
    const usdtContract = deployedContracts.find(
      (c) => c.token === "USDT" && c.roomNumber === i + 1
    );
    const usdcContract = deployedContracts.find(
      (c) => c.token === "USDC" && c.roomNumber === i + 1
    );

    console.log(`\n${group.groupTitle || group.groupId}:`);
    if (usdtContract) {
      console.log(`   ✅ USDT: ${usdtContract.address}`);
      console.log(
        `      🔗 https://bscscan.com/address/${usdtContract.address}`
      );
    } else {
      console.log(`   ❌ USDT: Failed`);
    }
    if (usdcContract) {
      console.log(`   ✅ USDC: ${usdcContract.address}`);
      console.log(
        `      🔗 https://bscscan.com/address/${usdcContract.address}`
      );
    } else {
      console.log(`   ❌ USDC: Failed`);
    }
  }

  // Final verification: Check database for all contracts
  console.log(`\n🔍 Verifying database records...`);
  const dbContracts = await ContractModel.find({
    name: "EscrowVault",
    network: "BSC",
    feePercent: 0,
    groupId: { $exists: true, $ne: null },
  });

  console.log(`   Found ${dbContracts.length} contracts in database`);

  // Verify each group has both USDT and USDC contracts
  const missingContracts = [];
  for (const group of groups) {
    const usdtContract = dbContracts.find(
      (c) => c.groupId === group.groupId && c.token === "USDT"
    );
    const usdcContract = dbContracts.find(
      (c) => c.groupId === group.groupId && c.token === "USDC"
    );

    if (!usdtContract) {
      missingContracts.push({
        group: group.groupTitle || group.groupId,
        token: "USDT",
      });
    }
    if (!usdcContract) {
      missingContracts.push({
        group: group.groupTitle || group.groupId,
        token: "USDC",
      });
    }
  }

  if (missingContracts.length > 0) {
    console.error(`\n⚠️  WARNING: Missing contracts in database:`);
    missingContracts.forEach((mc) => {
      console.error(`   • ${mc.token} for ${mc.group}`);
    });
  } else {
    console.log(
      `   ✅ All groups have both USDT and USDC contracts in database`
    );
  }

  console.log(`\n🎉 Deployment Complete!`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Verify contracts on BSCScan (links provided above)`);
  console.log(`   2. Contracts are now assigned to groups in the database`);
  console.log(`   3. Each group has 1 USDT and 1 USDC contract`);
  console.log(
    `   4. The system will automatically use group-specific contracts`
  );

  if (errors.length > 0) {
    console.log(
      `\n⚠️  IMPORTANT: Some deployments failed. Please review the errors above.`
    );
    console.log(`   You may need to manually deploy the failed contracts.`);
  }

  await mongoose.disconnect();
  console.log("\n✅ Disconnected from MongoDB");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
