const Escrow = require('../models/Escrow');
const AddressAssignmentService = require('./AddressAssignmentService');
const GroupPoolService = require('./GroupPoolService');

class TradeTimeoutService {
  /**
   * Set trade timeout for an escrow (1 hour)
   */
  async setTradeTimeout(escrowId, telegram) {
    try {
      console.log(`⏰ Setting 1-hour trade timeout for escrow ${escrowId}`);

      const escrow = await Escrow.findOne({ escrowId });
      if (!escrow) {
        throw new Error(`Escrow ${escrowId} not found`);
      }

      // Set timeout to 1 hour from now
      const timeoutDate = new Date(Date.now() + (60 * 60 * 1000)); // 1 hour
      
      escrow.tradeTimeout = timeoutDate;
      escrow.timeoutStatus = 'active';
      await escrow.save();

      // Schedule timeout check
      this.scheduleTimeoutCheck(escrowId, telegram);

      console.log(`✅ Trade timeout set for escrow ${escrowId} - expires at ${timeoutDate.toISOString()}`);
      return timeoutDate;

    } catch (error) {
      console.error('Error setting trade timeout:', error);
      throw error;
    }
  }

  /**
   * Schedule timeout check for an escrow
   */
  scheduleTimeoutCheck(escrowId, telegram) {
    // Set timeout for 1 hour (60 * 60 * 1000 ms)
    setTimeout(async () => {
      try {
        await this.handleTradeTimeout(escrowId, telegram);
      } catch (error) {
        console.error('Error in scheduled timeout check:', error);
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * Handle trade timeout - recycle group and release address
   */
  async handleTradeTimeout(escrowId, telegram) {
    try {
      console.log(`⏰ Handling trade timeout for escrow ${escrowId}`);

      const escrow = await Escrow.findOne({ escrowId });
      if (!escrow) {
        console.log(`⚠️ Escrow ${escrowId} not found during timeout check`);
        return;
      }

      // Check if escrow is still active and not disputed
      if (escrow.status === 'disputed' || escrow.isDisputed) {
        console.log(`⚠️ Escrow ${escrowId} is disputed - skipping timeout action`);
        return;
      }

      // Check if escrow is completed
      if (['completed', 'refunded'].includes(escrow.status)) {
        console.log(`✅ Escrow ${escrowId} already completed - skipping timeout action`);
        return;
      }

      // Check if funds have been deposited (user has already deposited)
      if (escrow.status === 'deposited' || escrow.status === 'in_fiat_transfer' || 
          escrow.status === 'ready_to_release' || escrow.depositAmount > 0) {
        console.log(`💰 Escrow ${escrowId} has funds deposited - skipping timeout action`);
        return;
      }

      // Mark escrow as abandoned
      escrow.isAbandoned = true;
      escrow.abandonedAt = new Date();
      escrow.timeoutStatus = 'expired';
      escrow.status = 'completed'; // Mark as completed to trigger recycling
      await escrow.save();

      console.log(`🔄 Escrow ${escrowId} marked as abandoned due to timeout`);

      // Release deposit address
      try {
        await AddressAssignmentService.releaseDepositAddress(escrowId);
        console.log(`✅ Deposit address released for abandoned escrow ${escrowId}`);
      } catch (error) {
        console.error('Error releasing deposit address:', error);
      }

      // Recycle group if it's from pool
      try {
        await GroupPoolService.recycleGroupAfterCompletion(escrow, telegram);
        console.log(`✅ Group recycling scheduled for abandoned escrow ${escrowId}`);
      } catch (error) {
        console.error('Error recycling group:', error);
      }

      // Send timeout notification to users
      await this.sendTimeoutNotification(escrow, telegram);

      console.log(`✅ Trade timeout handled for escrow ${escrowId}`);

    } catch (error) {
      console.error('Error handling trade timeout:', error);
    }
  }

  /**
   * Send timeout notification to users
   */
  async sendTimeoutNotification(escrow, telegram) {
    try {
      const message = `⏰ *TRADE TIMEOUT*

Your escrow has been automatically cancelled due to inactivity.

📋 Escrow ID: \`${escrow.escrowId}\`
⏰ Timeout: 1 hour
🔄 Group will be recycled for future trades

If you want to start a new trade, please create a new escrow.`;

      // Send to buyer if they exist
      if (escrow.buyerId) {
        try {
          await telegram.sendMessage(escrow.buyerId, message);
        } catch (error) {
          console.log(`Could not send timeout message to buyer ${escrow.buyerId}:`, error.message);
        }
      }

      // Send to seller if they exist
      if (escrow.sellerId) {
        try {
          await telegram.sendMessage(escrow.sellerId, message);
        } catch (error) {
          console.log(`Could not send timeout message to seller ${escrow.sellerId}:`, error.message);
        }
      }

      // Send to group if it exists
      if (escrow.groupId) {
        try {
          await telegram.sendMessage(escrow.groupId, message);
        } catch (error) {
          console.log(`Could not send timeout message to group ${escrow.groupId}:`, error.message);
        }
      }

    } catch (error) {
      console.error('Error sending timeout notification:', error);
    }
  }

  /**
   * Cancel trade timeout (when trade completes normally)
   */
  async cancelTradeTimeout(escrowId) {
    try {
      console.log(`❌ Cancelling trade timeout for escrow ${escrowId}`);

      const escrow = await Escrow.findOne({ escrowId });
      if (!escrow) {
        console.log(`⚠️ Escrow ${escrowId} not found`);
        return;
      }

      escrow.timeoutStatus = 'cancelled';
      await escrow.save();

      console.log(`✅ Trade timeout cancelled for escrow ${escrowId}`);

    } catch (error) {
      console.error('Error cancelling trade timeout:', error);
    }
  }

  /**
   * Get timeout statistics
   */
  async getTimeoutStats() {
    try {
      const stats = await Escrow.aggregate([
        {
          $group: {
            _id: '$timeoutStatus',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        active: 0,
        expired: 0,
        cancelled: 0,
        null: 0
      };

      stats.forEach(stat => {
        if (stat._id === null) {
          result.null = stat.count;
        } else {
          result[stat._id] = stat.count;
        }
      });

      return result;

    } catch (error) {
      console.error('Error getting timeout stats:', error);
      throw error;
    }
  }

  /**
   * Get abandoned trades
   */
  async getAbandonedTrades() {
    try {
      const abandonedTrades = await Escrow.find({
        isAbandoned: true
      }).sort({ abandonedAt: -1 });

      return abandonedTrades;

    } catch (error) {
      console.error('Error getting abandoned trades:', error);
      throw error;
    }
  }

  /**
   * Clean up expired timeouts
   */
  async cleanupExpiredTimeouts() {
    try {

      const expiredEscrows = await Escrow.find({
        tradeTimeout: { $lt: new Date() },
        timeoutStatus: 'active',
        status: { $nin: ['completed', 'refunded', 'disputed', 'deposited', 'in_fiat_transfer', 'ready_to_release'] },
        isDisputed: { $ne: true },
        depositAmount: { $lte: 0 }
      });

      let cleanedCount = 0;
      for (const escrow of expiredEscrows) {
        escrow.timeoutStatus = 'expired';
        escrow.isAbandoned = true;
        escrow.abandonedAt = new Date();
        await escrow.save();
        cleanedCount++;
      }

      return cleanedCount;

    } catch (error) {
      console.error('Error cleaning up expired timeouts:', error);
      throw error;
    }
  }
}

module.exports = new TradeTimeoutService();
