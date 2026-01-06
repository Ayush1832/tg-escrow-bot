const mongoose = require("mongoose");
const Escrow = require("../src/models/Escrow");
const AddressAssignmentService = require("../src/services/AddressAssignmentService");
const config = require("../config");

// Mock for AddressAssignmentService.assignDepositAddress result
// We simulate that the service returned a specific contract address
const MOCK_CONTRACT_ADDRESS = "0x4CfC5023f174fbD0ec6Fcef5e7ab97Ea182Cec09"; // The one user used
const MOCK_DEPOSIT_ADDRESS = "0x4CfC5023f174fbD0ec6Fcef5e7ab97Ea182Cec09";

async function verifyPersistence() {
  console.log("🧪 Verifying Contract Address Persistence...");
  await mongoose.connect(config.MONGODB_URI);

  // 1. Create a dummy Escrow to simulate the bug
  const escrowId = "test_persistence_" + Date.now();
  const newEscrow = new Escrow({
    escrowId: escrowId,
    groupId: "-1003213181274", // Valid group
    buyerId: 123,
    sellerId: 456,
    status: "awaiting_details",
  });
  await newEscrow.save();
  console.log(`   📝 Created Test Escrow: ${escrowId}`);

  // 2. Simulate the Address Assignment Step (Logic from callbackHandler.js)
  // We are MANUALLY running the logic I added to callbackHandler.js to verify it works as intended

  // FETCH AGAIN as logic does
  const updatedEscrow = await Escrow.findOne({ escrowId });

  // Simulate AddressAssignmentService returning data
  const addressInfo = {
    address: MOCK_DEPOSIT_ADDRESS,
    contractAddress: MOCK_CONTRACT_ADDRESS, // This is what comes from service
    sharedWithAmount: null,
  };

  // APPLY THE FIX LOGIC:
  updatedEscrow.depositAddress = addressInfo.address;
  updatedEscrow.uniqueDepositAddress = addressInfo.address;

  // THIS IS THE LINE I ADDED:
  updatedEscrow.contractAddress = addressInfo.contractAddress;

  updatedEscrow.status = "awaiting_deposit";
  await updatedEscrow.save();

  console.log("   💾 Saved Escrow with assigned address...");

  // 3. Verify it stuck
  const finalEscrow = await Escrow.findOne({ escrowId });

  if (finalEscrow.contractAddress === MOCK_CONTRACT_ADDRESS) {
    console.log(
      `   ✅ SUCCESS: Contract Address Saved! Value: ${finalEscrow.contractAddress}`
    );
  } else {
    console.log(
      `   ❌ FAILURE: Contract Address NOT Saved. Value: ${finalEscrow.contractAddress}`
    );
  }

  // Clean up
  await Escrow.deleteOne({ escrowId });
  await mongoose.disconnect();
}

verifyPersistence().catch(console.error);
