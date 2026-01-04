const { ethers } = require("hardhat");
const Contract = require("../src/models/Contract");
const mongoose = require("mongoose");
const config = require("../config");

async function main() {
  console.log("Starting fee wallet update for all live contracts...");

  if (!config.FEE_WALLET) {
    throw new Error("❌ config.FEE_WALLET is not set!");
  }

  // Connect to MongoDB
  await mongoose.connect(config.MONGODB_URI);
  console.log("✅ Connected to MongoDB.");

  const [signer] = await ethers.getSigners();
  console.log("Using account:", signer.address);

  // Fetch all deployed contracts
  const contracts = await Contract.find({ status: "deployed", network: "BSC" });
  console.log(`Found ${contracts.length} deployed BSC contracts.`);

  const EscrowVault = await ethers.getContractFactory("EscrowVault");

  for (let i = 0; i < contracts.length; i++) {
    const contractDoc = contracts[i];
    console.log(
      `\n[${i + 1}/${contracts.length}] Updating ${
        contractDoc.token
      } contract at ${contractDoc.address}...`
    );

    try {
      const vault = EscrowVault.attach(contractDoc.address);
      const tx = await vault.setFeeWallets(
        config.FEE_WALLET,
        config.FEE_WALLET
      );

      console.log(`⏳ Tx sent: ${tx.hash}`);
      await tx.wait();

      console.log(`✅ Updated successfully!`);

      // Verification (Optional)
      const w1 = await vault.feeWallet1();
      const w2 = await vault.feeWallet2();
      console.log(`   New Wallet 1: ${w1}`);
      console.log(`   New Wallet 2: ${w2}`);
    } catch (error) {
      console.error(
        `❌ Failed to update contract ${contractDoc.address}:`,
        error.message
      );
    }
  }

  console.log("\n🎉 All updates complete.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
