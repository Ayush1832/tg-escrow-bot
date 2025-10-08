const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const Event = require('../models/Event');

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    // Normalize command: handle /seller and /seller@botname
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
      status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
    });

    if (!escrow) {
      return ctx.reply('❌ No active escrow found in this group. Please use /escrow to create one first.');
    }

    const isBuyer = command === 'buyer';
    const isSeller = command === 'seller';

    if (isBuyer) {
      // Prevent same user from being both buyer and seller
      if (escrow.sellerId && escrow.sellerId === userId) {
        return ctx.reply('❌ You are already set as the seller. The buyer must be a different user.');
      }
      // Assign buyer role if unassigned; otherwise enforce the assigned user
      if (!escrow.buyerId) {
        escrow.buyerId = userId;
      } else if (escrow.buyerId !== userId) {
        return ctx.reply('❌ Buyer role is already taken by another user.');
      }
      escrow.buyerAddress = address;
    } else if (isSeller) {
      // Prevent same user from being both seller and buyer
      if (escrow.buyerId && escrow.buyerId === userId) {
        return ctx.reply('❌ You are already set as the buyer. The seller must be a different user.');
      }
      if (!escrow.sellerId) {
        escrow.sellerId = userId;
      } else if (escrow.sellerId !== userId) {
        return ctx.reply('❌ Seller role is already taken by another user.');
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
