const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const Event = require('../models/Event');

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    
    // Check if user is in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a group chat.');
    }

    // Find active escrow in this group
    const escrow = await Escrow.findOne({
      groupId: chatId.toString(),
      status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
    });

    if (!escrow) {
      return ctx.reply('❌ No active escrow found in this group. Please use /escrow to create one first.');
    }

    if (!escrow.buyerAddress || !escrow.sellerAddress) {
      return ctx.reply('❌ Please set both buyer and seller addresses first using /buyer and /seller commands.');
    }

    // For now, we only support USDT on BSC
    escrow.token = 'USDT';
    escrow.chain = 'BSC';
    escrow.status = 'awaiting_deposit';
    await escrow.save();

    const buyerTag = escrow.buyerUsername ? `@${escrow.buyerUsername}` : `[${escrow.buyerId}]`;
    const sellerTag = escrow.sellerUsername ? `@${escrow.sellerUsername}` : `[${escrow.sellerId}]`;

    const declarationText = `
📍 *ESCROW DECLARATION*

⚡️ Buyer ${buyerTag} | Userid: [${escrow.buyerId}]
⚡️ Seller ${sellerTag} | Userid: [${escrow.sellerId}]

✅ USDT CRYPTO
✅ BSC NETWORK
    `;

    await ctx.reply(declarationText, { parse_mode: 'Markdown' });

    // Get transaction information
    const transactionText = `
📍 *TRANSACTION INFORMATION [${escrow.escrowId.slice(-8)}]*

⚡️ *SELLER*
${sellerTag} | [${escrow.sellerId}]
${escrow.sellerAddress} [USDT] [BSC]

⚡️ *BUYER*
${buyerTag} | [${escrow.buyerId}]
${escrow.buyerAddress} [USDT] [BSC]

⏰ Trade Start Time: ${new Date().toLocaleString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    })}

⚠️ *IMPORTANT:* Make sure to finalise and agree each-others terms before depositing.

🗒 Please use /deposit command to generate a deposit address for your trade.
    `;

    await ctx.reply(transactionText, { parse_mode: 'Markdown' });

    // Log event
    await new Event({
      escrowId: escrow.escrowId,
      actorId: userId,
      action: 'token_network_selected',
      payload: { token: 'USDT', chain: 'BSC' }
    }).save();

  } catch (error) {
    console.error('Error in token handler:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
};
