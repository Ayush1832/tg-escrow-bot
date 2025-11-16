const Escrow = require('../models/Escrow');
const GroupPool = require('../models/GroupPool');
const GroupPoolService = require('../services/GroupPoolService');
const config = require('../../config');
const joinRequestHandler = require('./joinRequestHandler');

// Store timeout references for invite message expiration checks
const inviteTimeoutMap = new Map();

// Share the timeout map with joinRequestHandler so it can cancel timeouts
joinRequestHandler.setInviteTimeoutMap(inviteTimeoutMap);

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    // Must be called from a group/supergroup
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used inside a group.');
    }

    const text = ctx.message?.text || '';
    
    // Extract mentioned username from message entities (more reliable than string parsing)
    let counterpartyUsername = null;
    if (ctx.message?.entities) {
      for (const entity of ctx.message.entities) {
        if (entity.type === 'mention' && entity.offset > 0) {
          const mention = text.substring(entity.offset, entity.offset + entity.length);
          counterpartyUsername = mention.replace('@', '').trim();
          break;
        }
      }
    }
    
    // Fallback to simple parsing if entities don't work
    if (!counterpartyUsername) {
      const parts = text.trim().split(/\s+/);
      const counterpartyHandle = parts[1] || '';
      if (counterpartyHandle.startsWith('@') && counterpartyHandle.length > 1) {
        counterpartyUsername = counterpartyHandle.slice(1);
      }
    }

    const initiatorUsername = ctx.from.username || null;
    if (!initiatorUsername) {
      return ctx.reply('❌ You must set a Telegram username to start a deal.');
    }

    if (!counterpartyUsername) {
      return ctx.reply('❌ Usage: /deal @counterparty');
    }
    if (counterpartyUsername.toLowerCase() === initiatorUsername.toLowerCase()) {
      return ctx.reply('❌ You cannot start a deal with yourself.');
    }

    // Create a new managed-room escrow and assign a pool group
    const escrowId = `ESC${Date.now()}`;

    let assignedGroup;
    try {
      assignedGroup = await GroupPoolService.assignGroup(escrowId, ctx.telegram);
    } catch (err) {
      return ctx.reply('🚫 All rooms are currently busy. Please try again in a moment.');
    }

    // Always enforce join-request approval to verify usernames; omit member_limit to avoid API conflict
    const inviteLink = await GroupPoolService.generateInviteLink(assignedGroup.groupId, ctx.telegram, { creates_join_request: true });

    // Persist escrow with allowed usernames and user IDs
    // Note: assignedFromPool: true ensures this group will be recycled back to pool after completion
    const newEscrow = new Escrow({
      escrowId,
      creatorId: ctx.from.id,
      creatorUsername: initiatorUsername,
      groupId: assignedGroup.groupId, // This is a pool group assigned from GroupPoolService
      assignedFromPool: true, // Mark as pool group for proper recycling
      status: 'draft',
      inviteLink, // Join-request link from the pool group
      allowedUsernames: [initiatorUsername, counterpartyUsername],
      allowedUserIds: [ctx.from.id], // Track initiator's ID in case username changes
      approvedUserIds: [], // Will be populated as users join via join-request approval
      originChatId: String(chatId)
    });
    await newEscrow.save();

    // Post the room card in the current group (showing invite link from pool group)
    const roomSuffix = escrowId.slice(-2);
    const images = require('../config/images');
    const participantsText = `* Participants:\n• @${initiatorUsername} (Initiator)\n• @${counterpartyUsername} (Counterparty)`;
    const noteText = 'Note: Only the mentioned members can join. Never join any link shared via DM.';
    const message = `🏠 Deal Room Created! \n\n🔗 Join Link: ${inviteLink}\n\n👥 ${participantsText}\n\n${noteText}`;
    const inviteMsg = await ctx.replyWithPhoto(images.DEAL_ROOM_CREATED, {
      caption: message
    });
    // Save origin message id to remove later once both join
    try {
      newEscrow.originInviteMessageId = inviteMsg.message_id;
      await newEscrow.save();
    } catch (_) {}
    
    // Schedule 5-minute timeout to check if both parties joined
    // If not, cancel the deal and recycle the group
    const telegram = ctx.telegram; // Store telegram instance for use in timeout
    
    // Auto-delete invite link message after 5 minutes
    const originChatId = String(chatId);
    const inviteMessageId = inviteMsg.message_id;
    setTimeout(async () => {
      try {
        await telegram.deleteMessage(originChatId, inviteMessageId);
      } catch (_) {}
    }, 5 * 60 * 1000);
    
    // Delete the /deal command message after 5 minutes
    if (ctx.message && ctx.message.message_id) {
      const commandMessageId = ctx.message.message_id;
      setTimeout(async () => {
        try {
          await telegram.deleteMessage(originChatId, commandMessageId);
        } catch (deleteError) {
          // Message might already be deleted or not accessible - ignore
        }
      }, 5 * 60 * 1000); // 5 minutes
    }
    const timeoutId = setTimeout(async () => {
      try {
        // Re-fetch escrow to get latest state
        const currentEscrow = await Escrow.findOne({ escrowId: newEscrow.escrowId });
        if (!currentEscrow) {
          // Escrow was deleted, nothing to do
          inviteTimeoutMap.delete(newEscrow.escrowId);
          return;
        }

        // Check if escrow status changed (trade started or completed)
        if (currentEscrow.status !== 'draft' || currentEscrow.roleSelectionMessageId) {
          // Trade has progressed, cancel timeout
          inviteTimeoutMap.delete(newEscrow.escrowId);
          return;
        }

        // Check if both parties have joined
        const approvedCount = (currentEscrow.approvedUserIds || []).length;
        
        // Check if initiator is already in group (admin case)
        let initiatorPresent = false;
        if (currentEscrow.creatorId) {
          try {
            const memberInfo = await telegram.getChatMember(
              String(currentEscrow.groupId), 
              Number(currentEscrow.creatorId)
            );
            initiatorPresent = ['member', 'administrator', 'creator'].includes(memberInfo.status);
          } catch (_) {
            initiatorPresent = false;
          }
        }

        // Count total joined: approvedUserIds + initiator if already present
        const creatorAlreadyCounted = currentEscrow.approvedUserIds?.includes(Number(currentEscrow.creatorId));
        const totalJoined = approvedCount + (initiatorPresent && !creatorAlreadyCounted ? 1 : 0);

        if (totalJoined >= 2) {
          // Both joined, cancel timeout
          inviteTimeoutMap.delete(newEscrow.escrowId);
          return;
        }

        // Timeout expired and not both joined - cancel the deal
        inviteTimeoutMap.delete(newEscrow.escrowId);

        // Delete the invite message
        if (currentEscrow.originChatId && currentEscrow.originInviteMessageId) {
          try {
            await telegram.deleteMessage(
              currentEscrow.originChatId, 
              currentEscrow.originInviteMessageId
            );
          } catch (deleteError) {
            console.log('Could not delete invite message:', deleteError.message);
          }
        }

        // Send cancellation message
        const initiatorName = currentEscrow.allowedUsernames?.[0] || 'user';
        const counterpartyName = currentEscrow.allowedUsernames?.[1] || 'user';
        try {
          const cancellationMsg = await telegram.sendMessage(
            currentEscrow.originChatId,
            `❌ Deal cancelled between @${initiatorName} and @${counterpartyName} due to inactivity. Both parties must join within 5 minutes.`
          );
          
          // Delete cancellation message after 5 minutes
          setTimeout(async () => {
            try {
              await telegram.deleteMessage(
                currentEscrow.originChatId,
                cancellationMsg.message_id
              );
            } catch (deleteError) {
              // Message might already be deleted or not accessible - ignore
            }
          }, 5 * 60 * 1000); // 5 minutes
        } catch (msgError) {
          console.log('Could not send cancellation message:', msgError.message);
        }

        // Recycle the group
        const group = await GroupPool.findOne({ 
          assignedEscrowId: currentEscrow.escrowId 
        });

        if (group) {
          // Clear escrow invite link (but keep group invite link - it's permanent)
          if (currentEscrow.inviteLink) {
            currentEscrow.inviteLink = null;
            await currentEscrow.save();
          }

          // Remove users from group
          try {
            await GroupPoolService.removeUsersFromGroup(currentEscrow, group.groupId, telegram);
          } catch (removeError) {
            console.log('Could not remove users during timeout cancellation:', removeError.message);
          }

          // Reset group pool entry
          // IMPORTANT: Do NOT clear group.inviteLink - we keep the permanent link for reuse
          group.status = 'available';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = null;
          // Keep inviteLink - it's permanent and will be reused
          await group.save();
        }

        // Delete the escrow
        try {
          await Escrow.deleteOne({ escrowId: currentEscrow.escrowId });
        } catch (deleteError) {
          console.log('Could not delete escrow during timeout cancellation:', deleteError.message);
        }

      } catch (error) {
        console.error('Error in invite timeout handler:', error);
        inviteTimeoutMap.delete(newEscrow.escrowId);
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Store timeout reference so we can cancel it if both join
    inviteTimeoutMap.set(newEscrow.escrowId, timeoutId);

    // Note: Progress messages will be sent by joinRequestHandler after users are approved

  } catch (error) {
    console.error('Error in groupDealHandler:', error);
    return ctx.reply('❌ Failed to create deal room. Please try again.');
  }
};


