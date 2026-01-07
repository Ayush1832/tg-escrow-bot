const TronWeb = require("tronweb");
const config = require("../config");

async function simpleTest() {
  console.log("🔍 Simple TRON Withdrawal Test\n");

  const tronWeb = new TronWeb({
    fullHost: "https://api.trongrid.io",
    privateKey: config.TRON_PRIVATE_KEY,
  });

  const myAddress = tronWeb.address.fromPrivateKey(config.TRON_PRIVATE_KEY);
  console.log(`My Address: ${myAddress}`);
  console.log(`Fee Wallet: ${config.FEE_WALLET_TRC}`);
  console.log(`USDT Address: ${config.USDT_TRON}\n`);

  // Test contract - use the one from the failed transaction
  const contractAddress = "TLut6E4vtz4h3icKfNsFDnewAQNyXaZtdh";

  console.log(`Testing contract: ${contractAddress}\n`);

  try {
    // Check TRX balance
    const trxBalance = await tronWeb.trx.getBalance(myAddress);
    console.log(`TRX Balance: ${trxBalance / 1e6} TRX`);

    // Get contract
    const contract = await tronWeb.contract().at(contractAddress);

    // Check if I'm the owner
    try {
      const owner = await contract.owner().call();
      console.log(`Contract Owner: ${tronWeb.address.fromHex(owner)}`);
      console.log(
        `Am I owner? ${tronWeb.address.fromHex(owner) === myAddress}`
      );
    } catch (e) {
      console.log(`Could not get owner: ${e.message}`);
    }

    // Check USDT balance in contract
    try {
      const balance = await contract.getBalance(config.USDT_TRON).call();
      console.log(`Contract USDT Balance: ${Number(balance) / 1e6} USDT\n`);
    } catch (e) {
      console.log(`Error getting balance: ${e.message}\n`);
    }

    // Try to withdraw
    console.log(`Attempting withdrawal to ${config.FEE_WALLET_TRC}...`);

    const tx = await contract
      .withdrawToken(config.USDT_TRON, config.FEE_WALLET_TRC)
      .send({
        feeLimit: 150_000_000, // Increased fee limit
        callValue: 0,
      });

    console.log(`✅ Transaction Hash: ${tx}`);
    console.log(`View: https://tronscan.org/#/transaction/${tx}`);

    // Wait and check result
    console.log(`\nWaiting 5 seconds for confirmation...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const txInfo = await tronWeb.trx.getTransactionInfo(tx);
    console.log(`\nTransaction Result:`);
    console.log(`  Receipt: ${JSON.stringify(txInfo.receipt, null, 2)}`);

    if (txInfo.receipt && txInfo.receipt.result === "SUCCESS") {
      console.log(`\n✅ Transaction succeeded!`);
    } else {
      console.log(`\n❌ Transaction failed!`);
      console.log(`Full info:`, JSON.stringify(txInfo, null, 2));
    }
  } catch (error) {
    console.error(`\n❌ Error:`, error.message);
    if (error.error) {
      console.error(`Error details:`, error.error);
    }
  }
}

simpleTest().catch(console.error);
