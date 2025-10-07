const Escrow = require('../models/Escrow');
const Event = require('../models/Event');
const config = require('../../config');

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
      return ctx.reply('❌ No active escrow found in this group.');
    }

    if (escrow.isDisputed) {
      return ctx.reply('⚠️ This escrow is already under dispute. An administrator will join within 24 hours.');
    }

    // Set escrow as disputed
    escrow.isDisputed = true;
    escrow.status = 'disputed';
    escrow.disputeReason = 'User requested dispute';
    await escrow.save();

    const disputeText = `
🚨 *DISPUTE RAISED* 🚨

Escrow ID: ${escrow.escrowId}
Raised by: @${ctx.from.username}
Time: ${new Date().toLocaleString()}

An administrator (@${config.ADMIN_USERNAME}) will join this group within 24 hours to resolve the dispute.

Please provide details about the issue and wait for admin intervention.
    `;

    await ctx.reply(disputeText, { parse_mode: 'Markdown' });

    // Log event
    await new Event({
      escrowId: escrow.escrowId,
      actorId: userId,
      action: 'dispute_raised',
      payload: { reason: 'User requested dispute' }
    }).save();

    // TODO: Send notification to admin
    // This would typically send a message to the admin's private chat

  } catch (error) {
    console.error('Error in dispute handler:', error);
    ctx.reply('❌ An error occurred while raising dispute. Please try again.');
  }
};
