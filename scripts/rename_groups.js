const mongoose = require("mongoose");
const GroupPool = require("../src/models/GroupPool");
const config = require("../config");

async function main() {
  console.log("Starting group renaming (Room 24 - 43)...");

  await mongoose.connect(config.MONGODB_URI);
  console.log("Connected to MongoDB.");

  // Fetch all available groups sorted by creation (or whatever stable order)
  const allGroups = await GroupPool.find({}).sort({ createdAt: 1 });

  console.log(`Found ${allGroups.length} total groups.`);

  // Define the range of "correct" titles we already have
  const existingPattern = /^Room (4|5|6|7|8|9|1[0-9]|2[0-3])$/; // Matches "Room 4" to "Room 23"

  // Filter groups that need renaming
  // These are groups that DO NOT match the existing correct pattern
  const groupsToRename = allGroups.filter(
    (g) => !existingPattern.test(g.groupTitle)
  );

  console.log(`Found ${groupsToRename.length} groups to rename.`);

  let nextRoomNumber = 24;
  const maxRoomNumber = 43;

  for (const group of groupsToRename) {
    if (nextRoomNumber > maxRoomNumber) {
      console.warn(
        "⚠️ Reached Room 43 limit. Remaining groups entered pool without 'Room X' title."
      );
      break;
    }

    const newTitle = `Room ${nextRoomNumber}`;
    const oldTitle = group.groupTitle || "(No Title)";

    group.groupTitle = newTitle;
    await group.save();

    console.log(`✅ Renamed [${group.groupId}] "${oldTitle}" -> "${newTitle}"`);
    nextRoomNumber++;
  }

  console.log("\n🎉 Renaming complete.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
