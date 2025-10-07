const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const Event = require('../models/Event');

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const command = ctx.message.text.split(' ')[0].substring(1); // /seller or /buyer
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
      status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
    });

    if (!escrow) {
      return ctx.reply('❌ No active escrow found in this group. Please use /escrow to create one first.');
    }

    const isBuyer = command === 'buyer';
    const isSeller = command === 'seller';

    if (isBuyer) {
      if (escrow.buyerId !== userId) {
        return ctx.reply('❌ Only the buyer can set the buyer address.');
      }
      escrow.buyerAddress = address;
    } else if (isSeller) {
      if (escrow.sellerId !== userId) {
        return ctx.reply('❌ Only the seller can set the seller address.');
      }
      escrow.sellerAddress = address;
    }

    await escrow.save();

    const roleText = `
📍 *ESCROW-ROLE DECLARATION*

⚡️ ${isBuyer ? 'BUYER' : 'SELLER'} @${ctx.from.username} | Userid: [${userId}]

✅ ${isBuyer ? 'BUYER' : 'SELLER'} WALLET

Note: If you don't see any address, then your address will used from saved addresses after selecting token and chain for the current escrow.
    `;

    await ctx.reply(roleText, { parse_mode: 'Markdown' });

    // Log event
    await new Event({
      escrowId: escrow.escrowId,
      actorId: userId,
      action: `${command}_address_set`,
      payload: { address }
    }).save();

    // Check if both addresses are set
    if (escrow.buyerAddress && escrow.sellerAddress) {
      await ctx.reply('✅ Both buyer and seller addresses have been set. Use /token to choose crypto.');
    }

  } catch (error) {
    console.error('Error in role handler:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
};
