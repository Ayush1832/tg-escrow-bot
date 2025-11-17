const Escrow = require('../models/Escrow');
const GroupPool = require('../models/GroupPool');
const Contract = require('../models/Contract');
const BlockchainService = require('../services/BlockchainService');
const GroupPoolService = require('../services/GroupPoolService');
const AddressAssignmentService = require('../services/AddressAssignmentService');
// TradeTimeoutService removed - no longer needed
const { isAdmin } = require('../middleware/adminAuth');
const config = require('../../config');

/**
 * Admin stats - view escrow statistics
 */
async function adminStats(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const totalEscrows = await Escrow.countDocuments({});
    const activeEscrows = await Escrow.countDocuments({ 
      status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'] }
    });
    const completedEscrows = await Escrow.countDocuments({ 
      status: 'completed' 
    });
    const refundedEscrows = await Escrow.countDocuments({ 
      status: 'refunded' 
    });

    const statsMessage = `
📊 *ADMIN STATISTICS*

📈 *Escrows:*
• Total: ${totalEscrows}
• Active: ${activeEscrows}
• Completed: ${completedEscrows}
• Refunded: ${refundedEscrows}
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

    await GroupPoolService.addGroup(groupId, null, ctx.telegram);
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
    
    if (!stats.singleAddress) {
      return ctx.reply('📊 No deposit address configured. Please set HOT_WALLET_PRIVATE_KEY in config.');
    }

    let message = `🏦 **DEPOSIT ADDRESS**\n\n`;
    message += `📍 Single Address (All Tokens):\n\`${stats.singleAddress}\`\n\n`;
    message += `ℹ️ This address accepts deposits for all tokens and networks.\n`;
    message += `Transaction hashes are validated to ensure unique deposits.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error getting address pool stats:', error);
    ctx.reply('❌ Error loading address pool statistics.');
  }
}

/**
 * Admin command to verify deployed contracts
 * (Previously: initialize address pool - now obsolete, replaced by contract verification)
 */
async function adminInitAddresses(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
    
    // Find all deployed EscrowVault contracts
    const contracts = await Contract.find({ 
      name: 'EscrowVault',
      status: 'deployed'
    }).sort({ network: 1, token: 1 });

    if (contracts.length === 0) {
      return ctx.reply(
        `❌ No EscrowVault contracts found in database.\n\n` +
        `⚠️ Please deploy contracts using:\n` +
        `\`npm run deploy\`\n\n` +
        `This will deploy USDT and USDC contracts on BSC with ${desiredFeePercent}% fee.`
      );
    }

    // Group contracts by network and filter by fee
    const contractsByNetwork = {};
    const requiredTokens = ['USDT', 'USDC'];
    
    contracts.forEach(contract => {
      if (!contractsByNetwork[contract.network]) {
        contractsByNetwork[contract.network] = [];
      }
      contractsByNetwork[contract.network].push(contract);
    });

    let message = `📋 **CONTRACT VERIFICATION**\n\n`;
    message += `💰 Fee Percent: ${desiredFeePercent}%\n\n`;
    
    // Check BSC contracts specifically
    const bscContracts = contracts.filter(c => c.network === 'BSC' && c.feePercent === desiredFeePercent);
    const bscTokens = bscContracts.map(c => c.token);
    
    message += `🔗 **BSC Contracts:**\n`;
    if (bscContracts.length === 0) {
      message += `❌ No BSC contracts found with ${desiredFeePercent}% fee\n`;
    } else {
      bscContracts.forEach(contract => {
        const deployedDate = contract.deployedAt ? new Date(contract.deployedAt).toLocaleString() : 'Unknown';
        message += `✅ ${contract.token}: \`${contract.address}\`\n`;
        message += `   📅 Deployed: ${deployedDate}\n`;
      });
    }
    
    // Check for missing required tokens
    const missingTokens = requiredTokens.filter(token => !bscTokens.includes(token));
    if (missingTokens.length > 0) {
      message += `\n⚠️ **Missing Tokens:** ${missingTokens.join(', ')}\n`;
      message += `Please deploy missing contracts.\n`;
    } else {
      message += `\n✅ All required tokens (${requiredTokens.join(', ')}) are deployed.\n`;
    }

    // Show contracts for other networks if any
    const otherNetworks = Object.keys(contractsByNetwork).filter(n => n !== 'BSC');
    if (otherNetworks.length > 0) {
      message += `\n📡 **Other Networks:**\n`;
      otherNetworks.forEach(network => {
        const networkContracts = contractsByNetwork[network];
        message += `• ${network}: ${networkContracts.length} contract(s)\n`;
      });
    }

    message += `\n💡 **Note:** Address pool initialization is no longer needed. The system uses EscrowVault contracts directly.`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error verifying contracts:', error);
    ctx.reply('❌ Error verifying contracts. Please check the logs.');
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

    return ctx.reply('❌ Trade timeout functionality has been removed. This command is no longer available.');

  } catch (error) {
    console.error('Error getting timeout stats:', error);
    ctx.reply('❌ Error loading timeout statistics.');
  }
}



/**
 * Admin command to cleanup abandoned addresses
 */
async function adminCleanupAddresses(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    await ctx.reply('🧹 Cleaning up abandoned addresses...');
    
    await ctx.reply('ℹ️ Address cleanup is no longer needed. Addresses are managed via EscrowVault contracts.');

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

📊 **STATISTICS:**
• \`/admin_stats\` - View escrow statistics
• \`/admin_trade_stats\` - View comprehensive trade statistics by fee percentage
• \`/admin_recent_trades [limit]\` - View recent trades (max 50)
• \`/admin_export_trades\` - Export all trades to CSV file

🏊‍♂️ **GROUP POOL MANAGEMENT:**
• \`/admin_pool\` - View group pool status and statistics
• \`/admin_pool_add <groupId>\` - Add group to pool
• \`/admin_pool_list\` - List all groups in pool
• \`/admin_recycle_groups\` - Manually recycle groups for completed/refunded escrows
• \`/admin_group_reset\` - Reset group when no deposits were made (removes users, recycles group)
• \`/admin_reset_force\` - Force reset group regardless of status (removes users, recycles group)
• \`/admin_pool_delete <groupId>\` - Delete specific group from pool
• \`/admin_pool_delete_all\` - Delete ALL groups from pool (dangerous)

🔄 **AUTOMATIC GROUP RECYCLING:**
✅ **Automatic 15-minute delayed recycling** after trade completion

🧹 **MAINTENANCE:**
• \`/admin_address_pool\` - View address pool status
• \`/admin_init_addresses\` - Verify deployed EscrowVault contracts
• \`/admin_cleanup_addresses\` - Cleanup abandoned addresses
• \`/admin_timeout_stats\` - View timeout statistics

📋 **AUTOMATIC FEATURES:**
✅ **Group Recycling**: Automatic 15-minute delayed recycling after trade completion
✅ **User Management**: Automatic user removal after recycling delay
✅ **Pool Management**: Automatic group status updates

💡 **TIPS:**
• Most operations are automatic - no manual intervention needed
• Use manual commands only for special cases or maintenance
• Group recycling happens automatically with 15-minute delay

🔧 **QUICK REFERENCE:**
• Pool status: \`/admin_pool\`
• Recent trades: \`/admin_recent_trades 20\`
• Export all trades: \`/admin_export_trades\`
• Trade statistics: \`/admin_trade_stats\`
• Address pool status: \`/admin_address_pool\`

💰 **SETTLEMENT COMMANDS (in groups):**
• \`/release\` - Release funds to buyer (admin only)
• \`/refund\` - Refund funds to seller (admin only)
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
    statsMessage += `📅 **Last Updated:** ${new Date().toLocaleString()}`;

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
# ID, Status, Created Date, Token, Network, Quantity, Rate, Buyer, Seller, Completed Date
#
# DATA:
`;
    
    allEscrows.forEach((escrow, index) => {
      const buyerName = escrow.buyerUsername ? `@${escrow.buyerUsername}` : (escrow.buyerId ? `[${escrow.buyerId}]` : 'Not Set');
      const sellerName = escrow.sellerUsername ? `@${escrow.sellerUsername}` : (escrow.sellerId ? `[${escrow.sellerId}]` : 'Not Set');

      const dealDetails = escrow.dealDetails ? 
        escrow.dealDetails.replace(/\n/g, ' | ').replace(/,/g, ';') : 
        'Not Set';

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
        status: { $in: ['completed', 'refunded'] }
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
      let amount = 0;
      let amountSource = 'none';
      if (!isNaN(c) && c > 0) {
        amount = c; amountSource = 'confirmed';
      } else if (!isNaN(d) && d > 0) {
        amount = d; amountSource = 'deposit';
      } else if (!isNaN(q) && q > 0 && ['completed','refunded'].includes(escrow.status)) {
        // Safe backfill from deal quantity for finalized trades
        amount = q; amountSource = 'quantity';
      }
      const statusEmoji = {
        'completed': '✅',
        'refunded': '🔄',
        'draft': '📝',
        'awaiting_details': '⏳'
      }[escrow.status] || '❓';

      const amountNote = amountSource === 'quantity' ? ' (backfilled from quantity)' : '';
      const amountText = amount > 0
        ? `${esc(amount)} ${esc(escrow.token || 'N/A')}${amountNote}`
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
 * Admin command to manually recycle groups that meet criteria
 * Recycles groups for escrows that are completed or refunded
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

/**
 * Admin group reset - Reset a group when no deposits were made
 * Only works if escrow has no deposits (status: draft, awaiting_details, or awaiting_deposit)
 * and depositAmount/confirmedAmount are 0
 */
async function adminGroupReset(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const chatId = ctx.chat.id;

    // Must be in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a group chat.');
    }

    // Delete command message after 1 minute
    const commandMsgId = ctx.message.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, commandMsgId);
      } catch (e) {
        // Ignore errors (message may already be deleted)
      }
    }, 60 * 1000);

    // First, try to find the group in pool to get assignedEscrowId
    let group = await GroupPool.findOne({ groupId: chatId.toString() });
    
    // Find active escrow for this group
    let escrow = null;
    
    if (group && group.assignedEscrowId) {
      // Try to find escrow by assignedEscrowId first
      escrow = await Escrow.findOne({
        escrowId: group.assignedEscrowId,
        status: { $nin: ['completed', 'refunded'] }
      });
    }
    
    // If not found, try to find by groupId
    if (!escrow) {
      escrow = await Escrow
        .findOne({
          groupId: chatId.toString(),
          status: { $nin: ['completed', 'refunded'] }
        })
        .sort({ createdAt: -1 });
    }

    if (!escrow) {
      const errorMsg = await ctx.reply('❌ No escrow found for this group.');
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);
      return;
    }

    // Verify status is in allowed states (must be before deposit check)
    const allowedStatuses = ['draft', 'awaiting_details', 'awaiting_deposit'];
    if (!allowedStatuses.includes(escrow.status)) {
      const errorMsg = await ctx.reply('❌ Cannot reset: Trade has already started. Only reset before deposits.');
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);
      return;
    }

    // Check if deposits were made (amount-based check, since status is already validated)
    const depositAmount = Number(escrow.depositAmount || 0);
    const confirmedAmount = Number(escrow.confirmedAmount || 0);
    const hasDeposit = depositAmount > 0 || confirmedAmount > 0;

    if (hasDeposit) {
      const errorMsg = await ctx.reply('❌ Cannot reset: Deposits were made. Use /release or /refund to settle.');
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);
      return;
    }

    // Find the group in pool (we may have already found it above)
    if (!group) {
      group = await GroupPool.findOne({ 
        assignedEscrowId: escrow.escrowId 
      });
    }

    if (!group) {
      group = await GroupPool.findOne({ groupId: chatId.toString() });
    }

    if (!group) {
      const errorMsg = await ctx.reply('❌ Group not found in pool.');
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);
      return;
    }

    const processingMsg = await ctx.reply('🔄 Resetting group...');
    // Delete processing message after 1 minute
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, processingMsg.message_id);
      } catch (e) {
        // Ignore errors (message may already be deleted)
      }
    }, 60 * 1000);

    try {
      // Remove buyer and seller from group
      const allUsersRemoved = await GroupPoolService.removeUsersFromGroup(escrow, group.groupId, ctx.telegram);

      if (!allUsersRemoved) {
        const errorMsg = await ctx.reply('⚠️ Some users could not be removed from the group. Please check manually.');
        // Delete error message after 1 minute
        setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
          } catch (e) {}
        }, 60 * 1000);
        return;
      }


      // Refresh invite link (revoke old and create new) so removed users can rejoin
      await GroupPoolService.refreshInviteLink(group.groupId, ctx.telegram);

      // Reset group pool entry
      group.status = 'available';
      group.assignedEscrowId = null;
      group.assignedAt = null;
      group.completedAt = null;
      await group.save();

      // Delete the escrow since no deposits were made
      // Note: If deletion fails, the group is already reset and available.
      // The old escrow won't cause issues since it has no deposits and the group is available.
      try {
        await Escrow.deleteOne({ escrowId: escrow.escrowId });
      } catch (deleteError) {
        console.error('Error deleting escrow after group reset:', deleteError);
        // Continue anyway - group is already reset and available
      }

      const successMsg = await ctx.reply('✅ Group reset successfully. Ready for new deals.');
      // Delete success message after 1 minute
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, successMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);

    } catch (error) {
      console.error('Error resetting group:', error);
      const errorMsg = await ctx.reply('❌ Error resetting group. Please check the logs.');
      // Delete error message after 1 minute
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);
    }

  } catch (error) {
    console.error('Error in admin group reset:', error);
    const errorMsg = await ctx.reply('❌ Error resetting group.');
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, errorMsg.message_id);
      } catch (e) {}
    }, 60 * 1000);
  }
}

/**
 * Force reset group - resets group regardless of trade status or deposits
 * Removes buyer and seller, recycles group back to pool
 */
async function adminResetForce(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const chatId = ctx.chat.id;

    // Must be in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a group chat.');
    }

    // Delete command message after 1 minute
    const commandMsgId = ctx.message.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, commandMsgId);
      } catch (e) {
        // Ignore errors (message may already be deleted)
      }
    }, 60 * 1000);

    // First, try to find the group in pool to get assignedEscrowId
    let group = await GroupPool.findOne({ groupId: chatId.toString() });
    
    // Find active escrow for this group
    let escrow = null;
    
    if (group && group.assignedEscrowId) {
      // Try to find escrow by assignedEscrowId first
      escrow = await Escrow.findOne({
        escrowId: group.assignedEscrowId,
        status: { $nin: ['completed', 'refunded'] }
      });
    }
    
    // If not found, try to find by groupId
    if (!escrow) {
      escrow = await Escrow
        .findOne({
          groupId: chatId.toString(),
          status: { $nin: ['completed', 'refunded'] }
        })
        .sort({ createdAt: -1 });
    }

    if (!escrow) {
      const errorMsg = await ctx.reply('❌ No escrow found for this group.');
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);
      return;
    }

    // Find the group in pool (we may have already found it above)
    if (!group) {
      group = await GroupPool.findOne({ 
        assignedEscrowId: escrow.escrowId 
      });
    }

    if (!group) {
      group = await GroupPool.findOne({ groupId: chatId.toString() });
    }

    if (!group) {
      const errorMsg = await ctx.reply('❌ Group not found in pool.');
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);
      return;
    }

    const processingMsg = await ctx.reply('🔄 Force resetting group...');
    // Delete processing message after 1 minute
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, processingMsg.message_id);
      } catch (e) {
        // Ignore errors (message may already be deleted)
      }
    }, 60 * 1000);

    try {
      // Remove buyer and seller from group (not admin)
      const allUsersRemoved = await GroupPoolService.removeUsersFromGroup(escrow, group.groupId, ctx.telegram);

      if (!allUsersRemoved) {
        console.log('⚠️ Some users could not be removed during force reset, continuing anyway...');
      }

      // Clear escrow invite link (but keep group invite link - it's permanent)
      escrow.inviteLink = null;
      await escrow.save();


      // Refresh invite link (revoke old and create new) so removed users can rejoin
      await GroupPoolService.refreshInviteLink(group.groupId, ctx.telegram);

      // Reset group pool entry
      group.status = 'available';
      group.assignedEscrowId = null;
      group.assignedAt = null;
      group.completedAt = null;
      await group.save();

      // Delete the escrow (force reset - regardless of status or deposits)
      try {
        await Escrow.deleteOne({ escrowId: escrow.escrowId });
      } catch (deleteError) {
        console.error('Error deleting escrow during force reset:', deleteError);
        // Continue anyway - group is already reset and available
      }

      const successMsg = await ctx.reply('✅ Group force reset successfully. Ready for new deals.');
      // Delete success message after 1 minute
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, successMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);

    } catch (error) {
      console.error('Error force resetting group:', error);
      const errorMsg = await ctx.reply('❌ Error force resetting group. Please check the logs.');
      // Delete error message after 1 minute
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
        } catch (e) {}
      }, 60 * 1000);
    }

  } catch (error) {
    console.error('Error in admin force reset:', error);
    const errorMsg = await ctx.reply('❌ Error force resetting group.');
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, errorMsg.message_id);
      } catch (e) {}
    }, 60 * 1000);
  }
}

module.exports = {
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
  adminAddressPool,
  adminInitAddresses,
  adminTimeoutStats,
  adminCleanupAddresses,
  adminRecycleGroups,
  adminGroupReset,
  adminResetForce
};
