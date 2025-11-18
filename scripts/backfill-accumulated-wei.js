/* eslint-disable no-console */
const mongoose = require('mongoose');
const { ethers } = require('ethers');
require('dotenv').config();

const Escrow = require('../src/models/Escrow');
const BlockchainService = require('../src/services/BlockchainService');

async function main() {
  try {
    const { MONGODB_URI } = process.env;

    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI is not set in environment variables');
    }

    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const escrowsNeedingBackfill = await Escrow.find({
      $and: [
        {
          $or: [
            { accumulatedDepositAmount: { $gt: 0 } },
            { depositAmount: { $gt: 0 } },
            { confirmedAmount: { $gt: 0 } }
          ]
        },
        {
          $or: [
            { accumulatedDepositAmountWei: { $exists: false } },
            { accumulatedDepositAmountWei: { $eq: null } },
            { accumulatedDepositAmountWei: { $eq: '' } },
            { accumulatedDepositAmountWei: { $eq: '0' } },
            { accumulatedDepositAmountWei: { $eq: 0 } }
          ]
        }
      ]
    }).lean();

    if (!escrowsNeedingBackfill.length) {
      console.log('✅ No escrows need backfilling. All good!');
      await mongoose.disconnect();
      return;
    }

    console.log(`ℹ️ Found ${escrowsNeedingBackfill.length} escrow(s) that need accumulatedDepositAmountWei backfilled.`);

    let successCount = 0;
    let skipCount = 0;

    for (const escrow of escrowsNeedingBackfill) {
      try {
        const {
          escrowId,
          token,
          chain,
          accumulatedDepositAmount,
          depositAmount,
          confirmedAmount
        } = escrow;

        const baseAmount =
          Number(accumulatedDepositAmount || 0) ||
          Number(depositAmount || 0) ||
          Number(confirmedAmount || 0);

        if (!baseAmount || baseAmount <= 0) {
          console.log(`⚠️ Escrow ${escrowId}: No positive amount found, skipping.`);
          skipCount += 1;
          continue;
        }

        const decimals = BlockchainService.getTokenDecimals(token, chain);
        const amountWei = ethers.parseUnits(baseAmount.toString(), decimals);

        await Escrow.updateOne(
          { _id: escrow._id },
          {
            $set: {
              accumulatedDepositAmountWei: amountWei.toString()
            }
          }
        );

        console.log(`✅ Escrow ${escrowId}: Backfilled ${baseAmount} ${token} (${amountWei.toString()} wei).`);
        successCount += 1;
      } catch (escrowError) {
        console.error(`❌ Failed to backfill escrow ${escrow.escrowId}:`, escrowError.message);
        skipCount += 1;
      }
    }

    console.log(`\n🎯 Backfill complete! Updated ${successCount} escrow(s), skipped ${skipCount}.`);

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Backfill script failed:', error);
    process.exit(1);
  }
}

main();

