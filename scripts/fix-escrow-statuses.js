// Database cleanup script to fix invalid escrow statuses
// Run this with: node scripts/fix-escrow-statuses.js

require("dotenv").config();
const mongoose = require("mongoose");
const Escrow = require("../src/models/Escrow");

const VALID_STATUSES = [
  "draft",
  "awaiting_details",
  "awaiting_deposit",
  "deposited",
  "in_fiat_transfer",
  "ready_to_release",
  "completed",
  "refunded",
  "disputed",
  "cancelled",
];

async function fixEscrowStatuses() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected successfully");

    // Find all escrows
    const allEscrows = await Escrow.find({}).lean();
    console.log(`Found ${allEscrows.length} total escrows`);

    let fixedCount = 0;
    let invalidCount = 0;

    for (const escrow of allEscrows) {
      if (!VALID_STATUSES.includes(escrow.status)) {
        console.log(
          `Invalid status found: "${escrow.status}" for escrow ${escrow.escrowId}`
        );
        invalidCount++;

        // Try to update using updateOne to bypass validation temporarily
        try {
          await mongoose.connection
            .collection("escrows")
            .updateOne({ _id: escrow._id }, { $set: { status: "cancelled" } });
          console.log(`  ✓ Fixed: Set to 'cancelled'`);
          fixedCount++;
        } catch (err) {
          console.error(`  ✗ Error fixing: ${err.message}`);
        }
      }
    }

    console.log(`\nSummary:`);
    console.log(`- Total escrows: ${allEscrows.length}`);
    console.log(`- Invalid statuses found: ${invalidCount}`);
    console.log(`- Successfully fixed: ${fixedCount}`);

    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

fixEscrowStatuses();
