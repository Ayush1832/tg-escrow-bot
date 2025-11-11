const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const BlockchainService = require('../services/BlockchainService');
const config = require('../../config');

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const command = ctx.message.text.split(' ')[0].substring(1); // /release or /refund
    const amountText = ctx.message.text.split(' ').slice(1).join(' ');
    
    // Check if user is in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a group chat.');
    }

    // Find active escrow in this group
    const escrow = await Escrow.findOne({
      groupId: chatId.toString(),
      status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
    });

    if (!escrow) {
      return ctx.reply('❌ No active escrow found in this group.');
    }

    if (escrow.status !== 'deposited' && escrow.status !== 'in_fiat_transfer' && escrow.status !== 'ready_to_release') {
      return ctx.reply('❌ Escrow is not ready for release/refund.');
    }

    if (escrow.confirmedAmount <= 0) {
      return ctx.reply('❌ No confirmed deposit found.');
    }

    // Parse amount
    let amount;
    if (amountText.toLowerCase() === 'all') {
      amount = escrow.confirmedAmount;
    } else {
      amount = parseFloat(amountText);
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('❌ Please provide a valid amount. Usage: /release <amount> or /release all');
      }
      if (amount > escrow.confirmedAmount) {
        return ctx.reply('❌ Amount exceeds available balance.');
      }
    }

    // Calculate fees
    const escrowFee = (amount * config.ESCROW_FEE_PERCENT) / 100;
    // Network fee is paid in BNB by operator wallet; vault takes only escrow fee
    const networkFee = 0.1; // Fixed network fee (paid separately in BNB)
    const totalFees = escrowFee;
    const netAmount = amount - totalFees;

    if (netAmount <= 0) {
      return ctx.reply('❌ Amount is too small after fees.');
    }

    // For refunds, seller address is required but no longer set via /seller command
    // Refunds are handled by admin only or should extract from deposit transaction
    if (command === 'refund') {
      return ctx.reply('❌ Refund functionality requires seller address. Please contact admin for refunds or use admin commands.');
    }

    const targetAddress = escrow.buyerAddress;
    const targetUser = 'Buyer';

    if (!targetAddress) {
      return ctx.reply('❌ Buyer address is not set. Please set buyer address using /buyer command.');
    }

    const confirmationText = `
‼️ *Release Confirmation* ‼️

🔒 Paying To: ${targetUser}[@${ctx.from.username || 'N/A'}]
💰 Amount: ${amount.toFixed(2)} ${escrow.token}[$${amount.toFixed(2)}]
🌐 Network Fee: ${networkFee.toFixed(5)}[$${networkFee.toFixed(2)}]
💷 Escrow Fee: ${escrowFee.toFixed(5)}[$${escrowFee.toFixed(2)}]
🤝 Ambassador Discounts: 0.00000[0.00$]
🎫 Ticket Discount: 0.00000[0.00$]

📬 Address: ${targetAddress}
🪙 Token: ${escrow.token}
🌐 Network: ${escrow.chain}

(Network fee will be deducted from amount)
(Escrow fee will be deducted from total balance)

Are you ready to proceed with this withdrawal? 
Both the parties kindly confirm the same and note the action is irreversible.

For help: Contact admin in the group.

✅ Buyer Confirmed: ${escrow.buyerConfirmedRelease ? 'Yes' : 'No'}
✅ Seller Confirmed: ${escrow.sellerConfirmedRelease ? 'Yes' : 'No'}
    `;

    // Only release is supported, so force command to 'release'
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Buyer Confirm', `confirm_release_buyer_${amount}`),
        Markup.button.callback('✅ Seller Confirm', `confirm_release_seller_${amount}`)
      ],
      [Markup.button.callback('❌ Reject', `reject_release_${amount}`)]
    ]);

    await ctx.reply(confirmationText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup
    });


  } catch (error) {
    console.error('Error in release handler:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
};
