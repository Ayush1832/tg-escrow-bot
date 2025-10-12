const Escrow = require('../models/Escrow');
const Event = require('../models/Event');
const BlockchainService = require('../services/BlockchainService');
const GroupPoolService = require('../services/GroupPoolService');
const { isAdmin } = require('../middleware/adminAuth');
const config = require('../../config');

/**
 * Admin dashboard - view all active disputes
 */
async function adminDashboard(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const disputes = await Escrow.find({
      isDisputed: true,
      disputeResolution: 'pending'
    }).sort({ disputeRaisedAt: -1 });

    if (disputes.length === 0) {
      return ctx.reply('✅ No active disputes found.');
    }

    let message = `🚨 *ACTIVE DISPUTES* (${disputes.length})\n\n`;
    
    disputes.forEach((escrow, index) => {
      const timeAgo = escrow.disputeRaisedAt 
        ? Math.floor((Date.now() - escrow.disputeRaisedAt) / (1000 * 60 * 60)) 
        : 'Unknown';
      
      message += `${index + 1}. **${escrow.escrowId}**\n`;
      message += `   • ${escrow.token} on ${escrow.chain}\n`;
      message += `   • Amount: ${escrow.confirmedAmount || escrow.depositAmount} ${escrow.token}\n`;
      message += `   • Buyer: @${escrow.buyerUsername || 'N/A'}\n`;
      message += `   • Seller: @${escrow.sellerUsername || 'N/A'}\n`;
      message += `   • Reason: ${escrow.disputeReason}\n`;
      message += `   • Time: ${timeAgo}h ago\n`;
      message += `   • Group: \`${escrow.groupId}\`\n\n`;
    });

    message += `\n⚡ *Quick Commands:*\n`;
    message += `• \`/admin_resolve_release <escrowId>\` - Release to buyer\n`;
    message += `• \`/admin_resolve_refund <escrowId>\` - Refund to seller\n`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin dashboard:', error);
    ctx.reply('❌ Error loading disputes dashboard.');
  }
}

/**
 * Admin resolve release - force release to buyer
 */
async function adminResolveRelease(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const escrowId = ctx.message.text.split(' ')[1];
    if (!escrowId) {
      return ctx.reply('❌ Please provide escrow ID.\nUsage: `/admin_resolve_release <escrowId>`', {
        parse_mode: 'Markdown'
      });
    }

    const escrow = await Escrow.findOne({ escrowId });
    if (!escrow) {
      return ctx.reply('❌ Escrow not found.');
    }

    if (!escrow.isDisputed) {
      return ctx.reply('❌ This escrow is not under dispute.');
    }

    if (escrow.disputeResolution !== 'pending') {
      return ctx.reply('❌ This dispute has already been resolved.');
    }

      // Update escrow status
      escrow.disputeResolution = 'release';
      escrow.disputeResolvedBy = ctx.from.username || 'Admin';
      escrow.disputeResolvedAt = new Date();
      escrow.disputeResolutionReason = 'Admin resolved: Release to buyer';
      escrow.status = 'completed';
      await escrow.save();

      // Mark trade as completed for activity monitoring
      try {
        const ActivityMonitoringService = require('../services/ActivityMonitoringService');
        await ActivityMonitoringService.markTradeCompleted(escrow.escrowId);
      } catch (activityError) {
        console.error('Error marking trade completed:', activityError);
      }

      // Release group back to pool
      try {
        const GroupPoolService = require('../services/GroupPoolService');
        await GroupPoolService.releaseGroup(escrow.escrowId);
      } catch (groupError) {
        console.error('Error releasing group back to pool:', groupError);
      }

    // Execute the release
    try {
      const amount = escrow.confirmedAmount || escrow.depositAmount;
      await BlockchainService.releaseFunds(
        escrow.token,
        escrow.chain,
        escrow.buyerAddress,
        amount
      );

      // Log event
      await new Event({
        escrowId: escrow.escrowId,
        actorId: ctx.from.id,
        action: 'admin_release',
        payload: { 
          amount,
          buyerAddress: escrow.buyerAddress,
          reason: 'Admin dispute resolution'
        }
      }).save();

      // Notify group
      try {
        await ctx.bot.telegram.sendMessage(
          escrow.groupId,
          `✅ *ADMIN RESOLUTION*\n\nEscrow ${escrow.escrowId} has been resolved by admin.\n\n💰 ${amount} ${escrow.token} released to buyer.\n\nResolved by: @${ctx.from.username || 'Admin'}`,
          { parse_mode: 'Markdown' }
        );
      } catch (groupError) {
        console.error('Error notifying group:', groupError);
      }

      await ctx.reply(`✅ Successfully released ${amount} ${escrow.token} to buyer for escrow ${escrowId}.`);

    } catch (blockchainError) {
      console.error('Blockchain error during admin release:', blockchainError);
      await ctx.reply('❌ Error executing release on blockchain. Please check logs.');
    }

  } catch (error) {
    console.error('Error in admin resolve release:', error);
    ctx.reply('❌ Error resolving dispute.');
  }
}

/**
 * Admin resolve refund - force refund to seller
 */
async function adminResolveRefund(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const escrowId = ctx.message.text.split(' ')[1];
    if (!escrowId) {
      return ctx.reply('❌ Please provide escrow ID.\nUsage: `/admin_resolve_refund <escrowId>`', {
        parse_mode: 'Markdown'
      });
    }

    const escrow = await Escrow.findOne({ escrowId });
    if (!escrow) {
      return ctx.reply('❌ Escrow not found.');
    }

    if (!escrow.isDisputed) {
      return ctx.reply('❌ This escrow is not under dispute.');
    }

    if (escrow.disputeResolution !== 'pending') {
      return ctx.reply('❌ This dispute has already been resolved.');
    }

    // Update escrow status
    escrow.disputeResolution = 'refund';
    escrow.disputeResolvedBy = ctx.from.username || 'Admin';
    escrow.disputeResolvedAt = new Date();
    escrow.disputeResolutionReason = 'Admin resolved: Refund to seller';
    escrow.status = 'refunded';
    await escrow.save();

    // Release group back to pool
    try {
      const GroupPoolService = require('../services/GroupPoolService');
      await GroupPoolService.releaseGroup(escrow.escrowId);
    } catch (groupError) {
      console.error('Error releasing group back to pool:', groupError);
    }

    // Execute the refund
    try {
      const amount = escrow.confirmedAmount || escrow.depositAmount;
      await BlockchainService.refundFunds(
        escrow.token,
        escrow.chain,
        escrow.sellerAddress,
        amount
      );

      // Log event
      await new Event({
        escrowId: escrow.escrowId,
        actorId: ctx.from.id,
        action: 'admin_refund',
        payload: { 
          amount,
          sellerAddress: escrow.sellerAddress,
          reason: 'Admin dispute resolution'
        }
      }).save();

      // Notify group
      try {
        await ctx.bot.telegram.sendMessage(
          escrow.groupId,
          `✅ *ADMIN RESOLUTION*\n\nEscrow ${escrow.escrowId} has been resolved by admin.\n\n💰 ${amount} ${escrow.token} refunded to seller.\n\nResolved by: @${ctx.from.username || 'Admin'}`,
          { parse_mode: 'Markdown' }
        );
      } catch (groupError) {
        console.error('Error notifying group:', groupError);
      }

      await ctx.reply(`✅ Successfully refunded ${amount} ${escrow.token} to seller for escrow ${escrowId}.`);

    } catch (blockchainError) {
      console.error('Blockchain error during admin refund:', blockchainError);
      await ctx.reply('❌ Error executing refund on blockchain. Please check logs.');
    }

  } catch (error) {
    console.error('Error in admin resolve refund:', error);
    ctx.reply('❌ Error resolving dispute.');
  }
}

/**
 * Admin stats - view dispute statistics
 */
async function adminStats(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const totalDisputes = await Escrow.countDocuments({ isDisputed: true });
    const pendingDisputes = await Escrow.countDocuments({ 
      isDisputed: true, 
      disputeResolution: 'pending' 
    });
    const resolvedDisputes = await Escrow.countDocuments({ 
      isDisputed: true, 
      disputeResolution: { $ne: 'pending' } 
    });

    const releaseCount = await Escrow.countDocuments({ 
      disputeResolution: 'release' 
    });
    const refundCount = await Escrow.countDocuments({ 
      disputeResolution: 'refund' 
    });

    const statsMessage = `
📊 *ADMIN STATISTICS*

🚨 *Disputes:*
• Total: ${totalDisputes}
• Pending: ${pendingDisputes}
• Resolved: ${resolvedDisputes}

⚖️ *Resolution Breakdown:*
• Released to Buyer: ${releaseCount}
• Refunded to Seller: ${refundCount}

📈 *Resolution Rate:* ${resolvedDisputes > 0 ? ((resolvedDisputes / totalDisputes) * 100).toFixed(1) : 0}%
    `;

    await ctx.reply(statsMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin stats:', error);
    ctx.reply('❌ Error loading statistics.');
  }
}

/**
 * Admin group pool management
 */
async function adminGroupPool(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const stats = await GroupPoolService.getPoolStats();
    
    const message = `
🏊‍♂️ *GROUP POOL STATUS*

📊 *Statistics:*
• Total Groups: ${stats.total}
• Available: ${stats.available} 🟢
• Assigned: ${stats.assigned} 🟡
• Completed: ${stats.completed} 🔵
• Archived: ${stats.archived} ⚫

⚡ *Commands:*
• \`/admin_pool_add <groupId>\` - Add group to pool
• \`/admin_pool_list\` - List all groups
• \`/admin_pool_reset\` - Reset completed groups
• \`/admin_pool_reset_assigned\` - Reset assigned groups to available
• \`/admin_pool_cleanup\` - Clean up invalid groups
• \`/admin_pool_archive <groupId>\` - Archive group
    `;

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin group pool:', error);
    ctx.reply('❌ Error loading group pool status.');
  }
}

/**
 * Add group to pool
 */
async function adminPoolAdd(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const groupId = ctx.message.text.split(' ')[1];
    if (!groupId) {
      return ctx.reply('❌ Please provide group ID.\nUsage: `/admin_pool_add <groupId>`', {
        parse_mode: 'Markdown'
      });
    }

    await GroupPoolService.addGroup(groupId);
    await ctx.reply(`✅ Added group ${groupId} to pool.`);

  } catch (error) {
    console.error('Error adding group to pool:', error);
    await ctx.reply(`❌ Error adding group: ${error.message}`);
  }
}

/**
 * List groups in pool
 */
async function adminPoolList(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const availableGroups = await GroupPoolService.getGroupsByStatus('available');
    const assignedGroups = await GroupPoolService.getGroupsByStatus('assigned');
    const completedGroups = await GroupPoolService.getGroupsByStatus('completed');

    let message = '🏊‍♂️ *GROUP POOL LIST*\n\n';
    
    if (availableGroups.length > 0) {
      message += `🟢 *Available (${availableGroups.length}):*\n`;
      availableGroups.forEach(group => {
        message += `• \`${group.groupId}\` - ${group.groupTitle || 'No title'}\n`;
      });
      message += '\n';
    }

    if (assignedGroups.length > 0) {
      message += `🟡 *Assigned (${assignedGroups.length}):*\n`;
      assignedGroups.forEach(group => {
        message += `• \`${group.groupId}\` - Escrow: ${group.assignedEscrowId}\n`;
      });
      message += '\n';
    }

    if (completedGroups.length > 0) {
      message += `🔵 *Completed (${completedGroups.length}):*\n`;
      completedGroups.forEach(group => {
        const completedAgo = group.completedAt 
          ? Math.floor((Date.now() - group.completedAt) / (1000 * 60 * 60))
          : 'Unknown';
        message += `• \`${group.groupId}\` - ${completedAgo}h ago\n`;
      });
    }

    if (availableGroups.length === 0 && assignedGroups.length === 0 && completedGroups.length === 0) {
      message += 'No groups in pool.';
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error listing groups:', error);
    ctx.reply('❌ Error listing groups.');
  }
}

/**
 * Reset completed groups back to available
 */
async function adminPoolReset(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const resetCount = await GroupPoolService.resetCompletedGroups();
    await ctx.reply(`✅ Reset ${resetCount} completed groups back to available status.`);

  } catch (error) {
    console.error('Error resetting groups:', error);
    ctx.reply('❌ Error resetting groups.');
  }
}

/**
 * Reset assigned groups back to available (manual override)
 */
async function adminPoolResetAssigned(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const resetCount = await GroupPoolService.resetAssignedGroups();
    await ctx.reply(`✅ Reset ${resetCount} assigned groups back to available status.`);

  } catch (error) {
    console.error('Error resetting assigned groups:', error);
    ctx.reply('❌ Error resetting assigned groups.');
  }
}

/**
 * Clean up invalid groups (groups that don't exist or bot is not a member)
 */
async function adminPoolCleanup(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const cleanedCount = await GroupPoolService.cleanupInvalidGroups(ctx.telegram);
    await ctx.reply(`✅ Cleaned up ${cleanedCount} invalid groups. They have been archived.`);

  } catch (error) {
    console.error('Error cleaning up invalid groups:', error);
    ctx.reply('❌ Error cleaning up invalid groups.');
  }
}

/**
 * Archive a group
 */
async function adminPoolArchive(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const groupId = ctx.message.text.split(' ')[1];
    if (!groupId) {
      return ctx.reply('❌ Please provide group ID.\nUsage: `/admin_pool_archive <groupId>`', {
        parse_mode: 'Markdown'
      });
    }

    await GroupPoolService.archiveGroup(groupId);
    await ctx.reply(`✅ Archived group ${groupId}.`);

  } catch (error) {
    console.error('Error archiving group:', error);
    await ctx.reply(`❌ Error archiving group: ${error.message}`);
  }
}

/**
 * Admin activity stats - view activity monitoring statistics
 */
async function adminActivityStats(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const ActivityMonitoringService = require('../services/ActivityMonitoringService');
    const stats = await ActivityMonitoringService.getActivityStats();

    if (!stats) {
      return ctx.reply('❌ Error loading activity statistics.');
    }

    const message = `
📊 *ACTIVITY MONITORING STATISTICS*

🕐 *Current Activity:*
• Active Trades: ${stats.active}
• Inactive Trades: ${stats.inactive}
• Completed Trades: ${stats.completed}
• Cancelled Trades: ${stats.cancelled}
• Total Tracked: ${stats.total}

⚙️ *Monitoring Settings:*
• Inactivity Threshold: 2 hours
• Cleanup Check: Every 10 minutes
• Auto-cleanup: Enabled

🔄 *Cleanup Actions:*
• Inactive trades → Cancelled + Users removed
• Completed trades → Cleaned + Users removed
• Groups returned to pool automatically
    `;

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin activity stats:', error);
    ctx.reply('❌ Error loading activity statistics.');
  }
}

module.exports = {
  adminDashboard,
  adminResolveRelease,
  adminResolveRefund,
  adminStats,
  adminGroupPool,
  adminPoolAdd,
  adminPoolList,
  adminPoolReset,
  adminPoolResetAssigned,
  adminPoolCleanup,
  adminPoolArchive,
  adminActivityStats
};
