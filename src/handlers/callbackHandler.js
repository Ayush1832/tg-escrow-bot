const { Markup } = require('telegraf');
const { ethers } = require('ethers');
const Escrow = require('../models/Escrow');
const BlockchainService = require('../services/BlockchainService');
const Event = require('../models/Event');
const config = require('../../config');

module.exports = async (ctx) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // Handle different callback types
    if (callbackData.startsWith('confirm_')) {
      const [, action, role, amount] = callbackData.split('_');
      
      // Find active escrow
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
      });

      if (!escrow) {
        return ctx.answerCbQuery('❌ No active escrow found.');
      }

      // Check if user is authorized
      if (role === 'buyer' && escrow.buyerId !== userId) {
        return ctx.answerCbQuery('❌ Only the buyer can confirm this action.');
      }
      if (role === 'seller' && escrow.sellerId !== userId) {
        return ctx.answerCbQuery('❌ Only the seller can confirm this action.');
      }

      // Update confirmation status
      if (action === 'release') {
        if (role === 'buyer') {
          escrow.buyerConfirmedRelease = true;
        } else {
          escrow.sellerConfirmedRelease = true;
        }
      } else if (action === 'refund') {
        if (role === 'buyer') {
          escrow.buyerConfirmedRefund = true;
        } else {
          escrow.sellerConfirmedRefund = true;
        }
      }

      await escrow.save();

      // Check if both parties confirmed
      const bothConfirmed = (action === 'release' && escrow.buyerConfirmedRelease && escrow.sellerConfirmedRelease) ||
                           (action === 'refund' && escrow.buyerConfirmedRefund && escrow.sellerConfirmedRefund);

      if (bothConfirmed) {
        // Execute the transaction
        const amount = parseFloat(amount);
        const escrowFee = (amount * config.ESCROW_FEE_PERCENT) / 100;
        const networkFee = 0.1;
        const netAmount = amount - networkFee;

        const targetAddress = action === 'release' ? escrow.buyerAddress : escrow.sellerAddress;
        try {
          if (action === 'release') {
            await BlockchainService.release(targetAddress, amount);
          } else {
            await BlockchainService.refund(targetAddress, amount);
          }
          
          // Update escrow status
          escrow.status = action === 'release' ? 'completed' : 'refunded';
          await escrow.save();

          const successText = `
${netAmount.toFixed(5)} USDT [$${netAmount.toFixed(2)}] 💸 + NETWORK FEE has been ${action === 'release' ? 'released' : 'refunded'} to the ${action === 'release' ? 'Buyer' : 'Seller'}'s address! 🚀

Approved By: @${ctx.from.username} | [${userId}]
Thank you for using @Easy_Escrow_Bot 🙌

@${ctx.from.username}, if you liked the bot please leave a good review about the bot and use command /vouch in reply to the review, and please also mention @Easy_Escrow_Bot in your vouch.
          `;

          await ctx.reply(successText);
        } catch (error) {
          console.error('Error executing transaction:', error);
          await ctx.reply('❌ Error executing transaction. Please try again or contact support.');
        }
      } else {
        const waitingText = `${action === 'release' ? 'Release' : 'Refund'} confirmation received. Waiting for the other party to confirm.`;
        await ctx.reply(waitingText);
      }

      await ctx.answerCbQuery('✅ Confirmation recorded');
    } else if (callbackData.startsWith('reject_')) {
      await ctx.answerCbQuery('❌ Transaction rejected');
      await ctx.reply('❌ Transaction has been rejected by one of the parties.');
    }

  } catch (error) {
    console.error('Error in callback handler:', error);
    await ctx.answerCbQuery('❌ An error occurred');
  }
};
