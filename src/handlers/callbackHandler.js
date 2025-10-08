const { Markup } = require('telegraf');
const { ethers } = require('ethers');
const Escrow = require('../models/Escrow');
const BlockchainService = require('../services/BlockchainService');
const Event = require('../models/Event');
const config = require('../../config');
const escrowHandler = require('./escrowHandler');
const DepositAddress = require('../models/DepositAddress');
const BSCService = require('../services/BSCService');

module.exports = async (ctx) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // Handle different callback types
    if (callbackData === 'start_escrow') {
      await ctx.answerCbQuery('Starting a new escrow...');
      // Trigger escrow creation flow
      return escrowHandler(ctx);
    } else if (callbackData === 'show_menu') {
      await ctx.answerCbQuery('Showing menu...');
      const menuText = `
🤖 *Easy Escrow Bot Menu*

📋 *Available Commands:*
/start - Start the bot
/escrow - Create new escrow
/dd - Set deal details
/seller [address] - Set seller address
/buyer [address] - Set buyer address
/token - Select token and network
/deposit - Get deposit address
/release [amount] - Release funds
/refund [amount] - Refund to seller
/dispute - Call administrator

💡 *Tips:*
- Use /dd to set deal details first
- Make sure both parties confirm their roles
- Always verify addresses before depositing
      `;
      return ctx.reply(menuText, { parse_mode: 'Markdown' });
    } else if (callbackData === 'check_deposit') {
      await ctx.answerCbQuery('Checking for your deposit...');
      const chatId = ctx.chat.id;
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['awaiting_deposit', 'deposited'] }
      });
      if (!escrow || !escrow.depositAddress) {
        return ctx.reply('❌ No active deposit address found.');
      }
      const activeAddr = await DepositAddress.findOne({ escrowId: escrow.escrowId, address: escrow.depositAddress, status: { $in: ['active', 'used'] } });
      if (!activeAddr) return ctx.reply('❌ Deposit address expired or missing.');

      // Fetch recent USDT txns for the vault address
      const txs = await BSCService.getUSDTTransactions(activeAddr.address);
      const sellerAddr = (escrow.sellerAddress || '').toLowerCase();
      const vaultAddr = activeAddr.address.toLowerCase();
      const totalAmount = (txs || []).reduce((sum, tx) => {
        const from = (tx.from || '').toLowerCase();
        const to = (tx.to || '').toLowerCase();
        if (to === vaultAddr && (!sellerAddr || from === sellerAddr)) {
          return sum + Number(tx.valueDecimal || 0);
        }
        return sum;
      }, 0);

      if (totalAmount > (activeAddr.observedAmount || 0)) {
        activeAddr.observedAmount = totalAmount;
        activeAddr.status = 'used';
        await activeAddr.save();
        escrow.depositAmount = totalAmount;
        escrow.confirmedAmount = totalAmount;
        escrow.status = 'deposited';
        await escrow.save();
        await ctx.reply(`✅ Deposit confirmed: ${totalAmount.toFixed(6)} USDT`);
      } else {
        await ctx.reply('❌ No new deposit found yet. Please try again in a moment.');
      }
    } else if (callbackData.startsWith('confirm_')) {
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
