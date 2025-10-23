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
    // Inactivity commands removed

    await ctx.reply(message);

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

      // Recycle group after completion - remove users and return to pool
      try {
        const GroupPoolService = require('../services/GroupPoolService');
        await GroupPoolService.recycleGroupAfterCompletion(escrow, ctx.telegram);
      } catch (groupError) {
        console.error('Error recycling group after completion:', groupError);
        // Fallback to regular release if recycling fails
        try {
          await GroupPoolService.releaseGroup(escrow.escrowId);
        } catch (fallbackError) {
          console.error('Error in fallback group release:', fallbackError);
        }
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

    // Recycle group after completion - remove users and return to pool
    try {
      const GroupPoolService = require('../services/GroupPoolService');
      await GroupPoolService.recycleGroupAfterCompletion(escrow, ctx.telegram);
    } catch (groupError) {
      console.error('Error recycling group after completion:', groupError);
      // Fallback to regular release if recycling fails
      try {
        await GroupPoolService.releaseGroup(escrow.escrowId);
      } catch (fallbackError) {
        console.error('Error in fallback group release:', fallbackError);
      }
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
• \`/admin_pool_delete_all\` - Delete all groups from pool
    `;

    await ctx.reply(message);

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

    await ctx.reply(message);

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

// Activity monitoring stats removed

// Manual inactivity check removed

// Activity tracking debug removed

/**
 * Manually send inactivity warnings to currently-inactive groups
 */
async function adminWarnInactive(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const ActivityMonitoringService = require('../services/ActivityMonitoringService');
    const thresholds = ActivityMonitoringService.getThresholds();
    const cutoff = new Date(Date.now() - thresholds.inactivityMs);

    // Inactivity tracking removed
    const candidates = [];

    let attempted = 0;
    let success = 0;
    for (const tracking of candidates) {
      attempted++;
      const ok = await ActivityMonitoringService.sendInactivityWarning(tracking);
      if (ok) success++;
    }

    await ctx.reply(`⚠️ Attempted: ${attempted}, Successfully warned: ${success}.`);
  } catch (error) {
    console.error('Error in adminWarnInactive:', error);
    await ctx.reply('❌ Error sending warnings.');
  }
}

/**
 * Manually remove users from groups pending removal (warning sent + delay passed)
 */
async function adminRemoveInactive(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const ActivityMonitoringService = require('../services/ActivityMonitoringService');
    const thresholds = ActivityMonitoringService.getThresholds();
    const cutoff = new Date(Date.now() - thresholds.warningDelayMs);

    // Inactivity tracking removed
    const candidates = [];

    let removed = 0;
    for (const tracking of candidates) {
      await ActivityMonitoringService.handleInactiveGroup(tracking);
      removed++;
    }

    await ctx.reply(`🚪 Removed users from ${removed} groups pending removal.`);
  } catch (error) {
    console.error('Error in adminRemoveInactive:', error);
    await ctx.reply('❌ Error removing users.');
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
  adminPoolDeleteAll,
  adminPoolDelete,
  adminCleanupAbandoned,
  adminHelp,
  adminTradeStats,
  adminExportTrades,
  adminRecentTrades,
  adminSettlePartial,
  adminRecycleAll
};

/**
 * Delete ALL groups from pool (dangerous)
 */
async function adminPoolDeleteAll(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const GroupPool = require('../models/GroupPool');
    const res = await GroupPool.deleteMany({});
    await ctx.reply(`🗑️ Deleted ${res.deletedCount || 0} groups from pool.`);
  } catch (error) {
    console.error('Error deleting all groups:', error);
    await ctx.reply('❌ Error deleting groups.');
  }
}


/**
 * Clean up abandoned escrows (draft status for more than 24 hours)
 */
async function adminCleanupAbandoned(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const abandonedEscrows = await Escrow.find({
      status: 'draft',
      assignedFromPool: true,
      createdAt: { $lt: new Date(Date.now() - (24 * 60 * 60 * 1000)) }
    });

    let cleanedCount = 0;
    for (const abandoned of abandonedEscrows) {
      try {
        await GroupPoolService.releaseGroup(abandoned.escrowId);
        abandoned.status = 'completed';
        await abandoned.save();
        cleanedCount++;
      } catch (cleanupError) {
        console.error('Error cleaning up abandoned escrow:', cleanupError);
      }
    }

    await ctx.reply(`🧹 Cleaned up ${cleanedCount} abandoned escrows.`);

  } catch (error) {
    console.error('Error in admin cleanup:', error);
    ctx.reply('❌ Error during cleanup.');
  }
}


/**
 * Delete a specific group from the pool by groupId
 */
async function adminPoolDelete(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const groupId = ctx.message.text.split(' ')[1];
    if (!groupId) {
      return ctx.reply('❌ Please provide group ID.\nUsage: `/admin_pool_delete <groupId>`', {
        parse_mode: 'Markdown'
      });
    }

    const GroupPool = require('../models/GroupPool');
    const res = await GroupPool.deleteOne({ groupId });
    if (res.deletedCount === 0) {
      return ctx.reply(`ℹ️ No group found for id ${groupId}.`);
    }
    await ctx.reply(`🗑️ Deleted group ${groupId} from pool.`);
  } catch (error) {
    console.error('Error deleting group from pool:', error);
    await ctx.reply('❌ Error deleting group from pool.');
  }
}

/**
 * Admin command to show all available admin commands and their usage
 */
async function adminHelp(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const helpMessage = `🤖 **ADMIN COMMANDS HELP**

📊 **DISPUTE MANAGEMENT:**
• \`/admin_disputes\` - View all active disputes
• \`/admin_resolve_release <escrowId>\` - Release funds to buyer (resolve dispute)
• \`/admin_resolve_refund <escrowId>\` - Refund funds to seller (resolve dispute)
• \`/admin_stats\` - View dispute statistics
• \`/admin_trade_stats\` - View comprehensive trade statistics by fee percentage
• \`/admin_recent_trades [limit]\` - View recent trades (max 50)
• \`/admin_export_trades\` - Export all trades to CSV file
• \`/admin_settle_partial <escrowId>\` - Settle partial payment disputes

🏊‍♂️ **GROUP POOL MANAGEMENT:**
• \`/admin_pool\` - View group pool status and statistics
• \`/admin_pool_add <groupId>\` - Add group to pool
• \`/admin_pool_list\` - List all groups in pool
• \`/admin_pool_reset\` - Reset completed groups to available
• \`/admin_pool_reset_assigned\` - Reset assigned groups to available
• \`/admin_pool_cleanup\` - Clean up invalid groups (archived)
• \`/admin_pool_archive <groupId>\` - Archive specific group
• \`/admin_pool_delete <groupId>\` - Delete specific group from pool
• \`/admin_pool_delete_all\` - Delete ALL groups from pool (dangerous)

🔄 **GROUP RECYCLING:**
• \`/admin_recycle_all\` - Comprehensive recycling of all eligible groups (completed, disputed, abandoned drafts)

🧹 **MAINTENANCE:**
• \`/admin_cleanup_abandoned\` - Clean up abandoned draft escrows (24h+ old)

📋 **AUTOMATIC FEATURES:**
✅ **Group Recycling**: Automatic 15-minute delayed recycling after trade completion
✅ **Dispute Notifications**: Automatic notifications with clickable group links
✅ **User Management**: Automatic user removal after recycling delay
✅ **Pool Management**: Automatic group status updates

💡 **TIPS:**
• Most operations are automatic - no manual intervention needed
• Use manual commands only for special cases or maintenance
• Group recycling happens automatically with 15-minute delay
• Dispute resolution triggers automatic group recycling

🔧 **QUICK REFERENCE:**
• View disputes: \`/admin_disputes\`
• Pool status: \`/admin_pool\`
• Recent trades: \`/admin_recent_trades 20\`
• Export all trades: \`/admin_export_trades\`
• Trade statistics: \`/admin_trade_stats\`
• Settle partial payments: \`/admin_settle_partial <escrowId>\`
• Comprehensive recycling: \`/admin_recycle_all\`
• Clean up: \`/admin_cleanup_abandoned\``;

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin help:', error);
    ctx.reply('❌ Error loading admin help.');
  }
}

/**
 * Admin command to show comprehensive trade statistics by fee percentage
 */
async function adminTradeStats(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    // Get all completed and refunded escrows
    const completedEscrows = await Escrow.find({
      status: { $in: ['completed', 'refunded'] }
    });

    // Get all contracts to understand fee structures
    const Contract = require('../models/Contract');
    const contracts = await Contract.find({ name: 'EscrowVault' });

    // Group contracts by fee percentage
    const contractsByFee = {};
    contracts.forEach(contract => {
      const feePercent = contract.feePercent || 0;
      if (!contractsByFee[feePercent]) {
        contractsByFee[feePercent] = [];
      }
      contractsByFee[feePercent].push(contract);
    });

    // Get escrow statistics by fee percentage
    const statsByFee = {};
    const allTokens = new Set();
    const allNetworks = new Set();

    for (const [feePercent, contractList] of Object.entries(contractsByFee)) {
      const contractAddresses = contractList.map(c => c.address.toLowerCase());
      
      // Find escrows that used contracts with this fee percentage
      const escrowsWithFee = completedEscrows.filter(escrow => {
        // This is a simplified approach - in reality, you'd need to track which contract was used
        // For now, we'll use the current ESCROW_FEE_PERCENT from config
        const currentFee = Number(config.ESCROW_FEE_PERCENT || 0);
        return currentFee.toString() === feePercent;
      });

      const totalTrades = escrowsWithFee.length;
      const totalAmount = escrowsWithFee.reduce((sum, escrow) => {
        return sum + (parseFloat(escrow.confirmedAmount || escrow.depositAmount || 0));
      }, 0);

      const tokenBreakdown = {};
      escrowsWithFee.forEach(escrow => {
        const token = escrow.token || 'Unknown';
        const amount = parseFloat(escrow.confirmedAmount || escrow.depositAmount || 0);
        
        if (!tokenBreakdown[token]) {
          tokenBreakdown[token] = { count: 0, amount: 0 };
        }
        tokenBreakdown[token].count++;
        tokenBreakdown[token].amount += amount;
        
        allTokens.add(token);
        allNetworks.add(escrow.chain || 'Unknown');
      });

      statsByFee[feePercent] = {
        totalTrades,
        totalAmount,
        tokenBreakdown,
        contracts: contractList.length
      };
    }

    // Calculate overall statistics
    const totalTrades = completedEscrows.length;
    const totalAmount = completedEscrows.reduce((sum, escrow) => {
      return sum + (parseFloat(escrow.confirmedAmount || escrow.depositAmount || 0));
    }, 0);

    const completedCount = completedEscrows.filter(e => e.status === 'completed').length;
    const refundedCount = completedEscrows.filter(e => e.status === 'refunded').length;

    // Build the statistics message
    let statsMessage = `📊 **COMPREHENSIVE TRADE STATISTICS**

🎯 **OVERALL SUMMARY:**
• **Total Trades:** ${totalTrades}
• **Total Volume:** ${totalAmount.toFixed(2)} tokens
• **Completed:** ${completedCount} trades
• **Refunded:** ${refundedCount} trades
• **Success Rate:** ${totalTrades > 0 ? ((completedCount / totalTrades) * 100).toFixed(1) : 0}%

📈 **BY FEE PERCENTAGE:**`;

    // Add statistics for each fee percentage
    const sortedFees = Object.keys(statsByFee).sort((a, b) => parseFloat(a) - parseFloat(b));
    
    for (const feePercent of sortedFees) {
      const stats = statsByFee[feePercent];
      const feeDisplay = feePercent === '0' ? '0% (Free)' : `${feePercent}%`;
      
      statsMessage += `\n\n💰 **${feeDisplay} FEE STRUCTURE:**
• **Trades:** ${stats.totalTrades}
• **Volume:** ${stats.totalAmount.toFixed(2)} tokens
• **Contracts:** ${stats.contracts} deployed
• **Avg per Trade:** ${stats.totalTrades > 0 ? (stats.totalAmount / stats.totalTrades).toFixed(2) : 0} tokens`;

      // Add token breakdown if there are trades
      if (stats.totalTrades > 0) {
        statsMessage += `\n• **Token Breakdown:**`;
        Object.entries(stats.tokenBreakdown).forEach(([token, data]) => {
          statsMessage += `\n  - ${token}: ${data.count} trades, ${data.amount.toFixed(2)} tokens`;
        });
      }
    }

    // Add system information
    statsMessage += `\n\n🔧 **SYSTEM INFO:**
• **Current Fee:** ${config.ESCROW_FEE_PERCENT}%
• **Supported Tokens:** ${Array.from(allTokens).join(', ') || 'None'}
• **Supported Networks:** ${Array.from(allNetworks).join(', ') || 'None'}
• **Total Contracts:** ${contracts.length}

📅 **Last Updated:** ${new Date().toLocaleString()}`;

    await ctx.reply(statsMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin trade stats:', error);
    ctx.reply('❌ Error loading trade statistics.');
  }
}

/**
 * Admin command to export all trades to CSV format
 */
async function adminExportTrades(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    // Get all escrows with detailed information
    const allEscrows = await Escrow.find({})
      .sort({ createdAt: -1 }) // Most recent first
      .populate('buyerId', 'username first_name')
      .populate('sellerId', 'username first_name');

    if (allEscrows.length === 0) {
      return ctx.reply('📊 No trades found in the database.');
    }

    // Create organized CSV content with clear sections
    let csvContent = `# ESCROW TRADES EXPORT
# Generated: ${new Date().toLocaleString()}
# Total Trades: ${allEscrows.length}
#
# COLUMNS:
# ID, Status, Date, Token, Network, Amount, Quantity, Rate, Buyer, Seller, Deal Details, Dispute Reason, Completed Date
#
# DATA:
`;
    
    allEscrows.forEach((escrow, index) => {
      const buyerName = escrow.buyerId ? 
        (escrow.buyerId.username ? `@${escrow.buyerId.username}` : escrow.buyerId.first_name || 'Unknown') : 
        'Not Set';
      
      const sellerName = escrow.sellerId ? 
        (escrow.sellerId.username ? `@${escrow.sellerId.username}` : escrow.sellerId.first_name || 'Unknown') : 
        'Not Set';

      const dealDetails = escrow.dealDetails ? 
        escrow.dealDetails.replace(/\n/g, ' | ').replace(/,/g, ';') : 
        'Not Set';

      const disputeReason = escrow.disputeReason ? 
        escrow.disputeReason.replace(/,/g, ';') : 
        '';

      const completedDate = escrow.completedAt ? 
        new Date(escrow.completedAt).toLocaleString() : 
        '';

      const createdDate = new Date(escrow.createdAt).toLocaleString();
      const amount = escrow.confirmedAmount || escrow.depositAmount || 0;

      // Add separator for readability
      if (index > 0) {
        csvContent += `\n`;
      }

      csvContent += `${escrow._id},${escrow.status},${createdDate},${escrow.token || 'N/A'},${escrow.chain || 'N/A'},${amount},${escrow.quantity || 'N/A'},${escrow.rate || 'N/A'},${buyerName},${sellerName},"${dealDetails}","${disputeReason}",${completedDate}`;
    });

    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `trades-export-${timestamp}.csv`;

    // Save to file
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '..', '..', 'exports', filename);
    
    // Ensure exports directory exists
    const exportsDir = path.dirname(filePath);
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    fs.writeFileSync(filePath, csvContent);

    // Send file to admin
    await ctx.replyWithDocument({
      source: filePath,
      filename: filename
    }, {
      caption: `📊 **TRADE EXPORT COMPLETE**\n\n📈 **Statistics:**\n• Total Trades: ${allEscrows.length}\n• File: ${filename}\n• Generated: ${new Date().toLocaleString()}\n• Location: ${filePath}\n\n💡 **Usage:**\n• Open in Excel, Google Sheets, or any CSV viewer\n• Sort and filter by any column\n• Analyze trading patterns and performance\n• File saved permanently for your records`
    });

  } catch (error) {
    console.error('Error in admin export trades:', error);
    ctx.reply('❌ Error exporting trades.');
  }
}

/**
 * Admin command to get recent trades with pagination
 */
async function adminRecentTrades(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const args = ctx.message.text.split(' ');
    const limit = parseInt(args[1]) || 10; // Default to 10, max 50

    if (limit > 50) {
      return ctx.reply('❌ Maximum 50 trades per request. Use /admin_export_trades for complete data.');
    }

    // Get recent trades
    const recentTrades = await Escrow.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('buyerId', 'username first_name')
      .populate('sellerId', 'username first_name');

    if (recentTrades.length === 0) {
      return ctx.reply('📊 No trades found in the database.');
    }

    let message = `📊 **RECENT TRADES (${recentTrades.length})**\n\n`;

    recentTrades.forEach((escrow, index) => {
      const buyerName = escrow.buyerId ? 
        (escrow.buyerId.username ? `@${escrow.buyerId.username}` : escrow.buyerId.first_name || 'Unknown') : 
        'Not Set';
      
      const sellerName = escrow.sellerId ? 
        (escrow.sellerId.username ? `@${escrow.sellerId.username}` : escrow.sellerId.first_name || 'Unknown') : 
        'Not Set';

      const amount = escrow.confirmedAmount || escrow.depositAmount || 0;
      const statusEmoji = {
        'completed': '✅',
        'refunded': '🔄',
        'disputed': '⚠️',
        'draft': '📝',
        'awaiting_details': '⏳'
      }[escrow.status] || '❓';

      message += `${index + 1}. ${statusEmoji} **${escrow.status.toUpperCase()}**\n`;
      message += `   💰 ${amount} ${escrow.token || 'N/A'} (${escrow.chain || 'N/A'})\n`;
      message += `   👤 Buyer: ${buyerName}\n`;
      message += `   🏪 Seller: ${sellerName}\n`;
      message += `   📅 ${new Date(escrow.createdAt).toLocaleString()}\n`;
      message += `   🆔 ID: \`${escrow._id}\`\n\n`;
    });

    message += `💡 **Commands:**\n`;
    message += `• \`/admin_recent_trades 20\` - Show 20 recent trades\n`;
    message += `• \`/admin_export_trades\` - Export all trades to CSV\n`;
    message += `• \`/admin_trade_stats\` - View statistics by fee percentage`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin recent trades:', error);
    ctx.reply('❌ Error loading recent trades.');
  }
}

/**
 * Admin command to recycle all eligible groups (comprehensive recycling)
 */
async function adminRecycleAll(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const GroupPool = require('../models/GroupPool');
    const Escrow = require('../models/Escrow');
    
    // Find all groups that can be recycled
    const eligibleGroups = await GroupPool.find({
      status: { $in: ['assigned', 'completed'] }
    });

    if (eligibleGroups.length === 0) {
      return ctx.reply('📊 No groups eligible for recycling found.');
    }

    let recycledCount = 0;
    let failedCount = 0;
    const results = [];

    for (const group of eligibleGroups) {
      try {
        // Get the associated escrow
        const escrow = await Escrow.findOne({ escrowId: group.assignedEscrowId });
        
        if (!escrow) {
          // No escrow found, mark group as available
          group.status = 'available';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = null;
          group.inviteLink = null;
          await group.save();
          
          results.push(`✅ Group ${group.groupId}: No escrow found - marked as available`);
          recycledCount++;
          continue;
        }

        // Check if escrow is completed or disputed
        if (escrow.status === 'completed' || escrow.status === 'refunded' || escrow.status === 'disputed') {
          // Try to remove all users from the group
          const GroupPoolService = require('../services/GroupPoolService');
          const allUsersRemoved = await GroupPoolService.removeUsersFromGroup(escrow, group.groupId, ctx.telegram);

          if (allUsersRemoved) {
            // All users removed successfully - add back to pool
            group.status = 'available';
            group.assignedEscrowId = null;
            group.assignedAt = null;
            group.completedAt = null;
            group.inviteLink = null;
            await group.save();
            
            results.push(`✅ Group ${group.groupId}: Recycled successfully (${escrow.status})`);
            recycledCount++;
          } else {
            // Some users couldn't be removed - mark as completed but don't add to pool
            group.status = 'completed';
            group.assignedEscrowId = null;
            group.assignedAt = null;
            group.completedAt = new Date();
            group.inviteLink = null;
            await group.save();
            
            results.push(`⚠️ Group ${group.groupId}: Marked completed but NOT added to pool (users couldn't be removed)`);
            failedCount++;
          }
        } else if (escrow.status === 'draft' && group.assignedAt && 
                   (Date.now() - new Date(group.assignedAt).getTime()) > (24 * 60 * 60 * 1000)) {
          // Draft escrow older than 24 hours - clean up
          group.status = 'available';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = null;
          group.inviteLink = null;
          await group.save();
          
          // Mark escrow as completed to free user lock
          escrow.status = 'completed';
          await escrow.save();
          
          results.push(`🧹 Group ${group.groupId}: Cleaned up abandoned draft (24h+ old)`);
          recycledCount++;
        } else {
          results.push(`⏳ Group ${group.groupId}: Not eligible (escrow status: ${escrow.status})`);
        }

      } catch (error) {
        console.error(`Error recycling group ${group.groupId}:`, error);
        results.push(`❌ Group ${group.groupId}: Error during recycling`);
        failedCount++;
      }
    }

    // Send comprehensive results
    let resultMessage = `🔄 **COMPREHENSIVE GROUP RECYCLING COMPLETE**

📊 **Summary:**
• Total Groups Checked: ${eligibleGroups.length}
• Successfully Recycled: ${recycledCount}
• Failed/Issues: ${failedCount}

📋 **Detailed Results:**`;

    // Add first 10 results to avoid message length issues
    const displayResults = results.slice(0, 10);
    displayResults.forEach(result => {
      resultMessage += `\n${result}`;
    });

    if (results.length > 10) {
      resultMessage += `\n... and ${results.length - 10} more results`;
    }

    await ctx.reply(resultMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin recycle all:', error);
    ctx.reply('❌ Error during comprehensive recycling.');
  }
}

/**
 * Admin command to settle partial payment disputes
 */
async function adminSettlePartial(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('❌ Usage: /admin_settle_partial <escrowId>\nExample: /admin_settle_partial 507f1f77bcf86cd799439011');
    }

    const escrowId = args[1];
    const escrow = await Escrow.findOne({ 
      escrowId: escrowId,
      status: 'disputed',
      disputeReason: 'Seller reported receiving less money than expected'
    });

    if (!escrow) {
      return ctx.reply('❌ No partial payment dispute found with that escrow ID.');
    }

    // Mark escrow as completed
    escrow.status = 'completed';
    escrow.disputeResolution = 'resolved';
    escrow.completedAt = new Date();
    escrow.resolvedBy = ctx.from.id;
    await escrow.save();

    // Notify both parties
    const completionMessage = `✅ **PARTIAL PAYMENT DISPUTE RESOLVED**

🆔 **Escrow ID:** \`${escrow.escrowId}\`
📅 **Resolved:** ${new Date().toLocaleString()}
👨‍💼 **Resolved By:** Admin

The partial payment dispute has been resolved by admin intervention. All parties have been notified of the resolution.

Thank you for using our escrow service!`;

    // Send to buyer
    if (escrow.buyerId) {
      try {
        await ctx.telegram.sendMessage(escrow.buyerId, completionMessage);
      } catch (error) {
        console.log(`Could not send completion message to buyer ${escrow.buyerId}:`, error.message);
      }
    }

    // Send to seller
    if (escrow.sellerId) {
      try {
        await ctx.telegram.sendMessage(escrow.sellerId, completionMessage);
      } catch (error) {
        console.log(`Could not send completion message to seller ${escrow.sellerId}:`, error.message);
      }
    }

    // Send to group if exists
    if (escrow.groupId) {
      try {
        await ctx.telegram.sendMessage(escrow.groupId, completionMessage);
      } catch (error) {
        console.log(`Could not send completion message to group ${escrow.groupId}:`, error.message);
      }
    }

    // Trigger group recycling if it's a pool group
    try {
      const GroupPoolService = require('../services/GroupPoolService');
      await GroupPoolService.recycleGroupAfterCompletion(escrow, ctx.telegram);
    } catch (error) {
      console.log('Group recycling not applicable or failed:', error.message);
    }

    await ctx.reply(`✅ Partial payment dispute resolved successfully!\n\nEscrow ID: \`${escrow.escrowId}\`\nStatus: Completed\nResolved: ${new Date().toLocaleString()}`);

  } catch (error) {
    console.error('Error in admin settle partial:', error);
    ctx.reply('❌ Error settling partial payment dispute.');
  }
}
