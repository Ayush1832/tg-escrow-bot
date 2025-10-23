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
    escrow.disputeRaisedAt = new Date();
    escrow.disputeRaisedBy = userId;
    escrow.disputeResolution = 'pending';
    await escrow.save();

    const disputeText = `
🚨 *DISPUTE RAISED* 🚨

Escrow ID: ${escrow.escrowId}
Raised by: @${ctx.from.username}
Time: ${new Date().toLocaleString()}

An administrator will join this group within 24 hours to resolve the dispute.

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

    // Send notification to admin
    await sendAdminDisputeNotification(ctx, escrow);

  } catch (error) {
    console.error('Error in dispute handler:', error);
    ctx.reply('❌ An error occurred while raising dispute. Please try again.');
  }
};

async function sendAdminDisputeNotification(ctx, escrow) {
  try {
    const adminIds = config.getAllAdminIds();
    
    if (adminIds.length === 0) {
      return;
    }

    // Create invite link for the group
    let inviteLink;
    try {
      const chatInviteLink = await ctx.telegram.createChatInviteLink(escrow.groupId, {
        member_limit: 1
      });
      inviteLink = chatInviteLink.invite_link;
    } catch (linkError) {
      console.error('Error creating invite link:', linkError);
      inviteLink = `Group ID: ${escrow.groupId}`;
    }

    const adminMessage = `
🚨 *NEW DISPUTE ALERT* 🚨

📋 *Escrow Details:*
• Escrow ID: \`${escrow.escrowId}\`
• Token: ${escrow.token} on ${escrow.chain}
• Amount: ${escrow.confirmedAmount || escrow.depositAmount} ${escrow.token}
• Status: ${escrow.status}

👥 *Parties:*
• Buyer: @${escrow.buyerUsername || 'N/A'} (${escrow.buyerId})
• Seller: @${escrow.sellerUsername || 'N/A'} (${escrow.sellerId})

⚖️ *Dispute Info:*
• Raised by: @${ctx.from.username || 'Unknown'}
• Reason: ${escrow.disputeReason}
• Time: ${new Date().toLocaleString()}

🔗 *Join Group:* [Click here to join the disputed group](${inviteLink})

⚡ *Quick Actions:*
• \`/admin_resolve_release ${escrow.escrowId}\` - Release to buyer
• \`/admin_resolve_refund ${escrow.escrowId}\` - Refund to seller
• \`/admin_disputes\` - View all disputes
    `;

    // Send notification to all admins
    for (const adminId of adminIds) {
      try {
        await ctx.telegram.sendMessage(adminId, adminMessage, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      } catch (error) {
        console.error(`Error sending dispute notification to admin ${adminId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error sending admin notification:', error);
  }
}

module.exports.sendAdminDisputeNotification = sendAdminDisputeNotification;
