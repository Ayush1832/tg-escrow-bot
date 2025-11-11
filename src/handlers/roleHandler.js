const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const tokenHandler = require('./tokenHandler');

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    // Normalize command: handle /buyer and /buyer@botname
    const rawCmd = ctx.message.text.split(' ')[0].substring(1);
    const command = rawCmd.split('@')[0]; // base command without @bot
    const address = ctx.message.text.split(' ').slice(1).join(' ');
    
    // Check if user is in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a group chat.');
    }

    if (!address) {
      return ctx.reply(`❌ Please provide an address. Usage: /${command} <address>`);
    }

    // Basic address validation
    if (!address.startsWith('0x') || address.length !== 42) {
      return ctx.reply('❌ Invalid address format. Please provide a valid BSC address.');
    }

    // Find active escrow in this group
    const escrow = await Escrow.findOne({
      groupId: chatId.toString(),
      status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'] }
    });

    if (!escrow) {
      return ctx.reply('❌ No active escrow found in this group. Please use /escrow to create one first.');
    }

    const isBuyer = command === 'buyer';

    if (isBuyer) {
      // Assign buyer role if unassigned; otherwise enforce the assigned user
      if (!escrow.buyerId) {
        escrow.buyerId = userId;
        escrow.buyerUsername = ctx.from.username;
      } else if (escrow.buyerId !== userId) {
        return ctx.reply('❌ Buyer role is already taken by another user. Only the buyer can send this command.');
      }
      escrow.buyerAddress = address;
    } else {
      return ctx.reply('❌ Only /buyer command is supported. Seller address is not required.');
    }

    await escrow.save();

    const roleText = `
📍 *ESCROW-ROLE DECLARATION*

⚡️ BUYER @${ctx.from.username}

✅ BUYER WALLET

Note: If you don't see any address, then your address will used from saved addresses after selecting token and chain for the current escrow.
    `;

    await ctx.reply(roleText, { parse_mode: 'Markdown' });


    // Note: Token selection is handled in Step 4 of the trade details flow, not here
    if (escrow.buyerAddress) {
      await ctx.reply('✅ Buyer address has been set.');
    }

  } catch (error) {
    console.error('Error in role handler:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
};
