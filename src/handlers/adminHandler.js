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

    // Count active escrows (ongoing/pending trades)
    const activeEscrows = await Escrow.countDocuments({ 
      status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'] }
    });

    // Only count fully completed escrows (with transaction hashes proving actual completion)
    const completedEscrows = await Escrow.countDocuments({ 
      status: 'completed',
      releaseTransactionHash: { $exists: true, $ne: null, $ne: '' }
    });

    // Only count fully refunded escrows (with transaction hashes proving actual refund)
    const refundedEscrows = await Escrow.countDocuments({ 
      status: 'refunded',
      refundTransactionHash: { $exists: true, $ne: null, $ne: '' }
    });

    // Total = only completed + refunded (fully finished trades)
    const totalEscrows = completedEscrows + refundedEscrows;

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
        const title = group.groupTitle || 'Unknown';
        message += `• ${title}\n`;
      });
      message += '\n';
    }

    if (assignedGroups.length > 0) {
      message += `🟡 *Assigned (${assignedGroups.length}):*\n`;
      assignedGroups.forEach(group => {
        const title = group.groupTitle || 'Unknown';
        message += `• ${title} - Escrow: ${group.assignedEscrowId}\n`;
      });
      message += '\n';
    }

    if (completedGroups.length > 0) {
      message += `🔵 *Completed (${completedGroups.length}):*\n`;
      completedGroups.forEach(group => {
        const title = group.groupTitle || 'Unknown';
        const completedAgo = group.completedAt 
          ? Math.floor((Date.now() - group.completedAt) / (1000 * 60 * 60))
          : 'Unknown';
        message += `• ${title} - ${completedAgo}h ago\n`;
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
• \`/admin_group_reset\` - Reset group when no deposits were made (removes users, recycles group)
• \`/admin_reset_force\` - Force reset group regardless of status (removes users, recycles group)
• \`/admin_reset_all_groups\` - Force reset ALL groups at once (ignores escrows, removes users, recycles all)
• \`/admin_pool_delete <groupId>\` - Delete specific group from pool
• \`/admin_pool_delete_all\` - Delete ALL groups from pool (dangerous)

🔄 **AUTOMATIC GROUP RECYCLING:**
✅ **Automatic 15-minute delayed recycling** after trade completion

🧹 **MAINTENANCE:**
• \`/admin_address_pool\` - View address pool status
• \`/admin_init_addresses\` - Verify deployed EscrowVault contracts
• \`/admin_cleanup_addresses\` - Cleanup abandoned addresses

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

    // Get all fully completed and refunded escrows
    // Include all trades marked as completed/refunded (we'll filter for valid amounts later)
    // Prefer trades with transaction hashes, but include all completed/refunded trades
    const completedEscrows = await Escrow.find({
      status: { $in: ['completed', 'refunded'] }
    });

    // Get all contracts to understand fee structures
    const Contract = require('../models/Contract');
    const contracts = await Contract.find({ name: 'EscrowVault' });

    // Helper function to get the settled amount for a completed/refunded escrow
    // For completed/refunded trades, deposit amounts are zeroed, so we use quantity as source of truth
    const getSettledAmount = (escrow) => {
      // For completed/refunded trades, use quantity (the original agreed amount)
      // This is the most reliable since deposit amounts are zeroed after completion
      if (escrow.status === 'completed' || escrow.status === 'refunded') {
        const q = parseFloat(escrow.quantity);
        if (!isNaN(q) && q > 0) {
          return q;
        }
      }
      // Fallback for edge cases (shouldn't happen for completed/refunded with transaction hashes)
      const c = parseFloat(escrow.confirmedAmount);
      const d = parseFloat(escrow.depositAmount);
      const q = parseFloat(escrow.quantity);
      return (!isNaN(c) && c > 0)
        ? c
        : (!isNaN(d) && d > 0)
          ? d
          : (!isNaN(q) && q > 0)
            ? q
            : 0;
    };

    // Filter out escrows with zero or invalid amounts (only count actual completed trades)
    // Also prefer trades with transaction hashes (proving actual blockchain completion)
    // This must be done before the fee percentage loop
    const validCompletedEscrows = completedEscrows.filter(escrow => {
      const amt = getSettledAmount(escrow);
      if (amt <= 0) {
        return false; // Exclude escrows with invalid amounts
      }
      
      // Prefer trades with transaction hashes (more reliable)
      // But include all trades with valid amounts to ensure we don't miss any
      const hasReleaseHash = escrow.status === 'completed' && 
                             escrow.releaseTransactionHash && 
                             escrow.releaseTransactionHash.trim() !== '';
      const hasRefundHash = escrow.status === 'refunded' && 
                            escrow.refundTransactionHash && 
                            escrow.refundTransactionHash.trim() !== '';
      
      // Include if it has a transaction hash OR if it has a valid quantity (for edge cases)
      return hasReleaseHash || hasRefundHash || (escrow.quantity && escrow.quantity > 0);
    });

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
      // Use validCompletedEscrows instead of completedEscrows to ensure we only count valid trades
      const escrowsWithFee = validCompletedEscrows.filter(escrow => {
        // This is a simplified approach - in reality, you'd need to track which contract was used
        // For now, we'll use the current ESCROW_FEE_PERCENT from config
        const currentFee = Number(config.ESCROW_FEE_PERCENT || 0);
        return currentFee.toString() === feePercent;
      });

      const totalTrades = escrowsWithFee.length;
      // Use getSettledAmount helper for consistent amount calculation
      const totalAmount = escrowsWithFee.reduce((sum, escrow) => {
        return sum + getSettledAmount(escrow);
      }, 0);

      const tokenBreakdown = {};
      escrowsWithFee.forEach(escrow => {
        const token = escrow.token || 'Unknown';
        const amount = getSettledAmount(escrow);
        
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

    // Calculate overall statistics using only valid completed escrows
    const totalTrades = validCompletedEscrows.length;
    const totalAmount = validCompletedEscrows.reduce((sum, escrow) => {
      return sum + getSettledAmount(escrow);
    }, 0);

    const completedCount = validCompletedEscrows.filter(e => e.status === 'completed').length;
    const refundedCount = validCompletedEscrows.filter(e => e.status === 'refunded').length;

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

    // Get all fully completed/refunded escrows with transaction hashes only
    // Transaction hash must exist and be a non-empty string
    const allEscrows = await Escrow.find({
        $or: [
          { 
            status: 'completed',
            releaseTransactionHash: { $exists: true, $ne: null, $ne: '' }
          },
          { 
            status: 'refunded',
            refundTransactionHash: { $exists: true, $ne: null, $ne: '' }
          }
        ]
      })
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

    // Get recent trades - only fully completed/refunded trades with transaction hashes
    // Transaction hash must exist and be a non-empty string
    const recentTrades = await Escrow.find({
        $or: [
          { 
            status: 'completed',
            releaseTransactionHash: { $exists: true, $ne: null, $ne: '' }
          },
          { 
            status: 'refunded',
            refundTransactionHash: { $exists: true, $ne: null, $ne: '' }
          }
        ]
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
    
    // Find escrow for this group (any status)
    let escrow = null;
    
    if (group && group.assignedEscrowId) {
      // Try to find escrow by assignedEscrowId first
      escrow = await Escrow.findOne({
        escrowId: group.assignedEscrowId
      });
    }
    
    // If not found, try to find the most recent escrow by groupId
    if (!escrow) {
      escrow = await Escrow
        .findOne({
          groupId: chatId.toString()
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

    // Only check for deposits if trade is NOT completed/refunded
    // If trade is completed, allow reset to clean up the group
    const isCompleted = ['completed', 'refunded'].includes(escrow.status);
    if (!isCompleted) {
      // Check if deposits were made (only for active trades)
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
      // Unpin the deal confirmed message if it exists
      if (escrow.dealConfirmedMessageId) {
        try {
          await ctx.telegram.unpinChatMessage(chatId, escrow.dealConfirmedMessageId);
        } catch (unpinError) {
          // Ignore errors (message may already be unpinned or deleted)
        }
      }

      // Remove buyer and seller from group
      const allUsersRemoved = await GroupPoolService.removeUsersFromGroup(escrow, group.groupId, ctx.telegram);

      // For completed trades, continue even if some users can't be removed
      // For active trades, be more strict
      if (!allUsersRemoved && !isCompleted) {
        const errorMsg = await ctx.reply('⚠️ Some users could not be removed from the group. Please check manually.');
        // Delete error message after 1 minute
        setTimeout(async () => {
      try {
            await ctx.telegram.deleteMessage(chatId, errorMsg.message_id);
          } catch (e) {}
        }, 60 * 1000);
        return;
    }

      // For completed trades, log warning but continue
      if (!allUsersRemoved && isCompleted) {
        console.log('⚠️ Some users could not be removed during reset of completed trade, continuing anyway...');
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
    
    // Find escrow for this group (any status)
    let escrow = null;
    
    if (group && group.assignedEscrowId) {
      // Try to find escrow by assignedEscrowId first
      escrow = await Escrow.findOne({
        escrowId: group.assignedEscrowId
      });
    }
    
    // If not found, try to find by groupId (most recent escrow)
    if (!escrow) {
      escrow = await Escrow
        .findOne({
          groupId: chatId.toString()
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
      // Unpin the deal confirmed message if it exists
      if (escrow.dealConfirmedMessageId) {
        try {
          await ctx.telegram.unpinChatMessage(chatId, escrow.dealConfirmedMessageId);
        } catch (unpinError) {
          // Ignore errors (message may already be unpinned or deleted)
        }
      }

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

/**
 * Admin reset all groups - Force reset ALL groups in the pool at once
 * Ignores escrow status and deposits - resets everything
 * Processes groups in background to avoid timeout
 */
async function adminResetAllGroups(ctx) {
  try {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ Access denied. Admin privileges required.');
    }

    const processingMsg = await ctx.reply('🔄 Resetting all groups... This may take a while.');
    
    // Store telegram instance and message info for background processing
    const telegram = ctx.telegram;
    const chatId = ctx.chat.id;
    const messageId = processingMsg.message_id;

    // Process groups in background to avoid timeout
    (async () => {
      try {
        // Get all groups from pool
        const allGroups = await GroupPool.find({});
        
        if (!allGroups || allGroups.length === 0) {
          await telegram.editMessageText(
            chatId,
            messageId,
            null,
            '❌ No groups found in pool.'
          );
          setTimeout(async () => {
            try {
              await telegram.deleteMessage(chatId, messageId);
            } catch (e) {}
          }, 60 * 1000);
          return;
        }

        let successCount = 0;
        let failCount = 0;
        const results = [];

        // Helper function to update progress
        const updateProgress = async (current, total) => {
          try {
            const progressText = `🔄 Resetting all groups...\n\n📊 Progress: ${current}/${total} groups processed\n✅ Successful: ${successCount}\n❌ Failed: ${failCount}`;
            await telegram.editMessageText(
              chatId,
              messageId,
              null,
              progressText
            );
          } catch (e) {
            // Ignore edit errors - message might be deleted or edited too frequently
          }
        };

        // Process each group
        for (let i = 0; i < allGroups.length; i++) {
          const group = allGroups[i];
          const groupId = group.groupId;

          // Update progress every 5 groups or on last group
          if ((i + 1) % 5 === 0 || i === allGroups.length - 1) {
            await updateProgress(i + 1, allGroups.length);
          }

          try {
            // Find associated escrow (if any)
            let escrow = null;
            if (group.assignedEscrowId) {
              escrow = await Escrow.findOne({ escrowId: group.assignedEscrowId });
            }
            
            if (!escrow) {
              escrow = await Escrow.findOne({ groupId: groupId.toString() }).sort({ createdAt: -1 });
            }

            // Verify group exists in Telegram before attempting operations
            let groupExists = false;
            try {
              await telegram.getChat(String(groupId));
              groupExists = true;
            } catch (chatError) {
              console.log(`⚠️ Group ${groupId} does not exist in Telegram or bot has no access`);
              // Group doesn't exist - just reset database entry and continue
              groupExists = false;
            }

            // Remove users from group (only if group exists)
            if (groupExists) {
              if (escrow) {
                try {
                  await GroupPoolService.removeUsersFromGroup(escrow, groupId, telegram);
                } catch (removeError) {
                  // Continue even if user removal fails
                  console.log(`⚠️ Could not remove users from group ${groupId}:`, removeError.message);
                }
              } else {
                // Try to remove users even without escrow (get admins and remove them)
                try {
                  const chatIdStr = String(groupId);
                  const adminUserId2 = config.ADMIN_USER_ID2 ? Number(config.ADMIN_USER_ID2) : null;
                  
                  // Get bot ID (cache it to avoid multiple calls)
                  let botId;
                  if (!adminResetAllGroups.botIdCache) {
                    try {
                      const botInfo = await telegram.getMe();
                      botId = botInfo.id;
                      adminResetAllGroups.botIdCache = botId;
                    } catch (e) {
                      botId = null;
                      adminResetAllGroups.botIdCache = null;
                    }
                  } else {
                    botId = adminResetAllGroups.botIdCache;
                  }

                  // Get all chat administrators
                  let adminMembers = [];
                  try {
                    const chatAdministrators = await telegram.getChatAdministrators(chatIdStr);
                    adminMembers = chatAdministrators.map(member => Number(member.user.id));
                  } catch (e) {
                    // Continue with empty list - group might not have admins or bot lacks permission
                  }

                  // Remove all users except bot and ADMIN_USER_ID2
                  for (const userId of adminMembers) {
                    if (userId === botId || (adminUserId2 && userId === adminUserId2)) {
                      continue;
                    }
                    try {
                      const untilDate = Math.floor(Date.now() / 1000) + 60;
                      await telegram.kickChatMember(chatIdStr, userId, untilDate);
                      // Immediately unban so they can rejoin
                      await telegram.unbanChatMember(chatIdStr, userId);
                    } catch (e) {
                      // Ignore errors - user might have already left or bot lacks permission
                    }
                  }
                } catch (removeError) {
                  // Continue even if user removal fails
                  console.log(`⚠️ Could not remove users from group ${groupId}:`, removeError.message);
                }
              }
            }

            // Refresh invite link (has built-in 2 second delay) - only if group exists
            if (groupExists) {
              try {
                await GroupPoolService.refreshInviteLink(groupId, telegram);
              } catch (linkError) {
                console.log(`⚠️ Could not refresh invite link for group ${groupId}:`, linkError.message);
                // Continue anyway - group can still be reset
              }
            } else {
              // Group doesn't exist - just clear the invite link in database
              const freshGroupForLink = await GroupPool.findOne({ groupId: groupId });
              if (freshGroupForLink && freshGroupForLink.inviteLink) {
                freshGroupForLink.inviteLink = null;
                freshGroupForLink.inviteLinkHasJoinRequest = false;
                try {
                  await freshGroupForLink.save();
                } catch (e) {
                  // Ignore save errors
                }
              }
            }

            // Reset group pool entry - re-fetch to ensure we have latest state
            const freshGroup = await GroupPool.findOne({ groupId: groupId });
            if (freshGroup) {
              freshGroup.status = 'available';
              freshGroup.assignedEscrowId = null;
              freshGroup.assignedAt = null;
              freshGroup.completedAt = null;
              try {
                await freshGroup.save();
              } catch (saveError) {
                console.error(`⚠️ Could not save group ${groupId}:`, saveError.message);
                // Continue - try to reset next group
              }
            } else {
              console.log(`⚠️ Group ${groupId} not found when trying to save - may have been deleted`);
            }

            // Optionally delete escrow (but don't fail if it doesn't exist)
            if (escrow) {
              try {
                await Escrow.deleteOne({ escrowId: escrow.escrowId });
              } catch (deleteError) {
                // Continue anyway
              }
            }

            successCount++;
            results.push({ groupId, status: 'success' });
          } catch (error) {
            failCount++;
            results.push({ groupId, status: 'failed', error: error.message });
            console.error(`Error resetting group ${groupId}:`, error);
          }

          // Small delay between groups to avoid rate limiting
          if (i < allGroups.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        // Update processing message with results
        const summary = `✅ Reset Complete!

📊 Results:
• Total Groups: ${allGroups.length}
• ✅ Successful: ${successCount}
• ❌ Failed: ${failCount}

All groups have been reset to 'available' status.`;

        await telegram.editMessageText(
          chatId,
          messageId,
          null,
          summary
        );

        // Delete summary message after 2 minutes
        setTimeout(async () => {
          try {
            await telegram.deleteMessage(chatId, messageId);
          } catch (e) {}
        }, 120 * 1000);

      } catch (error) {
        console.error('Error in admin reset all groups (background):', error);
        try {
          await telegram.editMessageText(
            chatId,
            messageId,
            null,
            `❌ Error resetting groups: ${error.message}`
          );
          setTimeout(async () => {
            try {
              await telegram.deleteMessage(chatId, messageId);
            } catch (e) {}
          }, 60 * 1000);
        } catch (editError) {
          console.error('Error editing message:', editError);
        }
      }
    })();

    // Return immediately to avoid timeout
    return;
  } catch (error) {
    console.error('Error in admin reset all groups:', error);
    ctx.reply('❌ Error resetting all groups. Please check the logs.');
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
  adminCleanupAddresses,
  adminGroupReset,
  adminResetForce,
  adminResetAllGroups
};
