const config = require('../../config');
const GroupPool = require('../models/GroupPool');
const GroupPoolService = require('./GroupPoolService');
const { formatParticipantByIndex, formatParticipantById } = require('../utils/participant');

// HTML escape helper
function escapeHtml(text = '') {
  if (typeof text !== 'string') {
    text = String(text);
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class DisputeService {
  /**
   * Send dispute notification to the dispute channel
   * @param {Object} escrow - The escrow document
   * @param {String} reason - The reason for the dispute
   * @param {Number} reportedByUserId - The user ID who reported the dispute
   * @param {Object} telegram - Telegram bot instance
   */
  static async sendDisputeNotification(escrow, reason, reportedByUserId, telegram) {
    try {
      if (!config.DISPUTE_CHANNEL_ID) {
        console.error('DISPUTE_CHANNEL_ID not configured. Cannot send dispute notification.');
        return { success: false, error: 'Dispute channel not configured' };
      }

      // Get group information
      const group = await GroupPool.findOne({ 
        $or: [
          { assignedEscrowId: escrow.escrowId },
          { groupId: escrow.groupId }
        ]
      });

      const groupTitle = escapeHtml(group?.groupTitle || 'Unknown');
      
      // Get or generate invite link
      let inviteLink = group?.inviteLink || escrow.inviteLink;
      if (!inviteLink && group && telegram) {
        try {
          // Try to generate a new invite link if one doesn't exist
          inviteLink = await GroupPoolService.generateInviteLink(
            group.groupId,
            telegram,
            { creates_join_request: true }
          );
        } catch (linkError) {
          console.error('Error generating invite link for dispute:', linkError);
          inviteLink = null; // Will be set to fallback below
        }
      }
      
      // Escape invite link for HTML display and href attribute
      const inviteLinkDisplay = inviteLink 
        ? escapeHtml(inviteLink) 
        : 'No invite link available';
      const inviteLinkHref = inviteLink 
        ? escapeHtml(inviteLink) 
        : null;

      // Get buyer and seller information
      const buyerParticipant = escrow.buyerId 
        ? { id: escrow.buyerId, username: escrow.buyerUsername }
        : null;
      const sellerParticipant = escrow.sellerId
        ? { id: escrow.sellerId, username: escrow.sellerUsername }
        : null;

      // Format buyer and seller mentions (unmasked for admins)
      const buyerText = buyerParticipant
        ? formatParticipantById(escrow, escrow.buyerId, 'Buyer', { html: true, mask: false })
        : 'Not set';
      const sellerText = sellerParticipant
        ? formatParticipantById(escrow, escrow.sellerId, 'Seller', { html: true, mask: false })
        : 'Not set';

      // Get reporter information - safely handle null/undefined buyerId/sellerId
      let reporterText = 'Unknown';
      if (escrow.buyerId != null && Number(escrow.buyerId) === Number(reportedByUserId)) {
        reporterText = 'Buyer';
      } else if (escrow.sellerId != null && Number(escrow.sellerId) === Number(reportedByUserId)) {
        reporterText = 'Seller';
      } else {
        // Check if it's an admin
        const adminIds = config.getAllAdminIds();
        if (adminIds.includes(String(reportedByUserId))) {
          reporterText = 'Admin';
        }
      }

      // Escape user-provided reason to prevent HTML injection
      const escapedReason = escapeHtml(reason || 'No reason provided');
      
      // Format the dispute message
      const disputeMessage = `🚨 <b>NEW DISPUTE REPORTED</b>

📋 <b>Escrow ID:</b> <code>${escapeHtml(escrow.escrowId || 'Unknown')}</code>
👤 <b>Reported By:</b> ${escapeHtml(reporterText)}

👥 <b>Participants:</b>
⚡️ Buyer: ${buyerText}
⚡️ Seller: ${sellerText}

📝 <b>Reason:</b>
${escapedReason}

🏷️ <b>Group Title:</b> ${groupTitle}
🔗 <b>Invite Link:</b> ${inviteLinkHref ? `<a href="${inviteLinkHref}">${inviteLinkDisplay}</a>` : inviteLinkDisplay}

💰 <b>Trade Details:</b>
• Amount: ${escapeHtml(String(escrow.quantity || 0))} ${escapeHtml(escrow.token || 'USDT')}
• Network: ${escapeHtml(escrow.chain || 'BSC')}
• Status: ${escapeHtml(escrow.status || 'Unknown')}

⏰ <b>Reported At:</b> ${escapeHtml(new Date().toLocaleString())}`;

      // Send message to dispute channel
      await telegram.sendMessage(config.DISPUTE_CHANNEL_ID, disputeMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });

      return { success: true };
    } catch (error) {
      console.error('Error sending dispute notification:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = DisputeService;

