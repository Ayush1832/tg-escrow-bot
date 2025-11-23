const Escrow = require('../models/Escrow');
const { getParticipants, formatParticipant, formatParticipantById } = require('../utils/participant');

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

    const participants = getParticipants(escrow);
    while (participants.length < 2) {
      participants.push({ username: null, id: null });
    }

    const normalizedUserId = Number(user.id);
    const lowercaseUsername = (user.username || '').toLowerCase();

    let participantIndex = participants.findIndex(
      p => p.id !== null && p.id === normalizedUserId
    );

    if (participantIndex === -1 && lowercaseUsername) {
      participantIndex = participants.findIndex(
        p => (p.username || '').toLowerCase() === lowercaseUsername
      );
    }

    if (participantIndex === -1) {
      try { await ctx.telegram.declineChatJoinRequest(chatId, user.id); } catch (_) {}
      return;
    }

    // Update stored participant info with latest identifiers
    participants[participantIndex].id = normalizedUserId;
    if (user.username) {
      participants[participantIndex].username = user.username;
    }

    const updatedIds = participants.map(p => {
      if (p.id === null || p.id === undefined) {
        return null;
      }
      const numeric = Number(p.id);
      return Number.isFinite(numeric) ? numeric : null;
    });
    const updatedUsernames = participants.map(p => p.username || null);

    // Prevent registering more than two distinct user IDs
    const distinctIds = new Set(updatedIds.filter(id => id !== null));
    if (!distinctIds.has(normalizedUserId) && distinctIds.size >= 2) {
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

    escrow.allowedUserIds = updatedIds;
    escrow.allowedUsernames = updatedUsernames;

    // Track approvals
    const approved = new Set(escrow.approvedUserIds || []);
    approved.add(normalizedUserId);
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
        const joinedLabel = formatParticipant({ username: user.username || null, id: normalizedUserId }, 'User', { html: true });
        await ctx.telegram.sendMessage(
          chatId,
          `✅ ${joinedLabel} joined.`,
          { parse_mode: 'HTML' }
        );

        const joinedUserIds = new Set(escrow.approvedUserIds || []);
        if (initiatorPresent && escrow.creatorId) {
          joinedUserIds.add(Number(escrow.creatorId));
        }

        let waitingParticipant = null;
        for (const participant of participants) {
          if (!participant) continue;
          if (participant.id === null || participant.id === undefined) {
            continue;
          }
          if (!joinedUserIds.has(Number(participant.id))) {
            waitingParticipant = participant;
            break;
          }
        }

        // Delete any existing waiting message
        if (escrow.waitingForUserMessageId) {
      try {
            await ctx.telegram.deleteMessage(chatId, escrow.waitingForUserMessageId);
          } catch (_) {}
        }
        
        // Send waiting message if we found the waiting user
        if (waitingParticipant) {
          const waitingLabel = formatParticipant(waitingParticipant, 'the other participant', { html: true });
          const waitingMsg = await ctx.telegram.sendMessage(
            chatId, 
            `⏳ Waiting for ${waitingLabel} to join...`,
            { parse_mode: 'HTML' }
          );
          escrow.waitingForUserMessageId = waitingMsg.message_id;
          await escrow.save();
          
          // Set timeout to reset group if second user doesn't join within 5 minutes
          // Only set timeout if this is the first user (joinedCount === 1)
          if (joinedCount === 1 && inviteTimeoutMap) {
            // Capture telegram instance for use in timeout callback
            const telegram = ctx.telegram;
            const escrowId = escrow.escrowId;
            
            // Clear any existing timeout for this escrow
            if (inviteTimeoutMap.has(escrowId)) {
              clearTimeout(inviteTimeoutMap.get(escrowId));
            }
            
            // Set new timeout starting from now (5 minutes from first user join)
            const timeoutId = setTimeout(async () => {
              try {
                // Re-fetch escrow to get latest state
                const currentEscrow = await Escrow.findOne({ escrowId });
                if (!currentEscrow) {
                  inviteTimeoutMap.delete(escrowId);
                  return;
                }

                // Check if both parties have joined (trade started)
                if (currentEscrow.roleSelectionMessageId || currentEscrow.status !== 'draft') {
                  // Trade has progressed, cancel timeout
                  inviteTimeoutMap.delete(escrowId);
                  return;
                }

                // Check if both parties have joined
                const currentApprovedCount = (currentEscrow.approvedUserIds || []).length;
                let currentInitiatorPresent = false;
                if (currentEscrow.creatorId) {
                  try {
                    const memberInfo = await telegram.getChatMember(
                      String(currentEscrow.groupId),
                      Number(currentEscrow.creatorId)
                    );
                    currentInitiatorPresent = ['member', 'administrator', 'creator'].includes(memberInfo.status);
                  } catch (_) {
                    currentInitiatorPresent = false;
                  }
                }

                const currentCreatorAlreadyCounted = currentEscrow.approvedUserIds?.includes(Number(currentEscrow.creatorId));
                const currentTotalJoined = currentApprovedCount + (currentInitiatorPresent && !currentCreatorAlreadyCounted ? 1 : 0);

                if (currentTotalJoined >= 2) {
                  // Both joined, cancel timeout
                  inviteTimeoutMap.delete(escrowId);
                  return;
                }

                // Timeout expired - reset the group
                inviteTimeoutMap.delete(escrowId);

                // Get the group
                const GroupPool = require('../models/GroupPool');
                const GroupPoolService = require('../services/GroupPoolService');
                let group = await GroupPool.findOne({ assignedEscrowId: escrowId });
                if (!group) {
                  group = await GroupPool.findOne({ groupId: currentEscrow.groupId });
                }

                if (group) {
                  // Delete waiting message
                  if (currentEscrow.waitingForUserMessageId) {
                    try {
                      await telegram.deleteMessage(String(currentEscrow.groupId), currentEscrow.waitingForUserMessageId);
                    } catch (_) {}
                  }

                  // Remove the user who joined
                  try {
                    await GroupPoolService.removeUsersFromGroup(currentEscrow, group.groupId, telegram);
                  } catch (removeError) {
                    console.error('Error removing users during timeout:', removeError);
                  }

                  // Refresh invite link
                  try {
                    await GroupPoolService.refreshInviteLink(group.groupId, telegram);
                  } catch (linkError) {
                    console.error('Error refreshing invite link during timeout:', linkError);
                  }

                  // Reset group
                  group.status = 'available';
                  group.assignedEscrowId = null;
                  group.assignedAt = null;
                  group.completedAt = null;
                  await group.save();

                  // Send message to group that deal was cancelled
                  try {
                    await telegram.sendMessage(
                      String(currentEscrow.groupId),
                      '❌ Deal cancelled: The other participant did not join within 5 minutes. The group has been reset.',
                      { parse_mode: 'HTML' }
                    );
                  } catch (msgError) {
                    console.error('Error sending cancellation message to group:', msgError);
                  }
                }

                // Delete the escrow
                try {
                  await Escrow.deleteOne({ escrowId });
                } catch (deleteError) {
                  console.error('Error deleting escrow during timeout:', deleteError);
                }
              } catch (error) {
                console.error('Error in join timeout handler:', error);
                if (inviteTimeoutMap) {
                  inviteTimeoutMap.delete(escrowId);
                }
              }
            }, 5 * 60 * 1000); // 5 minutes from first user join

            inviteTimeoutMap.set(escrowId, timeoutId);
          }
        }
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

    // Send message that second user joined
    try {
      const joinedLabel = formatParticipant({ username: user.username || null, id: normalizedUserId }, 'User', { html: true });
      await ctx.telegram.sendMessage(
        chatId,
        `✅ ${joinedLabel} joined.`,
        { parse_mode: 'HTML' }
      );
    } catch (msgError) {
      console.error('Failed to send join progress message:', msgError);
    }

    // Delete the waiting message if it exists
    if (escrow.waitingForUserMessageId) {
      try {
        await ctx.telegram.deleteMessage(chatId, escrow.waitingForUserMessageId);
        escrow.waitingForUserMessageId = null;
        await escrow.save();
      } catch (_) {
        // Message may already be deleted, ignore
      }
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
        const initiatorLabel = formatParticipantById(escrow, escrow.allowedUserIds?.[0], 'buyer', { html: true });
        const counterpartyLabel = formatParticipantById(escrow, escrow.allowedUserIds?.[1], 'seller', { html: true });
        const startedMsg = await telegram.sendMessage(
          originChatId,
          `✅ Trade started between ${initiatorLabel} and ${counterpartyLabel}.`,
          { parse_mode: 'HTML' }
        );
        // Store message ID for later editing (don't delete - will be updated with completion details)
        escrow.tradeStartedMessageId = startedMsg.message_id;
        await escrow.save();
      } catch (e) {
        console.error('Error sending trade started message:', e);
      }
    }
    const disclaimer = `⚠️ P2P Deal Disclaimer ⚠️

• Always verify the **admin wallet** before sending any funds.
• Confirm \`@pool\` is present in both the deal room & the main group.
• ❌ Never engage in direct or outside-room deals.
• 💬 Share all details only within this deal room.`;

    // Build initial status with waiting indicators
    const statusLines = getParticipants(escrow).map((participant, index) => {
      const label = formatParticipant(participant, index === 0 ? 'Participant 1' : 'Participant 2', { html: true });
      return `⏳ ${label} - Waiting...`;
    });

    try {
      const images = require('../config/images');
      await ctx.telegram.sendPhoto(chatId, images.DEAL_DISCLAIMER, {
        caption: disclaimer,
        parse_mode: 'Markdown'
      });
      
      // Role selection disclaimer
      const roleDisclaimer = `<b>⚠️ Choose roles accordingly</b>

<b>As release & refund happen according to roles</b>

<b>Refund goes to seller & release to buyer</b>

`;
      
      const roleSelectionMsg = await ctx.telegram.sendPhoto(chatId, images.SELECT_ROLES, {
        caption: roleDisclaimer + statusLines.join('\n'),
        parse_mode: 'HTML',
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
