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

      // Revoke existing stored invite link to avoid "expired" state when reusing old links
      try {
        if (group.inviteLink) {
          await telegram.revokeChatInviteLink(String(groupId), group.inviteLink);
          group.inviteLink = null;
          await group.save();
        }
      } catch (_) {
        // Non-critical: proceed to create a fresh link regardless
      }

      // Generate invite link. If creates_join_request is true, do NOT set member_limit (Telegram API restriction)
      let inviteLinkData;
      const chatId = String(groupId);
      try {
        const params = {};
        if (options.creates_join_request === true) {
          params.creates_join_request = true;
        } else {
          params.member_limit = options.member_limit ?? 2;
        }
        // Only set expiry if explicitly provided; otherwise let Telegram manage validity
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

      // Update group with invite link
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
      group.status = 'completed';
      group.completedAt = new Date();
      group.inviteLink = null; // Clear invite link
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
            group.inviteLink = null;
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

        if (allUsersRemoved) {
          // Only add back to pool if ALL users were successfully removed
          group.status = 'available';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = null;
          group.inviteLink = null;
          await group.save();

        } else {
          // Mark as completed but don't add back to pool if users couldn't be removed
          group.status = 'completed';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = new Date();
          group.inviteLink = null;
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
}

module.exports = new GroupPoolService();
