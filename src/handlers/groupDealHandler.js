const Escrow = require("../models/Escrow");
const GroupPool = require("../models/GroupPool");
const GroupPoolService = require("../services/GroupPoolService");
const config = require("../../config");
const joinRequestHandler = require("./joinRequestHandler");
const findGroupEscrow = require('../utils/findGroupEscrow');
const {
  formatParticipant,
  formatParticipantByIndex,
} = require("../utils/participant");

// Store timeout references for invite message expiration checks
const inviteTimeoutMap = new Map();

// Share the timeout map with joinRequestHandler so it can cancel timeouts
joinRequestHandler.setInviteTimeoutMap(inviteTimeoutMap);

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    // Must be called from a group/supergroup
    if (chatId > 0) {
      return ctx.reply("❌ This command can only be used inside a group.");
    }

    // Check if this is a trade group (has an active escrow with this groupId)
    // Use findGroupEscrow to check for any active escrow (any status)
    const tradeGroupEscrow = await findGroupEscrow(
      chatId,
      null // No status filter - check for any escrow
    );

    if (tradeGroupEscrow) {
      // This is a trade group, command should not work here
      return ctx.reply("❌ This command can only be used in the main group, not in trade groups.");
    }

    const text = ctx.message?.text || "";

    const initiatorId = ctx.from.id;
    const initiatorUsername = ctx.from.username || null;

    // Determine the counterparty using mention, text_mention, or reply target
    let counterpartyUser = null;
    let counterpartyHandle = null;

    if (ctx.message?.entities) {
      for (const entity of ctx.message.entities) {
        if (entity.type === "text_mention" && entity.user) {
          counterpartyUser = entity.user;
          break;
        }
        if (entity.type === "mention" && !counterpartyHandle) {
          const mention = text.substring(
            entity.offset,
            entity.offset + entity.length
          );
          counterpartyHandle = mention.trim();
        }
      }
    }

    if (!counterpartyUser && ctx.message?.reply_to_message?.from) {
      counterpartyUser = ctx.message.reply_to_message.from;
    }

    if (!counterpartyUser && !counterpartyHandle) {
      const parts = text.trim().split(/\s+/);
      const handleCandidate = parts[1];
      if (
        handleCandidate &&
        handleCandidate.startsWith("@") &&
        handleCandidate.length > 1
      ) {
        counterpartyHandle = handleCandidate;
      }
    }

    if (!counterpartyUser && counterpartyHandle) {
      const handle = counterpartyHandle.startsWith("@")
        ? counterpartyHandle.substring(1) // Remove @ for username lookup
        : counterpartyHandle;
      
      // Try multiple methods to get the user
      let chatInfo = null;
      
      // Method 1: Try getChat with @username (works if user has interacted with bot)
      try {
        chatInfo = await ctx.telegram.getChat(`@${handle}`);
      } catch (getChatError) {
        // getChat failed (expected if user hasn't interacted with bot)
        // Silently continue to alternative methods - don't log as error
        // This is normal behavior for users who haven't started the bot
        chatInfo = null; // Ensure chatInfo is null so we proceed to Method 2
      }
      
      // Method 2: Try to find the user in the current group's administrators
      // This works even if the user hasn't interacted with the bot
      if (!counterpartyUser && chatId < 0) {
        try {
          const administrators = await ctx.telegram.getChatAdministrators(chatId);
          const normalizedHandle = handle.toLowerCase();
          
          for (const admin of administrators) {
            if (admin.user && admin.user.username) {
              const adminUsername = admin.user.username.toLowerCase();
              if (adminUsername === normalizedHandle) {
                // Found the user in group administrators
                counterpartyUser = {
                  id: Number(admin.user.id),
                  username: admin.user.username || null,
                  first_name: admin.user.first_name,
                  last_name: admin.user.last_name,
                  is_bot: admin.user.is_bot || false,
                };
                break;
              }
            }
          }
        } catch (adminError) {
          // Can't get administrators (bot might not be admin or group doesn't allow it)
          // Silently continue to other methods
        }
      }
      
      // Method 3: If still not found, try to find the user in our database
      // (if they've done trades before, we'll have their user ID)
      if (!counterpartyUser && (!chatInfo || chatInfo.type !== "private")) {
        try {
          const Escrow = require("../models/Escrow");
          // Search for the user in recent escrows by username
          const escrowWithUser = await Escrow.findOne({
            $or: [
              { buyerUsername: { $regex: new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
              { sellerUsername: { $regex: new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
            ]
          }).sort({ createdAt: -1 });
          
          if (escrowWithUser) {
            // Found the user in database, get their info
            const userId = escrowWithUser.buyerUsername?.toLowerCase() === handle.toLowerCase()
              ? escrowWithUser.buyerId
              : escrowWithUser.sellerId;
            const userUsername = escrowWithUser.buyerUsername?.toLowerCase() === handle.toLowerCase()
              ? escrowWithUser.buyerUsername
              : escrowWithUser.sellerUsername;
            
            if (userId) {
              // Try to get chat member info from the group (preferred method)
              try {
                const memberInfo = await ctx.telegram.getChatMember(chatId, userId);
                if (memberInfo && memberInfo.user) {
                  counterpartyUser = {
                    id: Number(memberInfo.user.id),
                    username: memberInfo.user.username || userUsername || null,
                    first_name: memberInfo.user.first_name,
                    last_name: memberInfo.user.last_name,
                    is_bot: memberInfo.user.is_bot || false,
                  };
                }
              } catch (memberError) {
                // User not in group or can't get member info
                // Fallback: Use database info to create user object
                // This allows the deal to proceed even if we can't verify group membership
                counterpartyUser = {
                  id: Number(userId),
                  username: userUsername || handle,
                  first_name: null,
                  last_name: null,
                  is_bot: false,
                };
              }
            }
          }
        } catch (dbError) {
          console.error("Error searching database for user:", dbError);
        }
      }
      
      // Method 4: If we still don't have the user, try getChat one more time
      // (usually won't work if Method 1 failed, but worth a try)
      if (!counterpartyUser && (!chatInfo || chatInfo.type !== "private")) {
        try {
          chatInfo = await ctx.telegram.getChat(`@${handle}`);
        } catch (retryError) {
          // getChat failed again - this is expected for users who haven't interacted with bot
          // Silently continue - don't log as error
          chatInfo = null;
        }
      }
      
      // If we got chatInfo, validate and use it
      if (!counterpartyUser && chatInfo) {
        // getChat can return different types, we need a user
        if (chatInfo.type !== "private") {
          return ctx.reply(
            "❌ Could not retrieve user info. Please tag the user directly (tap their name) or reply to their message when using /deal."
          );
        }
        
        if (chatInfo.is_bot) {
          return ctx.reply("❌ You cannot start a deal with a bot.");
        }
        
        counterpartyUser = {
          id: Number(chatInfo.id),
          username: chatInfo.username || null,
          first_name: chatInfo.first_name,
          last_name: chatInfo.last_name,
          is_bot: chatInfo.is_bot,
        };
      }
      
      // Method 5: If we still don't have the user ID but have a username,
      // allow proceeding with just the username. The join request handler will
      // match them by username when they try to join.
      // This handles cases where the user is in the group but we can't get their ID yet.
      if (!counterpartyUser && handle) {
        // Create a minimal user object with just the username
        // The join request handler will match by username and update with the actual ID
        counterpartyUser = {
          id: null, // Will be set when user joins via join request
          username: handle,
          first_name: null,
          last_name: null,
          is_bot: false,
        };
      }
    }

    if (!counterpartyUser) {
      return ctx.reply(
        "❌ Please mention the counterparty (tap their name to tag) or reply to their message when using /deal so we can verify their user ID."
      );
    }

    if (counterpartyUser.is_bot) {
      return ctx.reply("❌ You cannot start a deal with a bot.");
    }

    const counterpartyId = counterpartyUser.id;
    const counterpartyUsername = counterpartyUser.username || null;

    // Check if user is trying to deal with themselves (only if we have both IDs)
    if (counterpartyId !== null && counterpartyId !== undefined && Number(counterpartyId) === Number(initiatorId)) {
      return ctx.reply("❌ You cannot start a deal with yourself.");
    }

    // Create a new managed-room escrow and assign a pool group
    const escrowId = `ESC${Date.now()}`;

    let assignedGroup;
    try {
      assignedGroup = await GroupPoolService.assignGroup(
        escrowId,
        ctx.telegram
      );
    } catch (err) {
      return ctx.reply(
        "🚫 All rooms are currently busy. Please try again in a moment."
      );
    }

    // Always enforce join-request approval with a freshly generated link
    let inviteLink = await GroupPoolService.refreshInviteLink(
      assignedGroup.groupId,
      ctx.telegram
    );
    if (!inviteLink) {
      inviteLink = await GroupPoolService.generateInviteLink(
        assignedGroup.groupId,
        ctx.telegram,
        { creates_join_request: true }
      );
    }

    // Persist escrow with allowed usernames and user IDs
    // Note: assignedFromPool: true ensures this group will be recycled back to pool after completion
    const participants = [
      { id: initiatorId, username: initiatorUsername },
      { id: counterpartyId, username: counterpartyUsername },
    ];

    const newEscrow = new Escrow({
      escrowId,
      creatorId: initiatorId,
      creatorUsername: initiatorUsername,
      groupId: assignedGroup.groupId, // This is a pool group assigned from GroupPoolService
      assignedFromPool: true, // Mark as pool group for proper recycling
      status: "draft",
      inviteLink, // Join-request link from the pool group
      allowedUsernames: participants.map((p) => p.username || null),
      // Only include valid user IDs (filter out null/undefined)
      // Users without IDs will be matched by username in joinRequestHandler
      allowedUserIds: participants
        .map((p) => (p.id !== null && p.id !== undefined ? Number(p.id) : null))
        .filter((id) => id !== null),
      approvedUserIds: [], // Will be populated as users join via join-request approval
      originChatId: String(chatId),
    });
    await newEscrow.save();

    // Post the room card in the current group (showing invite link from pool group)
    const images = require("../config/images");

    // Format participants with better handling for users without usernames
    const formatParticipantWithRole = (participant, role) => {
      const formatted = formatParticipant(participant, role, { html: true });
      // If user has username, add role in parentheses. If not, the Telegram link will show their name
      if (participant && participant.username) {
        return `${formatted} (${role})`;
      }
      // For users without username, just show the formatted link (Telegram will display their name)
      return formatted;
    };

    const participantsText = `<b>👥 Participants:</b>\n• ${formatParticipantWithRole(
      participants[0],
      "Initiator"
    )}\n• ${formatParticipantWithRole(participants[1], "Counterparty")}`;
    const noteText =
      "Note: Only the mentioned members can join. Never join any link shared via DM.";
    const message = `<b>🏠 Deal Room Created!</b>\n\n🔗 Join Link: ${inviteLink}\n\n${participantsText}\n\n${noteText}`;
    const inviteMsg = await ctx.replyWithPhoto(images.DEAL_ROOM_CREATED, {
      caption: message,
      parse_mode: "HTML",
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
        const currentEscrow = await Escrow.findOne({
          escrowId: newEscrow.escrowId,
        });
        if (!currentEscrow) {
          // Escrow was deleted, nothing to do
          inviteTimeoutMap.delete(newEscrow.escrowId);
          return;
        }

        // Check if escrow status changed (trade started or completed)
        if (
          currentEscrow.status !== "draft" ||
          currentEscrow.roleSelectionMessageId
        ) {
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
            initiatorPresent = ["member", "administrator", "creator"].includes(
              memberInfo.status
            );
          } catch (_) {
            initiatorPresent = false;
          }
        }

        // Count total joined: approvedUserIds + initiator if already present
        const creatorAlreadyCounted = currentEscrow.approvedUserIds?.includes(
          Number(currentEscrow.creatorId)
        );
        const totalJoined =
          approvedCount + (initiatorPresent && !creatorAlreadyCounted ? 1 : 0);

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
          } catch (deleteError) {}
        }

        // Send cancellation message
        const initiatorName = formatParticipantByIndex(
          currentEscrow,
          0,
          "initiator",
          { html: true }
        );
        const counterpartyName = formatParticipantByIndex(
          currentEscrow,
          1,
          "counterparty",
          { html: true }
        );
        try {
          const cancellationMsg = await telegram.sendMessage(
            currentEscrow.originChatId,
            `❌ Deal cancelled between ${initiatorName} and ${counterpartyName} due to inactivity. Both parties must join within 5 minutes.`,
            { parse_mode: "HTML" }
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
          console.log("Could not send cancellation message:", msgError.message);
        }

        // Recycle the group
        let group = await GroupPool.findOne({
          assignedEscrowId: currentEscrow.escrowId,
        });

        // Fallback: try to find by groupId if not found by assignedEscrowId
        if (!group) {
          group = await GroupPool.findOne({
            groupId: currentEscrow.groupId,
          });
        }

        if (group) {
          // Delete waiting message if it exists
          if (currentEscrow.waitingForUserMessageId) {
            try {
              await telegram.deleteMessage(
                String(currentEscrow.groupId),
                currentEscrow.waitingForUserMessageId
              );
            } catch (_) {
              // Message may already be deleted, ignore
            }
          }

          // Clear escrow invite link (but keep group invite link - it's permanent)
          if (currentEscrow.inviteLink) {
            currentEscrow.inviteLink = null;
            await currentEscrow.save();
          }

          // Remove users from group
          try {
            await GroupPoolService.removeUsersFromGroup(
              currentEscrow,
              group.groupId,
              telegram
            );
          } catch (removeError) {
            console.log(
              "Could not remove users during timeout cancellation:",
              removeError.message
            );
          }

          // Refresh invite link (revoke old and create new) so removed users can rejoin
          try {
            await GroupPoolService.refreshInviteLink(group.groupId, telegram);
          } catch (linkError) {
            console.log(
              "Could not refresh invite link during timeout cancellation:",
              linkError.message
            );
          }

          // Reset group pool entry
          // IMPORTANT: Do NOT clear group.inviteLink - we keep the permanent link for reuse
          group.status = "available";
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = null;
          // Keep inviteLink - it's permanent and will be reused
          await group.save();
        } else {
          console.log(
            `Warning: Could not find group pool entry for escrow ${currentEscrow.escrowId} during timeout cancellation`
          );
        }

        // Delete the escrow
        try {
          await Escrow.deleteOne({ escrowId: currentEscrow.escrowId });
        } catch (deleteError) {
          console.log(
            "Could not delete escrow during timeout cancellation:",
            deleteError.message
          );
        }
      } catch (error) {
        console.error("Error in invite timeout handler:", error);
        inviteTimeoutMap.delete(newEscrow.escrowId);
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Store timeout reference so we can cancel it if both join
    inviteTimeoutMap.set(newEscrow.escrowId, timeoutId);

    // Note: Progress messages will be sent by joinRequestHandler after users are approved
  } catch (error) {
    console.error("Error in groupDealHandler:", error);
    return ctx.reply("❌ Failed to create deal room. Please try again.");
  }
};
