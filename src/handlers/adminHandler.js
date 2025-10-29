const Escrow = require('../models/Escrow');
const BlockchainService = require('../services/BlockchainService');
const GroupPoolService = require('../services/GroupPoolService');
const AddressAssignmentService = require('../services/AddressAssignmentService');
const TradeTimeoutService = require('../services/TradeTimeoutService');
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
      disputeResolution: { $in: ['pending', 'refund_pending_address'] }
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

      // Verify buyer address is set
      if (!escrow.buyerAddress) {
        return ctx.reply('❌ Buyer address is not set for this escrow. Cannot proceed with release.');
      }

      // Verify token and network are set
      if (!escrow.token || !escrow.chain) {
        return ctx.reply('❌ Token or network not set for this escrow. Cannot proceed with release.');
      }

      // Execute the release
      const amount = escrow.confirmedAmount || escrow.depositAmount || 0;
      
      if (!amount || amount <= 0) {
        return ctx.reply('❌ Invalid amount. Cannot proceed with release.');
      }

      await BlockchainService.releaseFunds(
        escrow.token,
        escrow.chain,
        escrow.buyerAddress,
        amount
      );

      // Update escrow status after successful release
      escrow.disputeResolution = 'release';
      escrow.disputeResolvedBy = ctx.from.username || 'Admin';
      escrow.disputeResolvedAt = new Date();
      escrow.disputeResolutionReason = 'Admin resolved: Release to buyer';
      escrow.status = 'completed';
      await escrow.save();

      // Notify group of successful release
      try {
        await ctx.bot.telegram.sendMessage(
          escrow.groupId,
          `✅ *ADMIN RESOLUTION*\n\nEscrow ${escrow.escrowId} has been resolved by admin.\n\n💰 ${amount} ${escrow.token} released to buyer.\n\nResolved by: @${ctx.from.username || 'Admin'}`,
          { parse_mode: 'Markdown' }
        );

        // Send trade completion message with close trade button (same as normal release flow)
        await ctx.bot.telegram.sendMessage(
          escrow.groupId,
          `✅ The trade has been completed successfully!\n\nTo close this trade, click on the button below.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🔒 Close Trade',
                    callback_data: `close_trade_${escrow.escrowId}`
                  }
                ]
              ]
            }
          }
        );
      } catch (groupError) {
        console.error('Error notifying group:', groupError);
      }

      await ctx.reply(`✅ Successfully released ${amount} ${escrow.token} to buyer for escrow ${escrowId}.`);

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

    // Check if already resolved or in progress
    if (escrow.disputeResolution && escrow.disputeResolution !== 'pending' && escrow.disputeResolution !== 'refund_pending_address') {
      return ctx.reply('❌ This dispute has already been resolved.');
    }

    // If already waiting for address, inform admin
    if (escrow.disputeResolution === 'refund_pending_address') {
      return ctx.reply(`⚠️ Refund request already in progress. Waiting for seller to provide address for escrow ${escrowId}.`);
    }

    // Mark escrow as pending refund - waiting for seller address
    escrow.disputeResolution = 'refund_pending_address';
    escrow.disputeResolvedBy = ctx.from.username || 'Admin';
    escrow.disputeResolutionReason = 'Admin resolved: Refund to seller - waiting for seller address';
    await escrow.save();

    // Verify seller exists
    if (!escrow.sellerId) {
      return ctx.reply('❌ Seller ID is not set for this escrow. Cannot request refund address.');
    }

    // Verify token and network are set
    if (!escrow.token || !escrow.chain) {
      return ctx.reply('❌ Token or network not set for this escrow. Cannot proceed with refund.');
    }

    // Ask seller for their wallet address in the group
    const sellerTag = escrow.sellerUsername ? `@${escrow.sellerUsername}` : `[${escrow.sellerId}]`;
    
    const addressRequestMessage = `🔔 *ADMIN REFUND REQUEST*

Admin has approved a refund for this escrow.

📋 Escrow ID: \`${escrow.escrowId}\`
👤 Seller: ${sellerTag}
💰 Amount: ${escrow.confirmedAmount || escrow.depositAmount || 0} ${escrow.token}

💰 Please provide your wallet address where you want to receive the refund.

⚠️ **IMPORTANT**: 
• Make sure the address is correct for ${escrow.token} on ${escrow.chain}
• Double-check the address before confirming
• Wrong addresses cannot be reversed

Please reply with your wallet address in the group.`;

    try {
      // Send address request to the group
      await ctx.telegram.sendMessage(
        escrow.groupId,
        addressRequestMessage,
        { parse_mode: 'Markdown' }
      );

      await ctx.reply(`✅ Refund request sent to group. Waiting for seller to provide wallet address for escrow ${escrowId}.`);

    } catch (groupError) {
      console.error('Error sending address request to group:', groupError);
      await ctx.reply('❌ Error sending address request to group. Please check if the group still exists.');
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

/**
 * Admin command to show address pool statistics
 */
async function adminAddressPool(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const stats = await AddressAssignmentService.getAddressPoolStats();
    
    if (stats.length === 0) {
      return ctx.reply('📊 No addresses in pool. Run /admin_init_addresses to initialize.');
    }

    let message = `🏦 **ADDRESS POOL STATISTICS**\n\n`;

    stats.forEach(stat => {
      message += `**${stat.token} on ${stat.network}:**\n`;
      message += `• Total: ${stat.total}\n`;
      message += `• Available: ${stat.available}\n`;
      message += `• Assigned: ${stat.assigned}\n`;
      message += `• Busy: ${stat.busy}\n\n`;
    });

    await ctx.reply(message);

  } catch (error) {
    console.error('Error getting address pool stats:', error);
    ctx.reply('❌ Error loading address pool statistics.');
  }
}

/**
 * Admin command to initialize address pool
 */
async function adminInitAddresses(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    await ctx.reply('🚀 Initializing address pool...');
    
    const config = require('../../config');
    const feePercent = Number(config.ESCROW_FEE_PERCENT || 0);
    await AddressAssignmentService.initializeAddressPool(feePercent);
    
    await ctx.reply(`✅ Address pool initialized successfully for ${feePercent}% fee!`);

  } catch (error) {
    console.error('Error initializing address pool:', error);
    ctx.reply('❌ Error initializing address pool.');
  }
}

/**
 * Admin command to show timeout statistics
 */
async function adminTimeoutStats(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const stats = await TradeTimeoutService.getTimeoutStats();
    const abandonedTrades = await TradeTimeoutService.getAbandonedTrades();

    let message = `⏰ **TRADE TIMEOUT STATISTICS**\n\n`;
    message += `• Active Timeouts: ${stats.active}\n`;
    message += `• Expired Timeouts: ${stats.expired}\n`;
    message += `• Cancelled Timeouts: ${stats.cancelled}\n`;
    message += `• No Timeout Set: ${stats.null}\n\n`;
    
    if (abandonedTrades.length > 0) {
      message += `🚫 **ABANDONED TRADES (${abandonedTrades.length}):**\n\n`;
      abandonedTrades.slice(0, 5).forEach(trade => {
        const timeAgo = trade.abandonedAt ? 
          Math.floor((Date.now() - trade.abandonedAt) / (1000 * 60 * 60)) : 'Unknown';
        message += `• ${trade.escrowId} - ${timeAgo}h ago\n`;
      });
      
      if (abandonedTrades.length > 5) {
        message += `• ... and ${abandonedTrades.length - 5} more\n`;
      }
    }

    await ctx.reply(message);

  } catch (error) {
    console.error('Error getting timeout stats:', error);
    ctx.reply('❌ Error loading timeout statistics.');
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
  adminPoolDeleteAll,
  adminPoolDelete,
  adminHelp,
  adminTradeStats,
  adminExportTrades,
  adminRecentTrades,
  adminSettlePartial,
  adminAddressPool,
  adminInitAddresses,
  adminTimeoutStats,
  adminCleanupAddresses,
};

/**
 * Admin command to cleanup abandoned addresses
 */
async function adminCleanupAddresses(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    await ctx.reply('🧹 Cleaning up abandoned addresses...');
    
    const cleanedCount = await AddressAssignmentService.cleanupAbandonedAddresses();
    
    await ctx.reply(`✅ Cleaned up ${cleanedCount} abandoned addresses.`);

  } catch (error) {
    console.error('Error cleaning up addresses:', error);
    ctx.reply('❌ Error cleaning up abandoned addresses.');
  }
}

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
• \`/admin_recycle_groups\` - Manually recycle groups for completed/refunded escrows
• \`/admin_pool_delete <groupId>\` - Delete specific group from pool
• \`/admin_pool_delete_all\` - Delete ALL groups from pool (dangerous)

🔄 **AUTOMATIC GROUP RECYCLING:**
✅ **Automatic 15-minute delayed recycling** after trade completion
✅ **Automatic 1-hour timeout recycling** for abandoned trades

🧹 **MAINTENANCE:**

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
• Address pool status: \`/admin_address_pool\`
`;

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
      // Use confirmedAmount -> depositAmount -> quantity as fallback to avoid 0 totals
      const totalAmount = escrowsWithFee.reduce((sum, escrow) => {
        const c = parseFloat(escrow.confirmedAmount);
        const d = parseFloat(escrow.depositAmount);
        const q = parseFloat(escrow.quantity);
        const amt = (!isNaN(c) && c > 0)
          ? c
          : (!isNaN(d) && d > 0)
            ? d
            : (['completed', 'refunded'].includes(escrow.status) && !isNaN(q) && q > 0)
              ? q
              : 0;
        return sum + amt;
      }, 0);

      const tokenBreakdown = {};
      escrowsWithFee.forEach(escrow => {
        const token = escrow.token || 'Unknown';
        const c = parseFloat(escrow.confirmedAmount);
        const d = parseFloat(escrow.depositAmount);
        const q = parseFloat(escrow.quantity);
        const amount = (!isNaN(c) && c > 0)
          ? c
          : (!isNaN(d) && d > 0)
            ? d
            : (['completed', 'refunded'].includes(escrow.status) && !isNaN(q) && q > 0)
              ? q
              : 0;
        
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
      const c = parseFloat(escrow.confirmedAmount);
      const d = parseFloat(escrow.depositAmount);
      const q = parseFloat(escrow.quantity);
      const amt = (!isNaN(c) && c > 0)
        ? c
        : (!isNaN(d) && d > 0)
          ? d
          : (!isNaN(q) && q > 0)
            ? q
            : 0;
      return sum + amt;
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
      .sort({ createdAt: -1 }); // Most recent first

    if (allEscrows.length === 0) {
      return ctx.reply('📊 No trades found in the database.');
    }

    // CSV-safe helper
    const csvSafe = (v) => {
      const s = String(v == null ? '' : v);
      const escaped = s.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    // Create organized CSV content with clear sections
    let csvContent = `# ESCROW TRADES EXPORT
# Generated: ${new Date().toLocaleString()}
# Total Trades: ${allEscrows.length}
#
# COLUMNS:
# ID, Status, Created Date, Token, Network, Quantity, Rate, Buyer, Seller, Dispute Reason, Completed Date
#
# DATA:
`;
    
    allEscrows.forEach((escrow, index) => {
      const buyerName = escrow.buyerUsername ? `@${escrow.buyerUsername}` : (escrow.buyerId ? `[${escrow.buyerId}]` : 'Not Set');
      const sellerName = escrow.sellerUsername ? `@${escrow.sellerUsername}` : (escrow.sellerId ? `[${escrow.sellerId}]` : 'Not Set');

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
      const quantity = typeof escrow.quantity === 'number' ? escrow.quantity : (parseFloat(escrow.quantity) || 0);
      const rate = (escrow.rate != null && escrow.rate !== '') ? escrow.rate : '';

      // Add separator for readability
      if (index > 0) {
        csvContent += `\n`;
      }

      const buyerOut = buyerName || (escrow.buyerId ? `[${escrow.buyerId}]` : 'Unknown');
      const sellerOut = sellerName || (escrow.sellerId ? `[${escrow.sellerId}]` : 'Unknown');

      csvContent += [
        csvSafe(escrow._id),
        csvSafe(escrow.status),
        csvSafe(createdDate),
        csvSafe(escrow.token || 'N/A'),
        csvSafe(escrow.chain || 'N/A'),
        csvSafe(quantity),
        csvSafe(rate),
        csvSafe(buyerOut),
        csvSafe(sellerOut),
        csvSafe(disputeReason),
        csvSafe(completedDate)
      ].join(',');
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

    // Get recent trades - only necessary statuses
    const recentTrades = await Escrow.find({
        status: { $in: ['completed', 'refunded', 'disputed'] }
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('buyerId', 'username first_name')
      .populate('sellerId', 'username first_name');

    if (recentTrades.length === 0) {
      return ctx.reply('📊 No trades found in the database.');
    }

    // Helper to escape HTML (preserve numeric 0)
    const esc = (s) => {
      const v = (s === 0) ? '0' : String(s == null ? '' : s);
      return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    let message = `📊 <b>RECENT TRADES (${recentTrades.length})</b>\n\n`;

    recentTrades.forEach((escrow, index) => {
      // Prefer stored usernames on escrow, fallback to IDs
      const buyerName = escrow.buyerUsername ? `@${escrow.buyerUsername}` : (escrow.buyerId ? `[${escrow.buyerId}]` : 'Not Set');
      const sellerName = escrow.sellerUsername ? `@${escrow.sellerUsername}` : (escrow.sellerId ? `[${escrow.sellerId}]` : 'Not Set');

      const c = parseFloat(escrow.confirmedAmount);
      const d = parseFloat(escrow.depositAmount);
      const q = parseFloat(escrow.quantity);
      const amount = (!isNaN(c) && c > 0)
        ? c
        : (!isNaN(d) && d > 0)
          ? d
          : (!isNaN(q) && q > 0)
            ? q
            : 0;
      const statusEmoji = {
        'completed': '✅',
        'refunded': '🔄',
        'disputed': '⚠️',
        'draft': '📝',
        'awaiting_details': '⏳'
      }[escrow.status] || '❓';

      const amountText = amount > 0
        ? `${esc(amount)} ${esc(escrow.token || 'N/A')}`
        : `— ${esc(escrow.token || 'N/A')} (no on-chain amount)`;

      message += `${index + 1}. ${statusEmoji} <b>${escrow.status.toUpperCase()}</b>\n`;
      message += `   💰 ${amountText} (${esc(escrow.chain || 'N/A')})\n`;
      message += `   👤 Buyer: ${esc(buyerName)}\n`;
      message += `   🏪 Seller: ${esc(sellerName)}\n`;
      message += `   📅 ${esc(new Date(escrow.createdAt).toLocaleString())}\n`;
      message += `   🆔 ID: <code>${esc(escrow._id)}</code>\n\n`;
    });

    message += `💡 <b>Commands:</b>\n`;
    message += `• <code>/admin_recent_trades 20</code> - Show 20 recent trades\n`;
    message += `• <code>/admin_export_trades</code> - Export all trades to CSV\n`;
    message += `• <code>/admin_trade_stats</code> - View statistics by fee percentage`;

    await ctx.reply(message, { parse_mode: 'HTML' });

  } catch (error) {
    console.error('Error in admin recent trades:', error);
    ctx.reply('❌ Error loading recent trades.');
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

    // REMOVED: No longer sending DM messages to users, only in-group messages
    // Messages should only be sent within the group chat

    // Send to group if exists
    if (escrow.groupId) {
      try {
        await ctx.telegram.sendMessage(escrow.groupId, completionMessage);
      } catch (error) {
      }
    }

    // Trigger group recycling if it's a pool group
    try {
      const GroupPoolService = require('../services/GroupPoolService');
      await GroupPoolService.recycleGroupAfterCompletion(escrow, ctx.telegram);
    } catch (error) {
    }

    await ctx.reply(`✅ Partial payment dispute resolved successfully!\n\nEscrow ID: \`${escrow.escrowId}\`\nStatus: Completed\nResolved: ${new Date().toLocaleString()}`);

  } catch (error) {
    console.error('Error in admin settle partial:', error);
    ctx.reply('❌ Error settling partial payment dispute.');
  }
}

/**
 * Admin command to manually recycle groups that meet criteria
 * Recycles groups for escrows that are completed, refunded, or disputed (resolved)
 */
async function adminRecycleGroups(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    // Find escrows that should have their groups recycled
    const escrowsToRecycle = await Escrow.find({
      status: { $in: ['completed', 'refunded'] },
      assignedFromPool: true, // Only pool groups
      groupId: { $ne: null }
    });

    if (escrowsToRecycle.length === 0) {
      return ctx.reply('✅ No groups eligible for recycling found.');
    }

    let recycledCount = 0;
    let failedCount = 0;

    for (const escrow of escrowsToRecycle) {
      try {
        // Release deposit address first
        await AddressAssignmentService.releaseDepositAddress(escrow.escrowId);

        // Recycle the group
        await GroupPoolService.recycleGroupAfterCompletion(escrow, ctx.telegram);
        recycledCount++;
      } catch (error) {
        console.error(`Error recycling group for escrow ${escrow.escrowId}:`, error);
        failedCount++;
      }
    }

    const message = `✅ Group Recycling Complete

📊 Statistics:
• Eligible groups: ${escrowsToRecycle.length}
• Successfully recycled: ${recycledCount}
• Failed: ${failedCount}

${recycledCount > 0 ? '✅ Groups have been recycled and addresses released back to pool.' : ''}`;

    await ctx.reply(message);

  } catch (error) {
    console.error('Error in admin recycle groups:', error);
    ctx.reply('❌ Error recycling groups.');
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
  adminWarnInactive,
  adminRemoveInactive,
  adminAddressPool,
  adminInitAddresses,
  adminTimeoutStats,
  adminCleanupAddresses,
  adminPoolDeleteAll,
  adminPoolDelete,
  adminHelp,
  adminTradeStats,
  adminExportTrades,
  adminRecentTrades,
  adminSettlePartial,
  adminRecycleGroups
};
