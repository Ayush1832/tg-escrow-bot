const Escrow = require('../models/Escrow');

// Import timeout map from groupDealHandler to cancel timeouts when both join
// We'll use a shared module pattern to access the timeout map
let inviteTimeoutMap = null;

// Function to set the timeout map (called from groupDealHandler)
function setInviteTimeoutMap(map) {
  inviteTimeoutMap = map;
}

// Main handler function
async function joinRequestHandler(ctx) {
  try {
    const request = ctx.update?.chat_join_request;
    if (!request) return;

    const chatId = String(request.chat.id);
    const user = request.from;
    const username = (user.username || '').toLowerCase();

    // Find active escrow for this room with restricted usernames (from pool groups)
    const escrow = await Escrow.findOne({
      groupId: chatId,
      status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'] },
      allowedUsernames: { $exists: true }
    });

    if (!escrow) {
      // No restriction set — decline by default for safety
      try { await ctx.telegram.declineChatJoinRequest(chatId, user.id); } catch (_) {}
      return;
    }

    // Check if user is allowed (by username or user ID)
    const allowedUsernames = (escrow.allowedUsernames || []).map(u => (u || '').toLowerCase());
    const allowedUserIds = escrow.allowedUserIds || [];
    const idAllowed = allowedUserIds.includes(Number(user.id));
    const usernameAllowed = username && allowedUsernames.includes(username);
    
    if (!idAllowed && !usernameAllowed) {
      // Not an allowed user - decline
      try { await ctx.telegram.declineChatJoinRequest(chatId, user.id); } catch (_) {}
      return;
    }

    // Approve allowed user (bot must be admin with approve permissions)
    try {
      await ctx.telegram.approveChatJoinRequest(chatId, user.id);
    } catch (approveError) {
      console.error(`Failed to approve join request for user ${user.id} in group ${chatId}:`, approveError);
      // Don't save approval if the API call failed
      return;
    }

    // Track approvals
    const approved = new Set(escrow.approvedUserIds || []);
    approved.add(Number(user.id));
    escrow.approvedUserIds = Array.from(approved);
    await escrow.save();

    // Check if initiator (creator) is already a member (e.g., admin was present before)
    let initiatorPresent = false;
    if (escrow.creatorId) {
      try {
        const memberInfo = await ctx.telegram.getChatMember(chatId, Number(escrow.creatorId));
        initiatorPresent = ['member', 'administrator', 'creator'].includes(memberInfo.status);
      } catch (_) {
        initiatorPresent = false;
      }
    }

    // Compute how many of the two parties are in the room now
    const creatorAlreadyCounted = escrow.approvedUserIds.includes(Number(escrow.creatorId));
    let joinedCount = escrow.approvedUserIds.length + (initiatorPresent && !creatorAlreadyCounted ? 1 : 0);

    if (joinedCount < 2) {
      try {
        await ctx.telegram.sendMessage(chatId, `✅ @${user.username || 'user'} joined.`);
      } catch (msgError) {
        // User might not have joined yet, or bot can't send message
        console.error('Failed to send join progress message:', msgError);
      }
      return;
    }

    // Both approved → clean up origin invite and send started notice, then disclaimer + role selection
    // Avoid sending twice
    if (escrow.roleSelectionMessageId) {
      return;
    }

    // Cancel the 5-minute timeout since both parties have joined
    if (inviteTimeoutMap && inviteTimeoutMap.has(escrow.escrowId)) {
      const timeoutId = inviteTimeoutMap.get(escrow.escrowId);
      clearTimeout(timeoutId);
      inviteTimeoutMap.delete(escrow.escrowId);
    }

    // If we posted an invite in the origin chat, delete it and post a started message
    if (escrow.originChatId && escrow.originInviteMessageId) {
      try {
        await ctx.telegram.deleteMessage(escrow.originChatId, escrow.originInviteMessageId);
      } catch (_) {}
      try {
        const telegram = ctx.telegram;
        const originChatId = escrow.originChatId;
        const startedMsg = await telegram.sendMessage(
          originChatId,
          `✅ Trade started between @${(escrow.allowedUsernames?.[0] || 'buyer')} and @${(escrow.allowedUsernames?.[1] || 'seller')}.`
        );
        // Auto-delete this message after 5 minutes
        setTimeout(async () => {
          try {
            await telegram.deleteMessage(originChatId, startedMsg.message_id);
          } catch (_) {}
        }, 5 * 60 * 1000);
      } catch (e) {}
    }
    const disclaimer = `⚠️ P2P Deal Disclaimer ⚠️

• Always verify the **admin wallet** before sending any funds.
• Confirm **<code>pool</code>** is present in both the deal room & the main group.
• ❌ Never engage in direct or outside-room deals.
• 💬 Share all details only within this deal room.`;

    // Build initial status with waiting indicators
    const statusLines = (escrow.allowedUsernames || [])
      .map(u => (u ? `⏳ @${u} - Waiting...` : '⏳ Unknown - Waiting...'));

    try {
      const images = require('../config/images');
      await ctx.telegram.sendPhoto(chatId, images.DEAL_DISCLAIMER, {
        caption: disclaimer,
        parse_mode: 'Markdown'
      });
      const roleSelectionMsg = await ctx.telegram.sendPhoto(chatId, images.SELECT_ROLES, {
        caption: statusLines.join('\n'),
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 I am Buyer', callback_data: 'select_role_buyer' },
              { text: '💵 I am Seller', callback_data: 'select_role_seller' }
            ]
          ]
        }
      });
      // Store message ID for later editing
      escrow.roleSelectionMessageId = roleSelectionMsg.message_id;
      await escrow.save();
    } catch (msgError) {
      console.error('Failed to send disclaimer/role selection:', msgError);
      // Non-critical - users can still proceed
    }
  } catch (error) {
    console.error('joinRequestHandler error:', error);
    // Silently ignore to avoid spamming
  }
}

// Export both the handler and the setter function
module.exports = joinRequestHandler;
module.exports.setInviteTimeoutMap = setInviteTimeoutMap;
