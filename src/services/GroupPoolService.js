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
          member_limit: 2,
          expire_date: Math.floor(Date.now() / 1000) + (6 * 60 * 60) // 6 hours
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
              member_limit: 2,
              expire_date: Math.floor(Date.now() / 1000) + (6 * 60 * 60)
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
      group.inviteLinkExpiry = new Date(Date.now() + (6 * 60 * 60 * 1000));
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
      group.inviteLinkExpiry = null;
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
          inviteLinkExpiry: null
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
        throw new Error('Group already exists in pool');
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
          inviteLinkExpiry: null
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
          inviteLinkExpiry: null
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
            group.inviteLinkExpiry = null;
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
}

module.exports = new GroupPoolService();
