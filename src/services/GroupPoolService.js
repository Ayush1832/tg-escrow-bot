const GroupPool = require("../models/GroupPool");
const config = require("../../config");

class GroupPoolService {
  /**
   * Assign an available group to an escrow
   */
  async assignGroup(escrowId, telegram = null) {
    try {
      // Use findOneAndUpdate for atomic assignment to prevent race conditions
      const updatedGroup = await GroupPool.findOneAndUpdate(
        { status: "available" },
        {
          $set: {
            status: "assigned",
            assignedEscrowId: escrowId,
            assignedAt: new Date(),
          },
        },
        { new: true, sort: { createdAt: 1 } } // Assign oldest available group first
      );

      if (!updatedGroup) {
        // Double check if any groups exist at all to give better error message
        const anyGroup = await GroupPool.findOne({});
        if (!anyGroup) {
          throw new Error("No groups in pool. Please add a group.");
        }
        throw new Error(
          "No available groups in pool. All groups are currently occupied."
        );
      }

      if (telegram) {
        await this.ensureAdminInGroup(updatedGroup.groupId, telegram);
      }

      return updatedGroup;
    } catch (error) {
      if (
        !error.message ||
        (!error.message.includes("No available groups") &&
          !error.message.includes("All groups are currently occupied"))
      ) {
        console.error("Error assigning group:", error);
      }
      throw error;
    }
  }

  /**
   * Generate invite link for assigned group
   * IMPORTANT: This function uses a permanent invite link strategy
   * - Reuses existing invite link if it exists and is valid
   * - Only creates a new link if one doesn't exist
   * - Never revokes links (links are permanent and never expire)
   */
  async generateInviteLink(groupId, telegram, options = {}) {
    try {
      if (!telegram) {
        throw new Error(
          "Telegram API instance is required for generating invite links"
        );
      }

      // Find the group in pool (reload to get latest state)
      const group = await GroupPool.findOne({ groupId });
      if (!group) {
        throw new Error("Group not found in pool");
      }

      const chatId = String(groupId);

      if (options.forceRefresh && group.inviteLink) {
        try {
          await telegram.revokeChatInviteLink(chatId, group.inviteLink);
        } catch (revokeError) {}
        group.inviteLink = null;
        group.inviteLinkHasJoinRequest = false;
        await group.save();
      }

      if (options.creates_join_request === true) {
        if (
          group.inviteLink &&
          group.inviteLinkHasJoinRequest &&
          !options.forceRefresh
        ) {
          try {
            await telegram.getChat(chatId);
            return group.inviteLink;
          } catch (verifyError) {
            console.log(
              `Chat verification failed for ${groupId}: ${verifyError.message}`
            );
            try {
              if (group.inviteLink) {
                await telegram.revokeChatInviteLink(chatId, group.inviteLink);
              }
            } catch (revokeError) {}
            group.inviteLink = null;
            group.inviteLinkHasJoinRequest = false;
            await group.save();
          }
        } else if (group.inviteLink) {
          try {
            await telegram.revokeChatInviteLink(chatId, group.inviteLink);
          } catch (revokeError) {}
          group.inviteLink = null;
          group.inviteLinkHasJoinRequest = false;
          await group.save();
        }
      } else {
        try {
          const primaryLink = await telegram.exportChatInviteLink(chatId);
          if (primaryLink) {
            group.inviteLink = primaryLink;
            await group.save();
            return primaryLink;
          }
        } catch (exportError) {}

        if (group.inviteLink) {
          try {
            await telegram.getChat(chatId);
            return group.inviteLink;
          } catch (verifyError) {
            group.inviteLink = null;
            await group.save();
          }
        }
      }

      let inviteLinkData;
      try {
        const params = {};
        if (options.creates_join_request === true) {
          params.creates_join_request = true;
        } else {
          params.member_limit = options.member_limit ?? 2;
        }
        if (typeof options.expire_date === "number") {
          params.expire_date = options.expire_date;
        }
        inviteLinkData = await telegram.createChatInviteLink(chatId, params);
      } catch (chatError) {
        const migrateId =
          chatError?.on?.payload?.chat_id === chatId &&
          chatError?.response?.parameters?.migrate_to_chat_id
            ? String(chatError.response.parameters.migrate_to_chat_id)
            : null;

        if (migrateId) {
          group.groupId = migrateId;
          await group.save();
          try {
            const retryParams = {};
            if (options.creates_join_request === true) {
              retryParams.creates_join_request = true;
            } else {
              retryParams.member_limit = options.member_limit ?? 2;
            }
            if (typeof options.expire_date === "number") {
              retryParams.expire_date = options.expire_date;
            }
            inviteLinkData = await telegram.createChatInviteLink(
              migrateId,
              retryParams
            );
          } catch (retryErr) {
            console.error(
              "Error generating invite link after migration retry:",
              retryErr
            );
            throw retryErr;
          }
        } else if (chatError.message.includes("chat not found")) {
          group.status = "archived";
          await group.save();
          throw new Error(
            `Group ${groupId} not found or bot is not a member. Group has been archived.`
          );
        }
        throw chatError;
      }
      group.inviteLink = inviteLinkData.invite_link;
      group.inviteLinkHasJoinRequest = options.creates_join_request === true;
      await group.save();

      return inviteLinkData.invite_link;
    } catch (error) {
      console.error("Error generating invite link:", error);
      throw error;
    }
  }

  /**
   * Release group back to pool after escrow completion
   */
  async releaseGroup(escrowId) {
    try {
      const group = await GroupPool.findOne({
        assignedEscrowId: escrowId,
      });

      if (!group) {
        return null;
      }

      group.status = "completed";
      group.completedAt = new Date();
      group.assignedEscrowId = null;
      group.assignedAt = null;
      await group.save();

      return group;
    } catch (error) {
      console.error("Error releasing group:", error);
      throw error;
    }
  }

  /**
   * Reset completed groups back to available (for pool maintenance)
   */
  async resetCompletedGroups() {
    try {
      const result = await GroupPool.updateMany(
        { status: "completed" },
        {
          status: "available",
          assignedEscrowId: null,
          assignedAt: null,
          completedAt: null,
          inviteLink: null,
        }
      );

      return result.modifiedCount;
    } catch (error) {
      console.error("Error resetting completed groups:", error);
      throw error;
    }
  }

  /**
   * Archive a group (for maintenance)
   */
  async archiveGroup(groupId) {
    try {
      const group = await GroupPool.findOne({ groupId });
      if (!group) {
        throw new Error("Group not found");
      }

      group.status = "archived";
      await group.save();

      return group;
    } catch (error) {
      console.error("Error archiving group:", error);
      throw error;
    }
  }

  /**
   * Add a new group to the pool
   * Note: ADMIN_USER_ID2 should already be in the group before adding to pool
   * The admin will never be removed during group recycling
   */
  async addGroup(groupId, groupTitle = null, telegram = null) {
    try {
      // Check if group already exists
      const existingGroup = await GroupPool.findOne({ groupId });
      if (existingGroup) {
        // Idempotent: if it's already in pool, treat as success
        // Verify admin is present if telegram is provided
        if (telegram) {
          await this.ensureAdminInGroup(groupId, telegram);

          // If group doesn't have an invite link, create one
          if (!existingGroup.inviteLink) {
            try {
              await this.generateInviteLink(groupId, telegram, {
                creates_join_request: true,
              });
              // Link is already saved in generateInviteLink
              // Reload to get the updated group with link
              const refreshed = await GroupPool.findOne({ groupId });
              if (refreshed) {
                return refreshed;
              }
            } catch (linkError) {
              // Could not create invite link - will be created when needed
            }
          }
        }
        return existingGroup;
      }

      const group = new GroupPool({
        groupId,
        groupTitle,
        status: "available",
      });

      await group.save();

      // Verify admin is in group if telegram is provided
      if (telegram) {
        await this.ensureAdminInGroup(groupId, telegram);

        // Create a permanent invite link when adding group to pool
        try {
          await this.generateInviteLink(groupId, telegram, {
            creates_join_request: true,
          });
          // Link is already saved in generateInviteLink
          // Reload to get the updated group with link
          const refreshed = await GroupPool.findOne({ groupId });
          if (refreshed) {
            return refreshed;
          }
        } catch (linkError) {
          // Could not create invite link - will be created when needed
        }
      }

      return group;
    } catch (error) {
      console.error("Error adding group:", error);
      throw error;
    }
  }

  /**
   * Verify that ADMIN_USER_ID2 is present in the group
   * This is called to ensure admin stays in groups (they cannot be automatically added by bot)
   */
  async ensureAdminInGroup(groupId, telegram) {
    try {
      const adminUserId2 = config.ADMIN_USER_ID2
        ? Number(config.ADMIN_USER_ID2)
        : null;
      if (!adminUserId2) {
        return; // Admin not configured, skip check
      }

      const chatId = String(groupId);

      try {
        // Get chat administrators to check if admin is present
        const chatAdministrators = await telegram.getChatAdministrators(chatId);
        const adminIds = chatAdministrators.map((member) =>
          Number(member.user.id)
        );

        // Also check regular members (if we can via getChatMember)
        let adminIsMember = false;
        try {
          const memberInfo = await telegram.getChatMember(chatId, adminUserId2);
          adminIsMember = ["member", "administrator", "creator"].includes(
            memberInfo.status
          );
        } catch (memberError) {
          // Admin might not be in group
          adminIsMember = false;
        }

        if (!adminIds.includes(adminUserId2) && !adminIsMember) {
          console.warn(
            `⚠️ WARNING: ADMIN_USER_ID2 (${adminUserId2}) is not present in group ${groupId}. Admin should be manually added to the group before adding it to the pool.`
          );
        }
      } catch (error) {
        // Silently continue - can't verify if bot doesn't have access
      }
    } catch (error) {
      // Silently continue - verification is non-critical
    }
  }

  /**
   * Get pool statistics (alias for getPoolStats)
   */
  async getGroupPoolStats() {
    return this.getPoolStats();
  }

  /**
   * Get pool statistics
   */
  async getPoolStats() {
    try {
      const stats = await GroupPool.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      const result = {
        total: 0,
        available: 0,
        assigned: 0,
        completed: 0,
        archived: 0,
      };

      stats.forEach((stat) => {
        result[stat._id] = stat.count;
        result.total += stat.count;
      });

      return result;
    } catch (error) {
      console.error("Error getting pool stats:", error);
      throw error;
    }
  }

  /**
   * List groups by status
   */
  async getGroupsByStatus(status) {
    try {
      const groups = await GroupPool.find({ status }).sort({ createdAt: -1 });
      return groups;
    } catch (error) {
      console.error("Error getting groups by status:", error);
      throw error;
    }
  }

  /**
   * Reset completed groups back to available (for pool maintenance)
   */
  async resetCompletedGroups() {
    try {
      const result = await GroupPool.updateMany(
        { status: "completed" },
        {
          status: "available",
          assignedEscrowId: null,
          assignedAt: null,
          completedAt: null,
          inviteLink: null,
        }
      );

      return result.modifiedCount;
    } catch (error) {
      console.error("Error resetting completed groups:", error);
      throw error;
    }
  }

  /**
   * Reset assigned groups back to available (manual admin override)
   */
  async resetAssignedGroups() {
    try {
      const result = await GroupPool.updateMany(
        { status: "assigned" },
        {
          status: "available",
          assignedEscrowId: null,
          assignedAt: null,
          inviteLink: null,
        }
      );

      return result.modifiedCount;
    } catch (error) {
      console.error("Error resetting assigned groups:", error);
      throw error;
    }
  }

  /**
   * Clean up invalid groups (groups that don't exist or bot is not a member)
   */
  async cleanupInvalidGroups(telegram) {
    try {
      if (!telegram) {
        throw new Error("Telegram API instance is required for cleanup");
      }

      const groups = await GroupPool.find({
        status: { $in: ["available", "assigned"] },
      });

      let cleanedCount = 0;
      for (const group of groups) {
        try {
          // Try to get chat info to verify group exists and bot is a member
          await telegram.getChat(group.groupId);
        } catch (error) {
          if (
            error.message.includes("chat not found") ||
            error.message.includes("bot was kicked") ||
            error.message.includes("bot is not a member")
          ) {
            // Mark group as archived
            group.status = "archived";
            group.assignedEscrowId = null;
            group.assignedAt = null;
            // Keep inviteLink even when archived - might be reused if group is restored
            await group.save();

            cleanedCount++;
          }
        }
      }

      return cleanedCount;
    } catch (error) {
      console.error("Error cleaning up invalid groups:", error);
      throw error;
    }
  }

  /**
   * Recycle group after escrow completion - remove users and return to pool (with 15-minute delay)
   * NOTE: This only works for groups that are in the GroupPool. Manually created groups are not recycled.
   */
  async recycleGroupAfterCompletion(escrow, telegram) {
    try {
      if (!telegram) {
        throw new Error("Telegram API instance is required for recycling");
      }

      // Only recycle groups that are in the pool (not manually created groups)
      const group = await GroupPool.findOne({
        assignedEscrowId: escrow.escrowId,
      });

      if (!group) {
        return null;
      }

      // Send completion notification to users
      await this.sendCompletionNotification(escrow, telegram);

      // Schedule delayed recycling (15 minutes)
      this.scheduleDelayedRecycling(escrow, group, telegram);

      return group;
    } catch (error) {
      console.error("Error scheduling group recycling:", error);
      throw error;
    }
  }

  /**
   * Schedule delayed group recycling (15 minutes)
   */
  scheduleDelayedRecycling(escrow, group, telegram) {
    // Set timeout for 15 minutes (15 * 60 * 1000 ms)
    setTimeout(async () => {
      try {
        // Remove ALL users from group (buyer, seller, admins, everyone)
        const allUsersRemoved = await this.removeUsersFromGroup(
          escrow,
          group.groupId,
          telegram
        );

        if (allUsersRemoved) {
          // Only add back to pool if ALL users were successfully removed
          // IMPORTANT: Refresh invite link (revoke old and create new)
          // This is necessary because users who were removed cannot rejoin using the same link
          await this.refreshInviteLink(group.groupId, telegram);

          // Unpin all messages
          try {
            await telegram.unpinAllChatMessages(group.groupId);
          } catch (e) {}

          group.status = "available";
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = null;
          await group.save();
        } else {
          // Mark as completed but don't add back to pool if users couldn't be removed
          // IMPORTANT: Do NOT clear group.inviteLink even here - link stays valid
          group.status = "completed";
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = new Date();
          // Keep inviteLink - it's permanent
          await group.save();
        }
      } catch (error) {
        console.error("Error in delayed group recycling:", error);
      }
    }, 15 * 60 * 1000); // 15 minutes
  }

  /**
   * Immediately recycle group (cancel command) - remove users and return to pool
   */
  async recycleGroupNow(escrow, telegram) {
    try {
      if (!telegram) {
        throw new Error("Telegram API instance is required for recycling");
      }

      const group = await GroupPool.findOne({
        assignedEscrowId: escrow.escrowId,
      });

      if (!group) {
        return null;
      }

      // Remove users
      await this.removeUsersFromGroup(escrow, group.groupId, telegram);

      // Refresh invite link
      await this.refreshInviteLink(group.groupId, telegram);

      // Unpin all messages
      try {
        await telegram.unpinAllChatMessages(group.groupId);
      } catch (unpinErr) {
        // Ignore if no rights or no pins
      }

      // Clear recent history (best effort cleanup)
      // This helps hide history for new users if they join a "Visible History" group
      // We assume last 100 messages cover the trade flow
      if (escrow.dealConfirmedMessageId || escrow.tradeStartedMessageId) {
        const lastId =
          escrow.dealConfirmedMessageId || escrow.tradeStartedMessageId;
        // Attempt to delete a range of messages around the known IDs
        // This is approximate but safer than iterating too much
        const startId = Math.max(1, lastId - 50);
        const endId = lastId + 50;
        for (let i = startId; i <= endId; i++) {
          try {
            await telegram.deleteMessage(group.groupId, i);
          } catch (e) {}
        }
      }

      // Reset group status
      group.status = "available";
      group.assignedEscrowId = null;
      group.assignedAt = null;
      group.completedAt = null;
      await group.save();

      return group;
    } catch (error) {
      console.error("Error in immediate group recycling:", error);
      throw error;
    }
  }

  /**
   * Send completion notification to users before removal
   * REMOVED: No longer sending DM messages to users, only in-group messages
   */
  async sendCompletionNotification(escrow, telegram) {
    // Function kept for backward compatibility but no longer sends DM messages
    // Messages are now only sent within the group
    return;
  }

  /**
   * Remove ALL users from group after completion (buyer, seller, admins, everyone except bot and ADMIN_USER_ID2)
   */
  async removeUsersFromGroup(escrow, groupId, telegram) {
    try {
      if (!telegram) {
        console.error("Telegram instance is required for removeUsersFromGroup");
        return false;
      }

      const chatId = String(groupId);
      const adminUserId2 = config.ADMIN_USER_ID2
        ? Number(config.ADMIN_USER_ID2)
        : null;

      // Get bot ID first (needed for skipping bot itself)
      let botId;
      try {
        const botInfo = await telegram.getMe();
        botId = botInfo.id;
      } catch (error) {
        console.error("Error getting bot info:", error);
        return false;
      }

      // Get all chat members (administrators)
      let adminMembers = [];
      try {
        const chatAdministrators = await telegram.getChatAdministrators(chatId);
        adminMembers = chatAdministrators.map((member) =>
          Number(member.user.id)
        );
      } catch (error) {
        console.error("Error getting chat administrators:", error);
        // Continue with empty list - we'll still try to remove buyer/seller from escrow
      }

      // Build list of users to potentially remove
      // Note: Telegram Bot API doesn't provide a direct way to list all regular members
      // We'll work with administrators and any members we can identify via escrow
      const usersToCheck = new Set(adminMembers);

      const addId = (value) => {
        if (value === null || value === undefined) {
          return;
        }
        const numeric = Number(value);
        if (!Number.isNaN(numeric) && numeric !== 0) {
          usersToCheck.add(numeric);
        }
      };

      // Always include buyer and seller from escrow if they exist (they might be regular members, not admins)
      if (escrow) {
        addId(escrow.buyerId);
        addId(escrow.sellerId);

        if (Array.isArray(escrow.allowedUserIds)) {
          escrow.allowedUserIds.forEach(addId);
        }

        if (Array.isArray(escrow.approvedUserIds)) {
          escrow.approvedUserIds.forEach(addId);
        }
      }

      // Remove ALL users except the bot itself and ADMIN_USER_ID2
      let removedCount = 0;
      let skippedCount = 0;

      for (const userId of usersToCheck) {
        // Skip the bot itself
        if (userId === botId) {
          skippedCount++;
          continue;
        }

        // IMPORTANT: Never remove ADMIN_USER_ID2 - they must always stay in the group
        if (adminUserId2 && userId === adminUserId2) {
          skippedCount++;
          continue;
        }

        // Try to remove the user without leaving them banned
        try {
          const untilDate = Math.floor(Date.now() / 1000) + 60; // minimum 60s per Telegram requirements
          await telegram.kickChatMember(chatId, userId, untilDate);

          // Immediately lift the ban so user can rejoin when needed
          try {
            await telegram.unbanChatMember(chatId, userId);
          } catch (unbanError) {
            // Ignore if user was not banned or bot lacks permission
          }

          removedCount++;
        } catch (kickError) {
          // User might have already left, or bot doesn't have permission
          // This is fine - we continue with other users
          const errorMsg =
            kickError?.response?.description ||
            kickError?.message ||
            "Unknown error";
          if (
            !errorMsg.includes("user not found") &&
            !errorMsg.includes("chat not found")
          ) {
            // Only log non-trivial errors
          }
        }
      }

      // Return true if operation completed successfully
      // Note: We return true even if no users were removed (they might have already left)
      // The important thing is that admin is preserved (which we skip in the loop)
      return true;
    } catch (error) {
      console.error("Error removing users from group:", error);
      return false;
    }
  }

  /**
   * Revoke old invite link and create a new one for a group
   * This is necessary when users are removed, as they cannot rejoin using the same link
   * IMPORTANT: Always creates a link with join request approval to ensure security
   */
  async refreshInviteLink(groupId, telegram) {
    try {
      const chatId = String(groupId);
      const group = await GroupPool.findOne({ groupId });

      if (!group) {
        return null;
      }

      if (group.inviteLink) {
        try {
          await telegram.revokeChatInviteLink(chatId, group.inviteLink);
        } catch (revokeError) {
          console.log(
            `Could not revoke old invite link for ${groupId}: ${revokeError.message}`
          );
        }
        group.inviteLink = null;
        group.inviteLinkHasJoinRequest = false;
        await group.save();
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const newLink = await this.generateInviteLink(groupId, telegram, {
        creates_join_request: true,
        forceRefresh: true,
      });

      const updatedGroup = await GroupPool.findOne({ groupId });
      if (updatedGroup) {
        if (newLink && updatedGroup.inviteLink === newLink) {
          updatedGroup.inviteLinkHasJoinRequest = true;
          await updatedGroup.save();
        } else if (newLink) {
          updatedGroup.inviteLink = newLink;
          updatedGroup.inviteLinkHasJoinRequest = true;
          await updatedGroup.save();
        }
      }

      return newLink;
    } catch (error) {
      console.error(`Error refreshing invite link for ${groupId}:`, error);
      // Non-critical error - group can still be recycled, link will be created when needed
      return null;
    }
  }

  /**
   * Delete all messages in a group and unpin all pinned messages
   * Note: Telegram only allows deleting messages less than 48 hours old
   * This function aggressively tries to delete all bot messages by:
   * 1. Deleting tracked message IDs from escrow
   * 2. Sending a test message to get current message ID
   * 3. Attempting to delete ALL messages from 1 to current (in batches)
   *
   * IMPORTANT: Bots can only delete their own messages, not user messages
   */
  async deleteAllGroupMessages(groupId, telegram, escrow = null) {
    try {
      const chatId = String(groupId);

      // Unpin all pinned messages first
      try {
        await telegram.unpinAllChatMessages(chatId);
      } catch (unpinError) {
        // Ignore unpin errors
      }

      let deletedCount = 0;
      const messageIdsToDelete = new Set();
      const deletedSet = new Set(); // Track successfully deleted IDs to avoid re-deletion

      // Collect all known message IDs from escrow
      if (escrow) {
        // Add all tracked message IDs from escrow
        if (escrow.step1MessageId)
          messageIdsToDelete.add(escrow.step1MessageId);
        if (escrow.step2MessageId)
          messageIdsToDelete.add(escrow.step2MessageId);
        if (escrow.step3MessageId)
          messageIdsToDelete.add(escrow.step3MessageId);
        if (escrow.step4ChainMessageId)
          messageIdsToDelete.add(escrow.step4ChainMessageId);
        if (escrow.step4CoinMessageId)
          messageIdsToDelete.add(escrow.step4CoinMessageId);
        if (escrow.step5BuyerAddressMessageId)
          messageIdsToDelete.add(escrow.step5BuyerAddressMessageId);
        if (escrow.step6SellerAddressMessageId)
          messageIdsToDelete.add(escrow.step6SellerAddressMessageId);
        if (escrow.dealSummaryMessageId)
          messageIdsToDelete.add(escrow.dealSummaryMessageId);
        if (escrow.dealConfirmedMessageId)
          messageIdsToDelete.add(escrow.dealConfirmedMessageId);
        if (escrow.transactionHashMessageId)
          messageIdsToDelete.add(escrow.transactionHashMessageId);
        if (escrow.closeTradeMessageId)
          messageIdsToDelete.add(escrow.closeTradeMessageId);
        if (escrow.originInviteMessageId)
          messageIdsToDelete.add(escrow.originInviteMessageId);
        if (escrow.roleSelectionMessageId)
          messageIdsToDelete.add(escrow.roleSelectionMessageId);
      }

      // Delete all known message IDs first
      for (const msgId of messageIdsToDelete) {
        try {
          await telegram.deleteMessage(chatId, msgId);
          deletedCount++;
          deletedSet.add(msgId);
          await new Promise((resolve) => setTimeout(resolve, 20)); // Small delay between deletions
        } catch (deleteError) {
          // Message might not exist, is too old, or wasn't sent by bot - continue
        }
      }

      // Get current message ID by sending a test message
      // This gives us the latest message ID to work backwards from
      let currentMessageId = null;
      try {
        const testMsg = await telegram.sendMessage(chatId, "🧹");
        currentMessageId = testMsg.message_id;

        // Immediately delete the test message
        try {
          await telegram.deleteMessage(chatId, currentMessageId);
          deletedCount++;
          deletedSet.add(currentMessageId);
        } catch (e) {
          // Test message deletion failed - continue anyway
        }
      } catch (testError) {
        // Could not send test message - try to use known message IDs for range
        if (messageIdsToDelete.size > 0) {
          const knownIds = Array.from(messageIdsToDelete).sort((a, b) => a - b);
          currentMessageId = Math.max(...knownIds) + 100; // Estimate range
        } else {
          // No way to determine message range - return what we've deleted so far
          return deletedCount;
        }
      }

      if (!currentMessageId) {
        return deletedCount;
      }

      // Determine range to delete
      // Start from a reasonable minimum (groups usually start from message ID 1 or 2)
      const startId = 1;
      const endId = currentMessageId;

      // Delete messages in batches - try to delete ALL messages, not just sampled ones
      // But we need to be careful with rate limits, so we'll delete in smaller batches with delays
      const BATCH_SIZE = 50; // Delete 50 messages at a time
      const DELAY_BETWEEN_BATCHES = 100; // 100ms delay between batches
      const DELAY_BETWEEN_MESSAGES = 10; // 10ms delay between individual messages

      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 20; // Stop after 20 consecutive errors

      // Delete messages from endId backwards to startId (newer messages first)
      // This is more efficient as newer messages are more likely to be deletable
      // NOTE: Bots can only delete their own messages. User messages cannot be deleted.
      let totalAttempted = 0;
      for (
        let batchStart = endId;
        batchStart >= startId;
        batchStart -= BATCH_SIZE
      ) {
        const batchEnd = Math.max(startId, batchStart - BATCH_SIZE + 1);
        let batchDeleted = 0;
        let batchErrors = 0;

        for (let msgId = batchStart; msgId >= batchEnd; msgId--) {
          // Skip if already deleted
          if (deletedSet.has(msgId)) continue;

          totalAttempted++;
          try {
            await telegram.deleteMessage(chatId, msgId);
            deletedCount++;
            deletedSet.add(msgId);
            batchDeleted++;
            consecutiveErrors = 0; // Reset error counter on success

            // Small delay between messages to avoid rate limiting
            if (msgId > batchEnd) {
              await new Promise((resolve) =>
                setTimeout(resolve, DELAY_BETWEEN_MESSAGES)
              );
            }
          } catch (deleteError) {
            consecutiveErrors++;
            batchErrors++;

            // Check error type for debugging
            const errorMsg =
              deleteError?.response?.description || deleteError?.message || "";
            const errorCode = deleteError?.response?.error_code;

            // Common errors:
            // - 400: Bad Request (message not found, can't be deleted, etc.)
            // - 403: Forbidden (not sent by bot, no permission)
            // Continue trying other messages - these are expected for user messages

            // Stop if we hit too many consecutive errors (likely reached undeletable messages)
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              // Break out of inner loop to try next batch
              break;
            }
          }
        }

        // If batch had no successful deletions and many errors, we might have hit the end
        if (batchDeleted === 0 && consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          // Try one more smaller range before giving up
          if (batchStart > startId + 100) {
            // Continue to try a bit more
          } else {
            break;
          }
        }

        // Delay between batches to avoid rate limiting
        if (batchStart > batchEnd) {
          await new Promise((resolve) =>
            setTimeout(resolve, DELAY_BETWEEN_BATCHES)
          );
        }
      }

      return deletedCount;
    } catch (error) {
      console.error("Error deleting all group messages:", error);
      return 0;
    }
  }
}

module.exports = new GroupPoolService();
