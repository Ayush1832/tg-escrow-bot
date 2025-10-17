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
      status: { $in: ['draft', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
    });

    if (!escrow) {
      return ctx.reply('❌ No active escrow found in this group. Please use /escrow to create one first.');
    }

    if (escrow.status !== 'draft') {
      return ctx.reply('⚠️ Deal details have already been set for this escrow.');
    }

    const dealText = `
Hello there,
Kindly tell deal details i.e.

Remember without it disputes wouldn't be resolved. Once filled proceed with Specifications of the seller or buyer with /seller or /buyer [CRYPTO ADDRESS]
    `;

    const templateText = `Quantity -
Rate -`;

    await ctx.reply(dealText, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Quantity -\nRate -', copy_text: { text: templateText } }
          ]
        ]
      }
    });

    // Set status to awaiting details and capture mode
    escrow.status = 'awaiting_details';
    await escrow.save();

    // Log event
    await new Event({
      escrowId: escrow.escrowId,
      actorId: userId,
      action: 'deal_details_requested',
      payload: {}
    }).save();

  } catch (error) {
    console.error('Error in deal details handler:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
};
