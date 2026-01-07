const TronWeb = require("tronweb");
const config = require("../config");
const Contract = require("../src/models/Contract");
const mongoose = require("mongoose");

async function checkTronWithdrawMethod() {
  console.log("🔍 Checking TRON Contract Withdraw Method...\n");

  await mongoose.connect(config.MONGODB_URI);

  // Get all TRON contracts
  const contracts = await Contract.find({
    network: "TRON",
    status: "deployed",
  });

  console.log(`Found ${contracts.length} TRON contracts\n`);

  // Initialize TronWeb
  const tronWeb = new TronWeb({
    fullHost: config.TRON_RPC_URL || "https://api.trongrid.io",
    privateKey: config.TRON_PRIVATE_KEY,
  });

  const usdtAddress = config.USDT_TRON;
  const targetWallet = config.FEE_WALLET_TRC;

  console.log(`USDT Address: ${usdtAddress}`);
  console.log(`Target Wallet: ${targetWallet}`);
  console.log(
    `Deployer Address: ${tronWeb.address.fromPrivateKey(
      config.TRON_PRIVATE_KEY
    )}\n`
  );

  for (const contractDoc of contracts) {
    console.log("=".repeat(80));
    console.log(`Contract: ${contractDoc.address}`);
    console.log(`Token: ${contractDoc.token}`);
    console.log(`Fee: ${contractDoc.feePercent}%`);

    try {
      // Get contract instance
      const contract = await tronWeb.contract().at(contractDoc.address);

      // Check balance
      try {
        const balance = await contract.getBalance(usdtAddress).call();
        const balanceDecimal = Number(balance) / 1e6;
        console.log(`Balance: ${balanceDecimal} USDT`);

        if (balanceDecimal === 0) {
          console.log("⏭️  Skipping (no balance)\n");
          continue;
        }
      } catch (e) {
        console.log(`Error getting balance: ${e.message}`);
      }

      // Check if withdrawToken exists
      console.log("\nChecking withdrawToken method...");

      try {
        // Try to call withdrawToken
        console.log(
          `Attempting: withdrawToken(${usdtAddress}, ${targetWallet})`
        );

        const tx = await contract
          .withdrawToken(usdtAddress, targetWallet)
          .send({
            feeLimit: 100_000_000,
            callValue: 0,
          });

        console.log(`✅ Transaction sent: ${tx}`);

        // Wait a bit and check status
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const txInfo = await tronWeb.trx.getTransaction(tx);
        console.log(`Transaction Info:`, JSON.stringify(txInfo, null, 2));
      } catch (error) {
        console.log(`❌ Error calling withdrawToken:`);
        console.log(`   Message: ${error.message}`);
        if (error.error) {
          console.log(`   Error details: ${error.error}`);
        }

        // Check if method exists
        const methods = Object.keys(contract).filter(
          (k) => typeof contract[k] === "function"
        );
        console.log(
          `\nAvailable methods:`,
          methods.filter((m) => !m.startsWith("_"))
        );
      }

      console.log("");
    } catch (error) {
      console.log(`❌ Error with contract: ${error.message}\n`);
    }
  }

  await mongoose.disconnect();
}

checkTronWithdrawMethod().catch(console.error);
