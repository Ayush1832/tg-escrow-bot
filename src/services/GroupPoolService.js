const GroupPool = require('../models/GroupPool');

class GroupPoolService {
  /**
   * Assign an available group to an escrow
   */
  async assignGroup(escrowId) {
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
  async generateInviteLink(groupId, telegram) {
    try {
      if (!telegram) {
        throw new Error('Telegram API instance is required for generating invite links');
      }

      // Find the group in pool
      const group = await GroupPool.findOne({ groupId });
      if (!group) {
        throw new Error('Group not found in pool');
      }

      // Generate invite link with member limit of 2 (buyer + seller)
      let inviteLinkData;
      const chatId = String(groupId);
      try {
        inviteLinkData = await telegram.createChatInviteLink(chatId, {
          member_limit: 2
        });
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
            inviteLinkData = await telegram.createChatInviteLink(migrateId, {
              member_limit: 2
            });
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
   */
  async addGroup(groupId, groupTitle = null) {
    try {
      // Check if group already exists
      const existingGroup = await GroupPool.findOne({ groupId });
      if (existingGroup) {
        // Idempotent: if it's already in pool, treat as success
        return existingGroup;
      }

      const group = new GroupPool({
        groupId,
        groupTitle,
        status: 'available'
      });

      await group.save();
      return group;

    } catch (error) {
      console.error('Error adding group:', error);
      throw error;
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
        console.log(`No pool group found for escrow ${escrow.escrowId} - skipping recycling (likely manually created group)`);
        return null;
      }

      // Send completion notification to users
      await this.sendCompletionNotification(escrow, telegram);

      // Schedule delayed recycling (15 minutes)
      this.scheduleDelayedRecycling(escrow, group, telegram);

      console.log(`⏰ Group ${group.groupId} scheduled for recycling in 15 minutes for escrow ${escrow.escrowId}`);
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
        console.log(`🔄 Starting delayed recycling for group ${group.groupId} (escrow ${escrow.escrowId})`);
        
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

          console.log(`✅ Group ${group.groupId} recycled successfully after 15-minute delay for escrow ${escrow.escrowId} - ALL users removed`);
        } else {
          // Mark as completed but don't add back to pool if users couldn't be removed
          group.status = 'completed';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = new Date();
          group.inviteLink = null;
          await group.save();

          console.log(`⚠️ Group ${group.groupId} marked as completed but NOT added back to pool - some users couldn't be removed`);
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
   * Remove ALL users from group after completion (buyer, seller, admins, everyone except bot)
   */
  async removeUsersFromGroup(escrow, groupId, telegram) {
    try {
      const chatId = String(groupId);

      // Get all chat members
      let allMembers = [];
      try {
        const chatMembers = await telegram.getChatAdministrators(chatId);
        allMembers = chatMembers.map(member => member.user.id);
        console.log(`Found ${allMembers.length} members in group ${groupId}`);
      } catch (error) {
        console.log(`Could not get chat members for group ${groupId}:`, error.message);
        return false; // Can't proceed without member list
      }

      // Remove ALL users except the bot itself
      let removedCount = 0;
      const botId = (await telegram.getMe()).id;
      
      for (const userId of allMembers) {
        // Skip the bot itself
        if (userId === botId) {
          continue;
        }

        try {
          await telegram.kickChatMember(chatId, userId);
          console.log(`Removed user ${userId} from group ${groupId}`);
          removedCount++;
        } catch (error) {
          console.log(`Could not remove user ${userId} from group:`, error.message);
        }
      }

      console.log(`Removed ${removedCount} users from group ${groupId}`);
      return removedCount > 0;

    } catch (error) {
      console.error('Error removing users from group:', error);
    }
  }
}

module.exports = new GroupPoolService();
