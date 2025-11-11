const Escrow = require('../models/Escrow');
const GroupPoolService = require('../services/GroupPoolService');
const config = require('../../config');

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
    const participantsText = `* Participants:\n• @${initiatorUsername} (Initiator)\n• @${counterpartyUsername} (Counterparty)`;
    const noteText = 'Note: Only the mentioned members can join. Never join any link shared via DM.';
    const message = `🏠 Deal Room Created! [ROOM ${roomSuffix}]\n\n🔗 Join Link: ${inviteLink}\n\n👥 ${participantsText}\n\n${noteText}`;
    const inviteMsg = await ctx.reply(message);
    // Save origin message id to remove later once both join
    try {
      newEscrow.originInviteMessageId = inviteMsg.message_id;
      await newEscrow.save();
    } catch (_) {}

    // Note: Progress messages will be sent by joinRequestHandler after users are approved

  } catch (error) {
    console.error('Error in groupDealHandler:', error);
    return ctx.reply('❌ Failed to create deal room. Please try again.');
  }
};


