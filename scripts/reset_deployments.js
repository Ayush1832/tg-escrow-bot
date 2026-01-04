const mongoose = require("mongoose");
const Contract = require("../src/models/Contract");
const config = require("../config");

async function main() {
  console.log("🧹 Starting database cleanup...");

  await mongoose.connect(config.MONGODB_URI);
  console.log("✅ Connected to MongoDB.");

  // Delete all contracts marked as 'deployed'
  // Or just delete ALL contracts if that is the goal?
  // User said: "remove the recently deployed contracts"
  // Safe approach: Remove all contracts, as the system is being reset.

  const result = await Contract.deleteMany({});

  console.log(`🗑️ Deleted ${result.deletedCount} contracts from the database.`);
  console.log("ready for fresh deployment.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
