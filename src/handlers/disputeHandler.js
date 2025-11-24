const Escrow = require('../models/Escrow');
const DisputeService = require('../services/DisputeService');
const config = require('../../config');

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;

    // Check if user is in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a trade group.');
    }

    // Find active escrow in this group
    const escrow = await Escrow.findOne({
      groupId: chatId.toString()
    });

    // Silently ignore if no escrow found (command should only work in trade groups)
    if (!escrow) {
      return;
    }

    // Check if user is authorized (buyer, seller, or admin)
    const isAdmin = config.getAllAdminUsernames().includes(ctx.from.username) || 
                    config.getAllAdminIds().includes(String(userId));
    
    // Safely check buyer/seller - handle null/undefined cases
    const isBuyer = escrow.buyerId != null && Number(escrow.buyerId) === Number(userId);
    const isSeller = escrow.sellerId != null && Number(escrow.sellerId) === Number(userId);

    if (!isAdmin && !isBuyer && !isSeller) {
      return ctx.reply('❌ Only the buyer, seller, or admin can report a dispute.');
    }

    // Parse reason from command (e.g., /dispute Payment not received)
    const commandText = ctx.message.text.trim();
    const parts = commandText.split(/\s+/);
    const reason = parts.slice(1).join(' ').trim();

    if (!reason) {
      return ctx.reply(
        '❌ Please provide a reason for the dispute.\n\n' +
        'Usage: <code>/dispute &lt;reason&gt;</code>\n\n' +
        'Example: <code>/dispute Payment not received from buyer</code>',
        { parse_mode: 'HTML' }
      );
    }

    // Mark escrow as disputed
    escrow.status = 'disputed';
    await escrow.save();
    
    // Send dispute notification
    const result = await DisputeService.sendDisputeNotification(
      escrow,
      reason,
      userId,
      ctx.telegram
    );

    if (result.success) {
      // Escape reason for HTML display
      const escapeHtml = (text) => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      await ctx.reply(
        '✅ <b>Dispute reported successfully!</b>\n\n' +
        'An admin will review your dispute and join this group to resolve the issue.\n\n' +
        '<b>Reason:</b> ' + escapeHtml(reason),
        { parse_mode: 'HTML' }
      );
    } else {
      // Escape error message for HTML display
      const escapeHtml = (text) => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      await ctx.reply(
        '❌ Failed to report dispute. Please contact an admin directly.\n\n' +
        'Error: ' + escapeHtml(result.error || 'Unknown error'),
        { parse_mode: 'HTML' }
      );
    }
  } catch (error) {
    console.error('Error in dispute handler:', error);
    ctx.reply('❌ An error occurred while reporting the dispute. Please try again or contact an admin.');
  }
};

