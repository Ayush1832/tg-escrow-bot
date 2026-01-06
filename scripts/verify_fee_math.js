const { ethers } = require("ethers");

// Simulation variables based on user report
const quantity = 2.0;
const networkFee = 0.2;
const feeRatePercent = 0.75;
const formattedTotalDeposited = quantity;

// 1. Verify Display Logic (index.js logic)
function verifyDisplay() {
  console.log("--- Display Logic (index.js) ---");
  const amount = quantity;
  const escrowFee = ((amount - networkFee) * feeRatePercent) / 100;
  const releaseAmount = amount - networkFee - escrowFee;

  console.log(`Amount: ${amount}`);
  console.log(`Network Fee: ${networkFee}`);
  console.log(
    `Escrow Fee (${feeRatePercent}% on Net): ${escrowFee.toFixed(5)}`
  );
  console.log(`Release Amount: ${releaseAmount.toFixed(4)}`);

  // User Expectation: 1.7865
  const expected = 1.7865;
  if (Math.abs(releaseAmount - expected) < 0.0001) {
    console.log("✅ MATCHES USER EXPECTATION");
  } else {
    console.log(`❌ MISMATCH (Expected ${expected})`);
  }
}

// 2. Verify Transaction Logic (callbackHandler.js logic)
function verifyTransaction() {
  console.log("\n--- Transaction Logic (callbackHandler.js) ---");

  // Current logic in admin_release_confirm_yes_
  // releaseAmount defaults to formattedTotalDeposited (Gross)
  let releaseAmount = formattedTotalDeposited;

  // Deduct networkFee (My Fix)
  const amountToRelease = releaseAmount - networkFee; // 1.8

  console.log(`Total Deposited: ${formattedTotalDeposited}`);
  console.log(`Amount To Release (sent to contract): ${amountToRelease}`);

  // Contract Logic Simulation
  // Contract receives 1.8
  // Contract deducts 0.75% fee from 1.8
  const contractInput = amountToRelease;
  const feeTakenByContract = (contractInput * feeRatePercent) / 100;
  const recipientReceives = contractInput - feeTakenByContract;

  console.log(`Contract Input: ${contractInput}`);
  console.log(`Fee Taken (0.75%): ${feeTakenByContract.toFixed(5)}`);
  console.log(`Recipient Receives: ${recipientReceives.toFixed(4)}`);

  // User Expectation: 1.7865
  const expected = 1.7865;
  if (Math.abs(recipientReceives - expected) < 0.0001) {
    console.log("✅ MATCHES USER EXPECTATION");
  } else {
    console.log(`❌ MISMATCH (Expected ${expected})`);
  }
}

verifyDisplay();
verifyTransaction();
