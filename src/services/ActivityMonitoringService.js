const ActivityTracking = require('../models/ActivityTracking');
const Escrow = require('../models/Escrow');
const GroupPool = require('../models/GroupPool');

class ActivityMonitoringService {
  constructor() {
    this.INACTIVITY_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    this.CLEANUP_CHECK_INTERVAL = 10 * 60 * 1000; // Check every 10 minutes
    this.isMonitoring = false;
    this.botInstance = null;
  }

  /**
   * Set the bot instance for sending messages and managing users
   */
  setBotInstance(bot) {
    this.botInstance = bot;
  }

  /**
   * Start the activity monitoring service
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('Activity monitoring already running');
      return;
    }

    this.isMonitoring = true;
    console.log('🕐 Starting activity monitoring service...');

    // Check for cleanup every 10 minutes
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.checkForCleanup();
      } catch (error) {
        console.error('Error in activity monitoring:', error);
      }
    }, this.CLEANUP_CHECK_INTERVAL);
  }

  /**
   * Stop the activity monitoring service
   */
  stopMonitoring() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.isMonitoring = false;
    console.log('🛑 Activity monitoring service stopped');
  }

  /**
   * Track user activity in a group
   */
  async trackActivity(groupId, escrowId, userId, bot) {
    try {
      let tracking = await ActivityTracking.findOne({ 
        groupId, 
        escrowId,
        status: 'active'
      });

      if (!tracking) {
        // Get escrow details to identify buyer/seller
        const escrow = await Escrow.findOne({ escrowId });
        if (!escrow) {
          console.log(`No escrow found for ${escrowId}`);
          return;
        }

        tracking = new ActivityTracking({
          groupId,
          escrowId,
          buyerId: escrow.buyerId,
          sellerId: escrow.sellerId,
          lastAnyActivity: new Date()
        });

        // Set initial activity for the user
        if (userId === escrow.buyerId) {
          tracking.lastBuyerActivity = new Date();
        } else if (userId === escrow.sellerId) {
          tracking.lastSellerActivity = new Date();
        }

        await tracking.save();
        console.log(`📝 Started tracking activity for escrow ${escrowId} in group ${groupId}`);
        return;
      }

      // Update activity for the user
      const now = new Date();
      tracking.lastAnyActivity = now;

      if (userId === tracking.buyerId) {
        tracking.lastBuyerActivity = now;
      } else if (userId === tracking.sellerId) {
        tracking.lastSellerActivity = now;
      }

      // Reset inactivity warning if there's new activity
      if (tracking.inactivityWarningSent) {
        tracking.inactivityWarningSent = false;
      }

      await tracking.save();

    } catch (error) {
      console.error('Error tracking activity:', error);
    }
  }

  /**
   * Mark trade as completed
   */
  async markTradeCompleted(escrowId) {
    try {
      const tracking = await ActivityTracking.findOne({ 
        escrowId,
        status: 'active'
      });

      if (tracking) {
        tracking.status = 'completed';
        tracking.tradeCompletedAt = new Date();
        await tracking.save();
        console.log(`✅ Marked trade completed for escrow ${escrowId}`);
      }
    } catch (error) {
      console.error('Error marking trade completed:', error);
    }
  }

  /**
   * Check for groups that need cleanup
   */
  async checkForCleanup() {
    try {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - this.INACTIVITY_THRESHOLD);

      // Find inactive groups (no activity for 2 hours)
      const inactiveGroups = await ActivityTracking.find({
        status: 'active',
        lastAnyActivity: { $lt: twoHoursAgo }
      });

      // Find completed groups (completed 2 hours ago)
      const completedGroups = await ActivityTracking.find({
        status: 'completed',
        tradeCompletedAt: { $lt: twoHoursAgo }
      });

      // Process inactive groups
      for (const tracking of inactiveGroups) {
        await this.handleInactiveGroup(tracking);
      }

      // Process completed groups
      for (const tracking of completedGroups) {
        await this.handleCompletedGroup(tracking);
      }

      if (inactiveGroups.length > 0 || completedGroups.length > 0) {
        console.log(`🧹 Cleaned up ${inactiveGroups.length} inactive and ${completedGroups.length} completed groups`);
      }

    } catch (error) {
      console.error('Error in cleanup check:', error);
    }
  }

  /**
   * Handle inactive group cleanup
   */
  async handleInactiveGroup(tracking) {
    try {
      console.log(`⏰ Handling inactive group ${tracking.groupId} for escrow ${tracking.escrowId}`);

      // Send inactivity message
      await this.sendInactivityMessage(tracking);

      // Remove users from group
      await this.removeUsersFromGroup(tracking);

      // Mark as cancelled
      tracking.status = 'cancelled';
      await tracking.save();

      // Release group back to pool
      await this.releaseGroupToPool(tracking);

      console.log(`✅ Cleaned up inactive group ${tracking.groupId}`);

    } catch (error) {
      console.error(`Error handling inactive group ${tracking.groupId}:`, error);
    }
  }

  /**
   * Handle completed group cleanup
   */
  async handleCompletedGroup(tracking) {
    try {
      console.log(`✅ Handling completed group ${tracking.groupId} for escrow ${tracking.escrowId}`);

      // Send completion cleanup message
      await this.sendCompletionMessage(tracking);

      // Remove users from group
      await this.removeUsersFromGroup(tracking);

      // Mark as cleaned
      tracking.status = 'inactive';
      await tracking.save();

      // Release group back to pool
      await this.releaseGroupToPool(tracking);

      console.log(`✅ Cleaned up completed group ${tracking.groupId}`);

    } catch (error) {
      console.error(`Error handling completed group ${tracking.groupId}:`, error);
    }
  }

  /**
   * Send inactivity cancellation message
   */
  async sendInactivityMessage(tracking) {
    try {
      if (!this.botInstance) {
        console.log('⚠️ Bot instance not available for sending inactivity message');
        return;
      }

      const message = `
⚠️ *TRADE CANCELLED DUE TO INACTIVITY*

📋 Escrow ID: \`${tracking.escrowId}\`

🕐 This trade has been inactive for 2 hours.
❌ Trade automatically cancelled.

👥 Both parties will be removed from this group.
🔄 Group will be returned to the pool for future trades.

💡 *For new trades, please start a fresh escrow.*
      `;

      await this.botInstance.telegram.sendMessage(tracking.groupId, message, {
        parse_mode: 'Markdown'
      });

      console.log(`📤 Sent inactivity cancellation message to group ${tracking.groupId}`);

    } catch (error) {
      console.error('Error sending inactivity message:', error);
    }
  }

  /**
   * Send completion cleanup message
   */
  async sendCompletionMessage(tracking) {
    try {
      if (!this.botInstance) {
        console.log('⚠️ Bot instance not available for sending completion message');
        return;
      }

      const message = `
✅ *TRADE COMPLETED - GROUP CLEANUP*

📋 Escrow ID: \`${tracking.escrowId}\`

🎉 Trade has been successfully completed!
🕐 Cleanup after 2-hour grace period.

👥 Both parties will be removed from this group.
🔄 Group will be returned to the pool for future trades.

💡 *Thank you for using our escrow service!*
      `;

      await this.botInstance.telegram.sendMessage(tracking.groupId, message, {
        parse_mode: 'Markdown'
      });

      console.log(`📤 Sent completion cleanup message to group ${tracking.groupId}`);

    } catch (error) {
      console.error('Error sending completion message:', error);
    }
  }

  /**
   * Remove users from group
   */
  async removeUsersFromGroup(tracking) {
    try {
      if (!this.botInstance) {
        console.log('⚠️ Bot instance not available for removing users');
        return;
      }

      console.log(`🚪 Removing users from group ${tracking.groupId}:`);
      console.log(`  - Buyer: ${tracking.buyerId}`);
      console.log(`  - Seller: ${tracking.sellerId}`);

      // Remove buyer
      if (tracking.buyerId) {
        try {
          await this.botInstance.telegram.banChatMember(tracking.groupId, tracking.buyerId);
          await this.botInstance.telegram.unbanChatMember(tracking.groupId, tracking.buyerId);
          console.log(`✅ Removed buyer ${tracking.buyerId} from group`);
        } catch (error) {
          console.error(`Error removing buyer ${tracking.buyerId}:`, error);
        }
      }

      // Remove seller
      if (tracking.sellerId) {
        try {
          await this.botInstance.telegram.banChatMember(tracking.groupId, tracking.sellerId);
          await this.botInstance.telegram.unbanChatMember(tracking.groupId, tracking.sellerId);
          console.log(`✅ Removed seller ${tracking.sellerId} from group`);
        } catch (error) {
          console.error(`Error removing seller ${tracking.sellerId}:`, error);
        }
      }

    } catch (error) {
      console.error('Error removing users from group:', error);
    }
  }

  /**
   * Release group back to pool
   */
  async releaseGroupToPool(tracking) {
    try {
      const GroupPoolService = require('./GroupPoolService');
      await GroupPoolService.releaseGroup(tracking.escrowId);
      console.log(`🔄 Released group ${tracking.groupId} back to pool`);
    } catch (error) {
      console.error('Error releasing group to pool:', error);
    }
  }

  /**
   * Get activity statistics
   */
  async getActivityStats() {
    try {
      const stats = await ActivityTracking.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        active: 0,
        inactive: 0,
        completed: 0,
        cancelled: 0,
        total: 0
      };

      stats.forEach(stat => {
        result[stat._id] = stat.count;
        result.total += stat.count;
      });

      return result;
    } catch (error) {
      console.error('Error getting activity stats:', error);
      return null;
    }
  }
}

module.exports = new ActivityMonitoringService();
