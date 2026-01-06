const mongoose = require("mongoose");
const AddressAssignmentService = require("../src/services/AddressAssignmentService");
const GroupPool = require("../src/models/GroupPool");
const config = require("../config");

async function verify() {
  console.log("🧪 Verifying Address Assignment Logic...");
  await mongoose.connect(config.MONGODB_URI);

  // Pick a group we know we fixed for TRON and BSC
  // Example from previous output: Group -1003213181274 (0.25%)
  // TRON Target: TLut6E4vtz4h3icKfNsFDnewAQNyXaZtdh
  // BSC Target: 0x4CfC5023f174fbD0ec6Fcef5e7ab97Ea182Cec09
  const TEST_GROUP_ID = "-1003213181274";
  const EXPECTED_TRON = "TLut6E4vtz4h3icKfNsFDnewAQNyXaZtdh";
  const EXPECTED_BSC = "0x4CfC5023f174fbD0ec6Fcef5e7ab97Ea182Cec09";

  const group = await GroupPool.findOne({ groupId: TEST_GROUP_ID });
  if (!group) {
    console.error("❌ Test group not found!");
    process.exit(1);
  }

  console.log(
    `\n📋 Testing Group ${TEST_GROUP_ID} (Fee: ${group.feePercent}%)`
  );

  // 1. Test TRON Assignment
  console.log("   👉 Requesting USDT on TRON...");
  try {
    const resultTron = await AddressAssignmentService.assignDepositAddress(
      "test_escrow_tron", // escrowId
      "USDT",
      "TRON",
      100,
      null,
      TEST_GROUP_ID // Passing groupId explicitly
    );

    if (resultTron.address === EXPECTED_TRON) {
      console.log(`   ✅ TRON Match! Returned: ${resultTron.address}`);
    } else {
      console.log(
        `   ❌ TRON Mismatch! Returned: ${resultTron.address} (Expected: ${EXPECTED_TRON})`
      );
    }
  } catch (e) {
    console.log(`   ❌ TRON Error: ${e.message}`);
  }

  // 2. Test BSC Assignment
  console.log("   👉 Requesting USDT on BSC...");
  try {
    const resultBsc = await AddressAssignmentService.assignDepositAddress(
      "test_escrow_bsc", // escrowId
      "USDT",
      "BSC",
      100,
      null,
      TEST_GROUP_ID // Passing groupId explicitly
    );

    if (resultBsc.address === EXPECTED_BSC) {
      console.log(`   ✅ BSC Match! Returned: ${resultBsc.address}`);
    } else {
      console.log(
        `   ❌ BSC Mismatch! Returned: ${resultBsc.address} (Expected: ${EXPECTED_BSC})`
      );
    }
  } catch (e) {
    console.log(`   ❌ BSC Error: ${e.message}`);
  }

  await mongoose.disconnect();
}

verify().catch(console.error);
