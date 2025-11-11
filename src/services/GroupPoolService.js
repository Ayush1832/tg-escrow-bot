const GroupPool = require('../models/GroupPool');
const config = require('../../config');

class GroupPoolService {
  /**
   * Assign an available group to an escrow
   */
  async assignGroup(escrowId, telegram = null) {
    try {
      // Find an available group
      const availableGroup = await GroupPool.findOne({ 
        status: 'available' 
      });

      if (!availableGroup) {
        throw new Error('No available groups in pool. All groups are currently occupied.');
      }

      // Double-check group is still available (prevent race conditions)
      const recheckGroup = await GroupPool.findOne({ 
        _id: availableGroup._id,
        status: 'available' 
      });

      if (!recheckGroup) {
        throw new Error('Group was assigned to another escrow. Please try again.');
      }

      // Update group status atomically
      const updateResult = await GroupPool.updateOne(
        { _id: availableGroup._id, status: 'available' },
        { 
          status: 'assigned',
          assignedEscrowId: escrowId,
          assignedAt: new Date()
        }
      );

      if (updateResult.modifiedCount === 0) {
        throw new Error('Group assignment failed. Please try again.');
      }

      // Return updated group
      const updatedGroup = await GroupPool.findById(availableGroup._id);

      // Verify admin is present when group is assigned (if telegram is provided)
      if (telegram) {
        await this.ensureAdminInGroup(updatedGroup.groupId, telegram);
      }

      return updatedGroup;

    } catch (error) {
      // Only log errors that are not "no available groups" 
      if (!error.message || (!error.message.includes('No available groups') && !error.message.includes('All groups are currently occupied'))) {
        console.error('Error assigning group:', error);
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
        throw new Error('Telegram API instance is required for generating invite links');
      }

      // Find the group in pool
      const group = await GroupPool.findOne({ groupId });
      if (!group) {
        throw new Error('Group not found in pool');
      }

      const chatId = String(groupId);

      // Strategy: Reuse existing invite link if it exists
      // Only create a new link if the group doesn't have one
      if (group.inviteLink) {
        // Verify the existing link is still valid by trying to export it
        // If it fails, we'll create a new one
        try {
          // Test if the link is still valid by checking chat info
          // We can't directly verify a link, but we can check if the chat exists
          await telegram.getChat(chatId);
          
          // Link exists and chat is accessible - reuse it
          return group.inviteLink;
        } catch (verifyError) {
          // Link might be invalid or chat might have issues
          // Clear it and create a new one
          console.log(`⚠️ Existing invite link may be invalid, creating new one for group ${groupId}`);
          group.inviteLink = null;
          await group.save();
        }
      }

      // No existing link or link is invalid - create a new permanent link
      // Generate invite link. If creates_join_request is true, do NOT set member_limit (Telegram API restriction)
      let inviteLinkData;
      try {
        const params = {};
        if (options.creates_join_request === true) {
          params.creates_join_request = true;
        } else {
          params.member_limit = options.member_limit ?? 2;
        }
        // DO NOT set expire_date - this makes the link permanent (never expires)
        // Only set expiry if explicitly provided in options (which should be rare)
        if (typeof options.expire_date === 'number') {
          params.expire_date = options.expire_date;
        }
        inviteLinkData = await telegram.createChatInviteLink(chatId, params);
      } catch (chatError) {
        // Handle migration: group upgraded to supergroup → use migrate_to_chat_id
        const migrateId = chatError?.on?.payload?.chat_id === chatId && chatError?.response?.parameters?.migrate_to_chat_id
          ? String(chatError.response.parameters.migrate_to_chat_id)
          : null;

        if (migrateId) {
          // Update stored groupId to the new supergroup id and retry once
          group.groupId = migrateId;
          await group.save();
          try {
            const retryParams = {};
            if (options.creates_join_request === true) {
              retryParams.creates_join_request = true;
            } else {
              retryParams.member_limit = options.member_limit ?? 2;
            }
            // DO NOT set expire_date - permanent link
            if (typeof options.expire_date === 'number') {
              retryParams.expire_date = options.expire_date;
            }
            inviteLinkData = await telegram.createChatInviteLink(migrateId, retryParams);
          } catch (retryErr) {
            console.error('Error generating invite link after migration retry:', retryErr);
            throw retryErr;
          }
        } else if (chatError.message.includes('chat not found')) {
          // Group doesn't exist or bot is not a member - mark group as archived
          group.status = 'archived';
          await group.save();
          throw new Error(`Group ${groupId} not found or bot is not a member. Group has been archived.`);
        }
        throw chatError;
      }

      // Update group with the new permanent invite link
      group.inviteLink = inviteLinkData.invite_link;
      await group.save();

      return inviteLinkData.invite_link;

    } catch (error) {
      console.error('Error generating invite link:', error);
      throw error;
    }
  }

  /**
   * Release group back to pool after escrow completion
   */
  async releaseGroup(escrowId) {
    try {
      const group = await GroupPool.findOne({ 
        assignedEscrowId: escrowId 
      });

      if (!group) {
        return null;
      }

      // Mark group as completed
      // IMPORTANT: Do NOT clear group.inviteLink - we keep the permanent link for reuse
      group.status = 'completed';
      group.completedAt = new Date();
      // Keep inviteLink - it's permanent
      group.assignedEscrowId = null; // Clear assignment
      group.assignedAt = null;
      await group.save();

      return group;

    } catch (error) {
      console.error('Error releasing group:', error);
      throw error;
    }
  }

  /**
   * Reset completed groups back to available (for pool maintenance)
   */
  async resetCompletedGroups() {
    try {
      const result = await GroupPool.updateMany(
        { status: 'completed' },
        { 
          status: 'available',
          assignedEscrowId: null,
          assignedAt: null,
          completedAt: null,
          inviteLink: null,
        }
      );

      return result.modifiedCount;

    } catch (error) {
      console.error('Error resetting completed groups:', error);
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
        throw new Error('Group not found');
      }

      group.status = 'archived';
      await group.save();

      return group;

    } catch (error) {
      console.error('Error archiving group:', error);
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
              await this.generateInviteLink(groupId, telegram, { creates_join_request: true });
              // Link is already saved in generateInviteLink
              // Reload to get the updated group with link
              const refreshed = await GroupPool.findOne({ groupId });
              if (refreshed) {
                return refreshed;
              }
            } catch (linkError) {
              console.log(`Note: Could not create invite link for existing group ${groupId}:`, linkError.message);
            }
          }
        }
        return existingGroup;
      }

      const group = new GroupPool({
        groupId,
        groupTitle,
        status: 'available'
      });

      await group.save();

      // Verify admin is in group if telegram is provided
      if (telegram) {
        await this.ensureAdminInGroup(groupId, telegram);
        
        // Create a permanent invite link when adding group to pool
        try {
          await this.generateInviteLink(groupId, telegram, { creates_join_request: true });
          // Link is already saved in generateInviteLink
          // Reload to get the updated group with link
          const refreshed = await GroupPool.findOne({ groupId });
          if (refreshed) {
            return refreshed;
          }
        } catch (linkError) {
          console.log(`Note: Could not create invite link for new group ${groupId}:`, linkError.message);
          // Continue anyway - link can be created later when needed
        }
      }

      return group;

    } catch (error) {
      console.error('Error adding group:', error);
      throw error;
    }
  }

  /**
   * Verify that ADMIN_USER_ID2 is present in the group
   * This is called to ensure admin stays in groups (they cannot be automatically added by bot)
   */
  async ensureAdminInGroup(groupId, telegram) {
    try {
      const adminUserId2 = config.ADMIN_USER_ID2 ? Number(config.ADMIN_USER_ID2) : null;
      if (!adminUserId2) {
        return; // Admin not configured, skip check
      }

      const chatId = String(groupId);
      
      try {
        // Get chat administrators to check if admin is present
        const chatAdministrators = await telegram.getChatAdministrators(chatId);
        const adminIds = chatAdministrators.map(member => Number(member.user.id));
        
        // Also check regular members (if we can via getChatMember)
        let adminIsMember = false;
        try {
          const memberInfo = await telegram.getChatMember(chatId, adminUserId2);
          adminIsMember = ['member', 'administrator', 'creator'].includes(memberInfo.status);
        } catch (memberError) {
          // Admin might not be in group
          adminIsMember = false;
        }

        if (!adminIds.includes(adminUserId2) && !adminIsMember) {
          console.warn(`⚠️ WARNING: ADMIN_USER_ID2 (${adminUserId2}) is not present in group ${groupId}. Admin should be manually added to the group before adding it to the pool.`);
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
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        total: 0,
        available: 0,
        assigned: 0,
        completed: 0,
        archived: 0
      };

      stats.forEach(stat => {
        result[stat._id] = stat.count;
        result.total += stat.count;
      });

      return result;

    } catch (error) {
      console.error('Error getting pool stats:', error);
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
      console.error('Error getting groups by status:', error);
      throw error;
    }
  }

  /**
   * Reset completed groups back to available (for pool maintenance)
   */
  async resetCompletedGroups() {
    try {
      const result = await GroupPool.updateMany(
        { status: 'completed' },
        { 
          status: 'available',
          assignedEscrowId: null,
          assignedAt: null,
          completedAt: null,
          inviteLink: null,
        }
      );

      return result.modifiedCount;

    } catch (error) {
      console.error('Error resetting completed groups:', error);
      throw error;
    }
  }

  /**
   * Reset assigned groups back to available (manual admin override)
   */
  async resetAssignedGroups() {
    try {
      const result = await GroupPool.updateMany(
        { status: 'assigned' },
        { 
          status: 'available',
          assignedEscrowId: null,
          assignedAt: null,
          inviteLink: null,
        }
      );

      return result.modifiedCount;

    } catch (error) {
      console.error('Error resetting assigned groups:', error);
      throw error;
    }
  }

  /**
   * Clean up invalid groups (groups that don't exist or bot is not a member)
   */
  async cleanupInvalidGroups(telegram) {
    try {
      if (!telegram) {
        throw new Error('Telegram API instance is required for cleanup');
      }

      const groups = await GroupPool.find({ 
        status: { $in: ['available', 'assigned'] } 
      });

      let cleanedCount = 0;
      for (const group of groups) {
        try {
          // Try to get chat info to verify group exists and bot is a member
          await telegram.getChat(group.groupId);
        } catch (error) {
          if (error.message.includes('chat not found') || 
              error.message.includes('bot was kicked') ||
              error.message.includes('bot is not a member')) {
            
            // Mark group as archived
            group.status = 'archived';
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
      console.error('Error cleaning up invalid groups:', error);
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
        throw new Error('Telegram API instance is required for recycling');
      }

      // Only recycle groups that are in the pool (not manually created groups)
      const group = await GroupPool.findOne({ 
        assignedEscrowId: escrow.escrowId 
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
      console.error('Error scheduling group recycling:', error);
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
        const allUsersRemoved = await this.removeUsersFromGroup(escrow, group.groupId, telegram);

        // Delete all messages and unpin pinned messages before recycling
        try {
          // Reload escrow to get latest message IDs
          const freshEscrow = await Escrow.findOne({ escrowId: escrow.escrowId });
          await this.deleteAllGroupMessages(group.groupId, telegram, freshEscrow);
        } catch (deleteError) {
          console.log('Note: Could not delete all messages during delayed recycling:', deleteError.message);
        }

        if (allUsersRemoved) {
          // Only add back to pool if ALL users were successfully removed
          // IMPORTANT: Do NOT clear group.inviteLink - we keep the permanent link for reuse
          group.status = 'available';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = null;
          // Keep inviteLink - it's permanent and will be reused
          await group.save();

        } else {
          // Mark as completed but don't add back to pool if users couldn't be removed
          // IMPORTANT: Do NOT clear group.inviteLink even here - link stays valid
          group.status = 'completed';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = new Date();
          // Keep inviteLink - it's permanent
          await group.save();

        }
      } catch (error) {
        console.error('Error in delayed group recycling:', error);
      }
    }, 15 * 60 * 1000); // 15 minutes
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
        console.error('Telegram instance is required for removeUsersFromGroup');
        return false;
      }

      const chatId = String(groupId);
      const adminUserId2 = config.ADMIN_USER_ID2 ? Number(config.ADMIN_USER_ID2) : null;

      // Get bot ID first (needed for skipping bot itself)
      let botId;
      try {
        const botInfo = await telegram.getMe();
        botId = botInfo.id;
      } catch (error) {
        console.error('Error getting bot info:', error);
        return false;
      }

      // Get all chat members (administrators)
      let adminMembers = [];
      try {
        const chatAdministrators = await telegram.getChatAdministrators(chatId);
        adminMembers = chatAdministrators.map(member => Number(member.user.id));
      } catch (error) {
        console.error('Error getting chat administrators:', error);
        // Continue with empty list - we'll still try to remove buyer/seller from escrow
      }

      // Build list of users to potentially remove
      // Note: Telegram Bot API doesn't provide a direct way to list all regular members
      // We'll work with administrators and any members we can identify via escrow
      const usersToCheck = new Set(adminMembers);

      // Always include buyer and seller from escrow if they exist (they might be regular members, not admins)
      if (escrow) {
        if (escrow.buyerId) {
          usersToCheck.add(Number(escrow.buyerId));
        }
        if (escrow.sellerId) {
          usersToCheck.add(Number(escrow.sellerId));
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

        // Try to remove the user
        try {
          await telegram.kickChatMember(chatId, userId);
          removedCount++;
        } catch (kickError) {
          // User might have already left, or bot doesn't have permission
          // This is fine - we continue with other users
          const errorMsg = kickError?.response?.description || kickError?.message || 'Unknown error';
          if (!errorMsg.includes('user not found') && !errorMsg.includes('chat not found')) {
            // Only log non-trivial errors
          }
        }
      }

      
      
      // Return true if operation completed successfully
      // Note: We return true even if no users were removed (they might have already left)
      // The important thing is that admin is preserved (which we skip in the loop)
      return true;

    } catch (error) {
      console.error('Error removing users from group:', error);
      return false;
    }
  }

  /**
   * Delete all messages in a group and unpin all pinned messages
   * Note: Telegram only allows deleting messages less than 48 hours old
   * This function uses tracked message IDs from escrow and tries to delete messages around them
   */
  async deleteAllGroupMessages(groupId, telegram, escrow = null) {
    try {
      const chatId = String(groupId);
      
      // Unpin all pinned messages first
      try {
        await telegram.unpinAllChatMessages(chatId);
        console.log(`✅ Unpinned all messages in group ${chatId}`);
      } catch (unpinError) {
        console.log(`Note: Could not unpin messages in group ${chatId}:`, unpinError?.message || 'Unknown error');
      }

      let deletedCount = 0;
      const messageIdsToDelete = new Set();

      // Collect all known message IDs from escrow
      if (escrow) {
        // Add all tracked message IDs from escrow
        if (escrow.step1MessageId) messageIdsToDelete.add(escrow.step1MessageId);
        if (escrow.step2MessageId) messageIdsToDelete.add(escrow.step2MessageId);
        if (escrow.step3MessageId) messageIdsToDelete.add(escrow.step3MessageId);
        if (escrow.step5BuyerAddressMessageId) messageIdsToDelete.add(escrow.step5BuyerAddressMessageId);
        if (escrow.step6SellerAddressMessageId) messageIdsToDelete.add(escrow.step6SellerAddressMessageId);
        if (escrow.dealSummaryMessageId) messageIdsToDelete.add(escrow.dealSummaryMessageId);
        if (escrow.transactionHashMessageId) messageIdsToDelete.add(escrow.transactionHashMessageId);
        if (escrow.closeTradeMessageId) messageIdsToDelete.add(escrow.closeTradeMessageId);
        if (escrow.originInviteMessageId) messageIdsToDelete.add(escrow.originInviteMessageId);
        if (escrow.roleSelectionMessageId) messageIdsToDelete.add(escrow.roleSelectionMessageId);
      }

      // Delete all known message IDs
      for (const msgId of messageIdsToDelete) {
        try {
          await telegram.deleteMessage(chatId, msgId);
          deletedCount++;
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (deleteError) {
          // Message might not exist or is too old - continue
        }
      }

      // Try to delete messages in a range around known message IDs
      // Telegram message IDs are sequential, so we can try ranges around known IDs
      if (messageIdsToDelete.size > 0) {
        const knownIds = Array.from(messageIdsToDelete).sort((a, b) => a - b);
        const minId = Math.min(...knownIds);
        const maxId = Math.max(...knownIds);
        
        // Try to delete messages in a range around the known IDs (extend by 1000 messages in each direction)
        const rangeStart = Math.max(1, minId - 1000);
        const rangeEnd = maxId + 1000;
        
        // Delete messages in batches (sample every 10th message to avoid too many requests)
        for (let msgId = rangeStart; msgId <= rangeEnd; msgId += 10) {
          if (messageIdsToDelete.has(msgId)) continue; // Already deleted
          
          try {
            await telegram.deleteMessage(chatId, msgId);
            deletedCount++;
            await new Promise(resolve => setTimeout(resolve, 30));
          } catch (deleteError) {
            // Message doesn't exist or can't be deleted - continue
          }
        }
      } else {
        // No known message IDs - try to delete recent messages
        // Get a recent message ID by sending a test message and deleting it
        try {
          const testMsg = await telegram.sendMessage(chatId, '🧹 Cleaning up...');
          const recentMsgId = testMsg.message_id;
          
          // Try to delete messages backwards from the recent message
          // Telegram only allows deleting messages less than 48 hours old
          const maxRange = 5000; // Reasonable range for a trade group
          for (let i = 0; i < maxRange; i++) {
            const msgIdToTry = recentMsgId - i;
            if (msgIdToTry < 1) break;
            
            try {
              await telegram.deleteMessage(chatId, msgIdToTry);
              deletedCount++;
              await new Promise(resolve => setTimeout(resolve, 30));
            } catch (deleteError) {
              // Message doesn't exist or can't be deleted
              const errorMsg = deleteError?.response?.description || deleteError?.message || '';
              if (errorMsg.includes('message to delete not found') || 
                  errorMsg.includes('message can\'t be deleted')) {
                // Stop if we hit messages that can't be deleted (likely too old)
                break;
              }
            }
          }
          
          // Delete the test message itself
          try {
            await telegram.deleteMessage(chatId, recentMsgId);
          } catch (e) {}
        } catch (testError) {
          console.log('Note: Could not send test message for cleanup:', testError.message);
        }
      }

      console.log(`✅ Deleted ${deletedCount} messages from group ${chatId}`);
      return deletedCount;
    } catch (error) {
      console.error('Error deleting all group messages:', error);
      return 0;
    }
  }
}

module.exports = new GroupPoolService();
