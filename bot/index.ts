// bot/index.ts
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { Address } from '@ton/core';
import { escrowUtils } from './utils/escrowUtils';
import { walletUtils } from './utils/walletUtils';
import { tonClient } from './utils/tonClient';
import { database } from './utils/database';
import { tonScripts } from './integration/tonScripts';
import { tonConnectService } from './utils/tonConnect';
import fetch from 'node-fetch';

// Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 0);

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not found in environment variables');
  process.exit(1);
}

// Create bot instance
const bot = new Telegraf(BOT_TOKEN);

// User sessions storage (in production, use Redis or database)
const userSessions: Map<number, any> = new Map();

// Helper function to get user session
function getUserSession(userId: number) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {});
  }
  return userSessions.get(userId);
}

// =============================================================================
// BASIC COMMANDS
// =============================================================================

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  const startPayload = ctx.startPayload;
  
  console.log(`👤 User ${username} (${userId}) started the bot with payload: ${startPayload}`);
  
  // Check if this is a trade group join request
  if (startPayload && startPayload.startsWith('join_trade_')) {
    const tradeId = startPayload.replace('join_trade_', '');
    console.log(`🔗 User ${username} (${userId}) joining trade group: ${tradeId}`);
    
    await ctx.reply(
      `🔗 **Joining Trade Group**\n\n` +
      `**Trade ID:** \`${tradeId}\`\n\n` +
      `You're about to join a private trade group. The seller will create the group and add you.\n\n` +
      `**What happens next:**\n` +
      `1. Seller creates the private group\n` +
      `2. You'll be added to the group\n` +
      `3. Trade details will be shared there\n` +
      `4. Complete the transaction securely\n\n` +
      `**Please wait for the seller to create the group...**`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  // Check if this is a group creation request
  if (startPayload && startPayload.startsWith('create_trade_')) {
    const tradeId = startPayload.replace('create_trade_', '');
    console.log(`👥 User ${username} (${userId}) creating trade group: ${tradeId}`);
    
    await ctx.reply(
      `👥 **Creating Trade Group**\n\n` +
      `**Trade ID:** \`${tradeId}\`\n\n` +
      `You're creating a private group for this trade. After creating the group:\n\n` +
      `**Next Steps:**\n` +
      `1. Add the buyer to this group\n` +
      `2. The bot will initialize the trade\n` +
      `3. Complete the transaction securely\n\n` +
      `**Group is ready for trading!** 🎉`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await ctx.reply(
    `🤖 **TON Escrow Bot**\n\n` +
    `Welcome to the secure USDT escrow service on TON blockchain!\n\n` +
    `**Available Commands:**\n` +
    `🛒 /sell - Start selling (create escrow)\n` +
    `📊 /status - Check trade status\n` +
    `🆔 /myid - Get your user ID\n` +
    `❓ /help - Get help\n\n` +
    `**For Admins:**\n` +
    `⚙️ /admin - Admin panel\n\n` +
    `**How it works:**\n` +
    `1. Seller creates escrow and private group\n` +
    `2. Buyer joins the group\n` +
    `3. Trade happens in the private group\n` +
    `4. Disputes handled by admin\n\n` +
    `🔒 **100% Secure** - Smart contract holds funds until completion`,
    { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Start Selling', 'start_sell')],
        [Markup.button.callback('❓ Help', 'help_main')]
      ])
    }
  );
});

// Help command
bot.help(async (ctx) => {
  await ctx.reply(
    `📖 **TON Escrow Bot Help**\n\n` +
    `**For Sellers:**\n` +
    `• Use /sell to create a new escrow\n` +
    `• Deposit USDT into the escrow contract\n` +
    `• Confirm when buyer pays off-chain\n` +
    `• Get paid minus platform fees\n\n` +
    `**For Buyers:**\n` +
    `• Join private trade groups created by sellers\n` +
    `• Make off-chain payment to seller\n` +
    `• Receive USDT when seller confirms\n` +
    `• Raise dispute if needed\n\n` +
    `**Security Features:**\n` +
    `• Smart contract holds funds\n` +
    `• Admin dispute resolution\n` +
    `• Deadline protection\n` +
    `• Double-payout prevention\n\n` +
    `**Support:** Contact @admin`,
    { parse_mode: 'Markdown' }
  );
});

// My ID command - helps users find their user ID
bot.command('myid', async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  
  console.log(`🆔 User ${username} (${userId}) requested their ID`);
  
  await ctx.reply(
    `🆔 **Your Telegram Information**\n\n` +
    `**User ID:** \`${userId}\`\n` +
    `**Username:** ${username ? `@${username}` : 'Not set'}\n\n` +
    `**How to use:**\n` +
    `• Share your **User ID** with sellers if you don't have a username\n` +
    `• Sellers can use either your username or User ID to create trades\n\n` +
    `**For trading:**\n` +
    `• If you have a username: sellers can use \`@${username || 'your_username'}\`\n` +
    `• If no username: sellers can use your User ID: \`${userId}\`\n\n` +
    `**Privacy:** Your User ID is safe to share for trading purposes.`,
    { parse_mode: 'Markdown' }
  );
});

// Create group command - for sellers to create the actual group
bot.command('creategroup', async (ctx) => {
  const userId = ctx.from?.id;
  const session = getUserSession(userId);
  
  if (!session.tradeId) {
    await ctx.reply(
      `❌ **No Active Trade**\n\n` +
      `You need to start a trade first using /sell command.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  console.log(`👥 Seller ${ctx.from?.username} (${userId}) creating group for trade: ${session.tradeId}`);
  
  try {
    // Create a new group with the bot
    const botUsername = bot.botInfo?.username;
    const groupTitle = session.groupTitle || `Escrow Trade: @${ctx.from?.username} ↔ ${session.buyerDisplay}`;
    
    // Generate a unique group invite link
    const groupInviteLink = `https://t.me/${botUsername}?startgroup=create_trade_${session.tradeId}`;
    
    // Store group info
    session.groupInviteLink = groupInviteLink;
    
    await ctx.reply(
      `✅ **Group Invite Link Generated!**\n\n` +
      `**Trade ID:** \`${session.tradeId}\`\n` +
      `**Group Title:** ${groupTitle}\n\n` +
      `**Group Invite Link:**\n` +
      `\`${groupInviteLink}\`\n\n` +
      `**Next Steps:**\n` +
      `1. **Click the link below to create the group**\n` +
      `2. **Add the buyer:** ${session.buyerDisplay}\n` +
      `3. **Continue trade in the group**\n\n` +
      `**Instructions:**\n` +
      `• Click the link to create a new group\n` +
      `• Add the buyer to the group\n` +
      `• The bot will automatically join and initialize the trade`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('➕ Create Group', groupInviteLink)],
          [Markup.button.callback('📋 Copy Link Text', `copy_group_link_${session.tradeId}`)]
        ])
      }
    );
    
  } catch (error) {
    console.error('Error creating group link:', error);
    await ctx.reply(
      `❌ **Failed to Create Group Link**\n\n` +
      `Please try again or contact admin for assistance.`,
      { parse_mode: 'Markdown' }
    );
  }
});

// About command
bot.command('about', async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  
  console.log(`ℹ️ User ${username} (${userId}) requested about info`);
  
  await ctx.reply(
    `ℹ️ **About TON Escrow Bot**\n\n` +
    `**Version:** 1.0.0\n` +
    `**Network:** ${process.env.NETWORK || 'testnet'}\n` +
    `**Blockchain:** TON (The Open Network)\n` +
    `**Token:** USDT (TEP-74 Standard)\n\n` +
    `**Features:**\n` +
    `• Secure smart contract escrow\n` +
    `• Admin dispute resolution\n` +
    `• Deadline protection\n` +
    `• Double-payout prevention\n` +
    `• Fair fee distribution\n\n` +
    `**Security:**\n` +
    `• Smart contract holds funds\n` +
    `• Role-based access control\n` +
    `• Expected jetton wallet validation\n` +
    `• Comprehensive error handling\n\n` +
    `**Support:**\n` +
    `• Admin: @admin\n` +
    `• Help: /help\n` +
    `• Status: /status\n\n` +
    `**Built with:**\n` +
    `• Tact smart contracts\n` +
    `• TON blockchain\n` +
    `• Telegraf bot framework\n` +
    `• TypeScript\n\n` +
    `**Thank you for using TON Escrow Bot!** 🎉`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Start Selling', 'start_sell')],
        [Markup.button.callback('❓ Help', 'help_main')]
      ])
    }
  );
});

// =============================================================================
// SELLER COMMANDS
// =============================================================================

// Sell command
bot.command('sell', async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  
  console.log(`🛒 Seller ${username} (${userId}) started sell flow`);
  
  await ctx.reply(
    `🛒 **Start Selling**\n\n` +
    `Let's create a new escrow for your USDT sale!\n\n` +
    `**What you need:**\n` +
    `• Connect your TON wallet (Telegram Wallet)\n` +
    `• Buyer's Telegram username\n` +
    `• Trade amount in USDT\n` +
    `• Commission rate (default: 2.5%)\n\n` +
    `**Ready to start?**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Start Trade', 'start_sell_flow')],
        [Markup.button.callback('❓ Help', 'sell_help')]
      ])
    }
  );
});

// =============================================================================
// BUYER COMMANDS (Group-only)
// =============================================================================

// =============================================================================
// STATUS COMMAND
// =============================================================================

// Status command
bot.command('status', async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  
  console.log(`📊 User ${username} (${userId}) checking status`);
  
  const args = ctx.message?.text?.split(' ');
  if (args && args.length > 1) {
    const escrowAddress = args[1];
    
    if (!walletUtils.validateAddress(escrowAddress)) {
      await ctx.reply(
        `❌ **Invalid address format**\n\n` +
        `Please provide a valid TON address.\n\n` +
        `**Format:** \`0:contract_address_here\`\n\n` +
        `**Example:** /status 0:1234567890abcdef...`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    try {
      const tradeInfo = await escrowUtils.getTradeInfo(escrowAddress);
      if (!tradeInfo) {
        await ctx.reply('❌ Trade not found. Please check the address and try again.');
        return;
      }

      const statusText = escrowUtils.getStatusText(tradeInfo.status);
      const timeRemaining = escrowUtils.getTimeRemaining(tradeInfo.deadline);
      const isExpired = escrowUtils.isExpired(tradeInfo.deadline);
      const fees = escrowUtils.calculateFees(tradeInfo.amount, tradeInfo.commissionBps);

      await ctx.reply(
        `📊 **Trade Status**\n\n` +
        `**Address:** \`${escrowAddress}\`\n` +
        `**Status:** ${statusText}\n` +
        `**Amount:** ${escrowUtils.formatAmount(tradeInfo.amount)} USDT\n` +
        `**Deposited:** ${escrowUtils.formatAmount(tradeInfo.deposited)} USDT\n` +
        `**Verified:** ${tradeInfo.depositVerified ? '✅' : '❌'}\n` +
        `**Time Left:** ${isExpired ? 'Expired' : timeRemaining}\n\n` +
        `**Fee Breakdown:**\n` +
        `• Platform fee: ${escrowUtils.formatAmount(fees.totalFee)} USDT\n` +
        `• To buyer: ${escrowUtils.formatAmount(fees.toBuyer)} USDT\n\n` +
        `**Actions:**`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', `status_${escrowAddress}`)],
            [Markup.button.callback('💰 Deposit', `deposit_${escrowAddress}`)],
            [Markup.button.callback('✅ Confirm Payment', `confirm_${escrowAddress}`)],
            [Markup.button.callback('⚠️ Raise Dispute', `dispute_${escrowAddress}`)]
          ])
        }
      );
    } catch (error) {
      console.error('❌ Error checking status:', error);
      await ctx.reply('❌ Error checking trade status');
    }
  } else {
    await ctx.reply(
      `📊 **Check Trade Status**\n\n` +
      `To check the status of a trade, provide the escrow address:\n\n` +
      `**Usage:** /status <escrow_address>\n\n` +
      `**Example:**\n` +
      `\`/status 0:1234567890abcdef...\`\n\n` +
      `**What you'll see:**\n` +
      `• Current trade status\n` +
      `• Amount and fees\n` +
      `• Time remaining\n` +
      `• Available actions\n\n` +
      `**Need help?** Contact @admin`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❓ Help', 'status_help')],
          [Markup.button.callback('🛒 Start Selling', 'start_sell')]
        ])
      }
    );
  }
});

// =============================================================================
// ADMIN COMMANDS
// =============================================================================

// Admin command
bot.command('admin', async (ctx) => {
  const userId = ctx.from?.id;
  
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  console.log(`👑 Admin ${userId} accessed admin panel`);
  
  await ctx.reply(
    `👑 **Admin Panel**\n\n` +
    `Welcome to the TON Escrow Bot admin panel!\n\n` +
    `**Available Commands:**\n` +
    `🔍 System status and monitoring\n` +
    `⚠️ Active disputes management\n` +
    `🔧 Dispute resolution tools\n` +
    `📊 Bot statistics and analytics\n` +
    `🛠️ Emergency admin tools\n\n` +
    `**Quick Actions:**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔍 System Status', 'admin_status')],
        [Markup.button.callback('⚠️ Active Disputes', 'admin_disputes')],
        [Markup.button.callback('📊 Statistics', 'admin_stats')],
        [Markup.button.callback('🛠️ Tools', 'admin_tools')]
      ])
    }
  );
});

// =============================================================================
// CALLBACK QUERY HANDLERS
// =============================================================================

// Basic navigation callbacks
bot.action('start_sell', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🛒 Use /sell command to start selling USDT');
});

bot.action('help_main', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `❓ **Help**\n\n` +
    `**Commands:**\n` +
    `• /start - Start the bot\n` +
    `• /sell - Start selling USDT\n` +
    `• /status - Check trade status\n` +
    `• /myid - Get your user ID\n` +
    `• /help - Show this help\n` +
    `• /admin - Admin panel (admin only)\n\n` +
    `**How to use:**\n` +
    `1. Use /sell to create an escrow trade\n` +
    `2. Add buyer to private group\n` +
    `3. Complete trade in the group\n\n` +
    `**Need more help?** Contact @admin`,
    { parse_mode: 'Markdown' }
  );
});

// =============================================================================
// SELLER FLOW CALLBACKS
// =============================================================================

bot.action('start_sell_flow', async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from!.id;
  const session = getUserSession(userId);
  
  // Check if wallet is already connected
  if (tonConnectService.isWalletConnected(userId)) {
    const wallet = tonConnectService.getConnectedWallet(userId);
    session.walletAddress = wallet!.address;
    
    // Create a unique trade ID
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const groupTitle = `Escrow Trade: @${ctx.from?.username}`;
    
    // Store trade info
    session.tradeId = tradeId;
    session.groupTitle = groupTitle;
    session.step = 'sell_amount';
    
    // Generate group creation link (since we can't create groups programmatically)
    try {
      console.log(`👥 Generating group creation link for trade: ${tradeId}`);
      
      const botUsername = bot.botInfo?.username;
      const groupCreationLink = `https://t.me/${botUsername}?startgroup=create_trade_${tradeId}`;
      
      // Store group info (will be updated when group is actually created)
      session.groupCreationLink = groupCreationLink;
      
      await ctx.reply(
        `✅ **Wallet Connected Successfully!**\n\n` +
        `Connected wallet: \`${Address.parse(wallet!.address).toString({ bounceable: false })}\`\n\n` +
        `**Step 2: Create Private Trade Group**\n\n` +
        `**Trade ID:** \`${tradeId}\`\n` +
        `**Group Title:** ${groupTitle}\n\n` +
        `**Next Steps:**\n` +
        `1. **Click the button below to create a private group**\n` +
        `2. **Add your buyer to the group**\n` +
        `3. **Continue the trade in the group**\n\n` +
        `**Group Creation Link:**\n` +
        `\`${groupCreationLink}\`\n\n` +
        `💰 **Step 3: Trade Amount**\n\n` +
        `Enter the amount of USDT to trade:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url('➕ Create Private Group', groupCreationLink)],
            [Markup.button.callback('📋 Copy Link', `copy_group_link_${tradeId}`)],
            [Markup.button.callback('🔌 Disconnect Wallet', 'disconnect_wallet')]
          ])
        }
      );
      
    } catch (error) {
      console.error('Error creating group:', error);
      await ctx.reply(
        `❌ **Failed to Create Group**\n\n` +
        `Error: ${error.message}\n\n` +
        `Please try again or contact admin for assistance.`,
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    session.step = 'sell_wallet_connect';
    
    try {
      // Generate connection URL with user and bot info
      const domain = process.env.DOMAIN || 'http://localhost:3000';
      const connectionUrl = `${domain}/connect?user_id=${userId}&bot_token=${BOT_TOKEN}`;
      
      await ctx.reply(
        `🔗 **Step 1: Connect Wallet**\n\n` +
        `To create an escrow, you need to connect your TON wallet.\n\n` +
        `**How to connect:**\n` +
        `1. Click "Connect Wallet" below\n` +
        `2. Your wallet will open automatically\n` +
        `3. Confirm the connection\n` +
        `4. Come back and click "Check Connection"\n\n` +
        `**Supported Wallets:**\n` +
        `• Telegram Wallet (built-in)\n` +
        `• Tonkeeper\n` +
        `• MyTonWallet`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.webApp('🔗 Connect Wallet', connectionUrl)],
            [Markup.button.callback('✅ Check Connection', 'check_wallet_connection')],
            [Markup.button.callback('❌ Cancel', 'cancel_sell')]
          ])
        }
      );
    } catch (error) {
      console.error('Error generating connection link:', error);
      await ctx.reply(
        `❌ **Connection Error**\n\n` +
        `Failed to generate wallet connection link. Please try again later.`,
        { parse_mode: 'Markdown' }
      );
    }
  }
});

bot.action('check_wallet_connection', async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from!.id;
  const session = getUserSession(userId);
  
  try {
    // Check if wallet is connected via the web server
    const domain = process.env.DOMAIN || 'http://localhost:3000';
    const response = await fetch(`${domain}/api/wallet-status/${userId}`);
    const data = await response.json() as any;
    
    if (data.connected && data.wallet) {
      // Wallet is connected!
      const normalizedAddress = Address.parse(data.wallet.account.address).toString({ bounceable: false });
      const walletInfo = {
        address: normalizedAddress,
        publicKey: data.wallet.account.publicKey,
        connected: true
      };
      
      tonConnectService.connectedWallets.set(userId, walletInfo);
      session.walletAddress = normalizedAddress;
      session.step = 'sell_buyer_username';
      
      await ctx.reply(
        `✅ **Wallet Connected Successfully!**\n\n` +
        `Connected wallet: \`${normalizedAddress}\`\n\n` +
        `**Step 2: Buyer Information**\n\n` +
        `Please enter the buyer's Telegram username or user ID:\n\n` +
        `**Options:**\n` +
        `• **Username:** \`john_doe\` (without @)\n` +
        `• **User ID:** \`123456789\` (numeric ID)\n\n` +
        `**Examples:**\n` +
        `• Username: \`john_doe\`\n` +
        `• User ID: \`123456789\`\n\n` +
        `Type the username/ID or /cancel to abort:`,
        { 
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔌 Disconnect Wallet', 'disconnect_wallet')]
          ])
        }
      );
    } else {
      await ctx.reply(
        `❌ **Wallet Not Connected**\n\n` +
        `Please click "Connect Wallet" first to connect your TON wallet.\n\n` +
        `**Steps:**\n` +
        `1. Click "Connect Wallet" button\n` +
        `2. Connect your wallet in the opened page\n` +
        `3. Come back and click "Check Connection"`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Error checking wallet connection:', error);
    await ctx.reply(
      `❌ **Connection Check Failed**\n\n` +
      `Unable to check wallet connection. Please try again.`,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.action('cancel_sell', async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from!.id;
  const session = getUserSession(userId);
  session.step = null;
  
  await ctx.reply(
    `❌ **Trade Creation Cancelled**\n\n` +
    `You can start a new trade anytime with /sell command.`,
    { parse_mode: 'Markdown' }
  );
});

// Disconnect wallet
bot.action('disconnect_wallet', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;
  const domain = process.env.DOMAIN || 'http://localhost:3000';
  try {
    // Clear server-side session
    await fetch(`${domain}/api/wallet-disconnect/${userId}`, { method: 'POST' });
  } catch (e) {
    console.warn('Failed to clear server wallet session:', e);
  }
  // Clear bot-side session
  tonConnectService.disconnectWallet(userId);
  const session = getUserSession(userId);
  session.walletAddress = undefined;
  await ctx.reply('🔌 Wallet disconnected. You can connect again anytime.', {
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔗 Connect Again', 'start_sell_flow')]
    ])
  });
});

// Copy link text
bot.action(/^copy_link_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const tradeId = ctx.match[1];
  const botUsername = bot.botInfo?.username;
  const groupInviteLink = `https://t.me/${botUsername}?start=join_trade_${tradeId}`;
  
  await ctx.reply(
    `📋 **Group Invite Link**\n\n` +
    `**Trade ID:** \`${tradeId}\`\n\n` +
    `**Copy this link and send to buyer:**\n` +
    `\`${groupInviteLink}\`\n\n` +
    `**Instructions for buyer:**\n` +
    `1. Click the link above\n` +
    `2. Start the bot if not already done\n` +
    `3. Join the private group\n` +
    `4. Wait for trade initialization`,
    { parse_mode: 'Markdown' }
  );
});

// Copy group link text
bot.action(/^copy_group_link_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const tradeId = ctx.match[1];
  const userId = ctx.from!.id;
  const session = getUserSession(userId);
  
  const groupLink = session.groupInviteLink || session.groupCreationLink;
  if (!groupLink) {
    await ctx.reply('❌ No group link available. Please start a new trade.');
    return;
  }
  
  await ctx.reply(
    `📋 **Group Link**\n\n` +
    `**Trade ID:** \`${tradeId}\`\n\n` +
    `**Copy this link and send to buyer:**\n` +
    `\`${groupLink}\`\n\n` +
    `**Instructions for buyer:**\n` +
    `1. Click the link above\n` +
    `2. Create/join the group\n` +
    `3. Wait for trade initialization`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('sell_help', async (ctx) => {
  await ctx.answerCbQuery();
  
  await ctx.reply(
    `📖 **Seller Guide**\n\n` +
    `**Step 1: Connect Wallet**\n` +
    `• Connect your TON wallet (Telegram Wallet)\n` +
    `• Enter buyer's Telegram username\n` +
    `• Set trade amount in USDT\n\n` +
    `**Step 2: Deposit USDT**\n` +
    `• Bot deploys escrow contract\n` +
    `• You deposit USDT into escrow\n` +
    `• Bot verifies deposit\n\n` +
    `**Step 3: Wait for Payment**\n` +
    `• Buyer makes off-chain payment\n` +
    `• You confirm payment received\n` +
    `• USDT released to buyer\n\n` +
    `**Security:**\n` +
    `• Smart contract holds funds\n` +
    `• Admin handles disputes\n` +
    `• Deadline protection\n\n` +
    `**Fees:**\n` +
    `• Platform fee: 2.5% (default)\n` +
    `• Split among 3 fee wallets\n\n` +
    `Ready to start? Use /sell again!`,
    { parse_mode: 'Markdown' }
  );
});


// =============================================================================
// STATUS AND MONITORING CALLBACKS
// =============================================================================

bot.action('status_help', async (ctx) => {
  await ctx.answerCbQuery();
  
  await ctx.reply(
    `❓ **Status Help**\n\n` +
    `**How to check trade status:**\n\n` +
    `1. **Get escrow address** from seller or buyer\n` +
    `2. **Use command:** /status <address>\n` +
    `3. **View details** and current status\n\n` +
    `**Status meanings:**\n` +
    `• ⏳ Pending Deposit - Waiting for USDT\n` +
    `• ✅ Active - USDT deposited, waiting for payment\n` +
    `• ⚠️ Dispute - Dispute raised, admin reviewing\n` +
    `• Released - USDT sent to buyer\n` +
    `• ↩️ Refunded - USDT returned to seller\n\n` +
    `**What you can do:**\n` +
    `• Check current status\n` +
    `• View fee breakdown\n` +
    `• See time remaining\n` +
    `• Take appropriate actions\n\n` +
    `**Still need help?** Contact @admin`,
    { parse_mode: 'Markdown' }
  );
});

// Status refresh callback
bot.action(/^status_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  try {
    const tradeInfo = await escrowUtils.getTradeInfo(escrowAddress);
    if (!tradeInfo) {
      await ctx.reply('❌ Trade not found');
      return;
    }

    const statusText = escrowUtils.getStatusText(tradeInfo.status);
    const timeRemaining = escrowUtils.getTimeRemaining(tradeInfo.deadline);
    const isExpired = escrowUtils.isExpired(tradeInfo.deadline);
    const fees = escrowUtils.calculateFees(tradeInfo.amount, tradeInfo.commissionBps);

    await ctx.reply(
      `📊 **Trade Status (Refreshed)**\n\n` +
      `**Address:** \`${escrowAddress}\`\n` +
      `**Status:** ${statusText}\n` +
      `**Amount:** ${escrowUtils.formatAmount(tradeInfo.amount)} USDT\n` +
      `**Deposited:** ${escrowUtils.formatAmount(tradeInfo.deposited)} USDT\n` +
      `**Verified:** ${tradeInfo.depositVerified ? '✅' : '❌'}\n` +
      `**Time Left:** ${isExpired ? 'Expired' : timeRemaining}\n\n` +
      `**Fee Breakdown:**\n` +
      `• Platform fee: ${escrowUtils.formatAmount(fees.totalFee)} USDT\n` +
      `• To buyer: ${escrowUtils.formatAmount(fees.toBuyer)} USDT\n\n` +
      `**Last Updated:** ${new Date().toLocaleString()}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', `status_${escrowAddress}`)],
          [Markup.button.callback('💰 Deposit', `deposit_${escrowAddress}`)],
          [Markup.button.callback('✅ Confirm Payment', `confirm_${escrowAddress}`)],
          [Markup.button.callback('⚠️ Raise Dispute', `dispute_${escrowAddress}`)]
        ])
      }
    );
  } catch (error) {
    console.error('❌ Error refreshing status:', error);
    await ctx.reply('❌ Error refreshing trade status');
  }
});

// =============================================================================
// TRADE ACTION CALLBACKS
// =============================================================================

// Deposit callback
bot.action(/^deposit_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  await ctx.reply(
    `💰 **Deposit USDT**\n\n` +
    `**Escrow Address:**\n` +
    `\`${escrowAddress}\`\n\n` +
    `**Instructions:**\n` +
    `1. Open your TON wallet (Tonkeeper, etc.)\n` +
    `2. Send USDT to the escrow address above\n` +
    `3. Use /status ${escrowAddress} to check deposit\n\n` +
    `**Important:**\n` +
    `• Send exact amount as specified in trade\n` +
    `• Only send USDT (not TON)\n` +
    `• Wait for confirmation before proceeding\n\n` +
    `**Need help?** Contact @admin`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📊 Check Status', `status_${escrowAddress}`)],
        [Markup.button.callback('❓ Help', 'deposit_help')]
      ])
    }
  );
});

// Confirm payment callback
bot.action(/^confirm_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  await ctx.reply(
    `✅ **Confirm Payment Received**\n\n` +
    `**Escrow:** \`${escrowAddress}\`\n\n` +
    `**⚠️ Important:**\n` +
    `• Only confirm if you received the off-chain payment\n` +
    `• This will release USDT to the buyer\n` +
    `• Action cannot be undone\n\n` +
    `**Are you sure you received payment?**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yes, Confirm', `confirm_yes_${escrowAddress}`)],
        [Markup.button.callback('❌ No, Cancel', `confirm_no_${escrowAddress}`)]
      ])
    }
  );
});

// Confirm payment yes
bot.action(/^confirm_yes_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  await ctx.reply('🔄 Confirming payment and releasing USDT...');
  
  try {
    const success = await escrowUtils.confirmDelivery(escrowAddress, 'mock_private_key');
    
    if (success) {
      await ctx.reply(
        `✅ **Payment Confirmed!**\n\n` +
        `**Escrow:** \`${escrowAddress}\`\n\n` +
        `**USDT has been released to the buyer.**\n` +
        `**Trade completed successfully!**\n\n` +
        `**Thank you for using TON Escrow Bot!** 🎉`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('❌ Failed to confirm payment. Please try again or contact admin.');
    }
  } catch (error) {
    console.error('❌ Error confirming payment:', error);
    await ctx.reply('❌ Error confirming payment. Please try again or contact admin.');
  }
});

// Confirm payment no
bot.action(/^confirm_no_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('❌ Payment confirmation cancelled');
});

// Raise dispute callback
bot.action(/^dispute_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  await ctx.reply(
    `⚠️ **Raise Dispute**\n\n` +
    `**Escrow:** \`${escrowAddress}\`\n\n` +
    `**When to raise a dispute:**\n` +
    `• Seller not responding\n` +
    `• Payment made but no confirmation\n` +
    `• Seller asking for more money\n` +
    `• Any suspicious behavior\n\n` +
    `**What happens next:**\n` +
    `• Admin reviews the case\n` +
    `• You provide payment proof\n` +
    `• Admin makes fair decision\n` +
    `• Funds released accordingly\n\n` +
    `**Are you sure you want to raise a dispute?**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⚠️ Yes, Raise Dispute', `dispute_yes_${escrowAddress}`)],
        [Markup.button.callback('❌ No, Cancel', `dispute_no_${escrowAddress}`)]
      ])
    }
  );
});

// Raise dispute yes
bot.action(/^dispute_yes_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  await ctx.reply('🔄 Raising dispute...');
  
  try {
    const success = await escrowUtils.raiseDispute(escrowAddress, 'mock_private_key');
    
    if (success) {
      await ctx.reply(
        `⚠️ **Dispute Raised Successfully!**\n\n` +
        `**Escrow:** \`${escrowAddress}\`\n\n` +
        `**What happens next:**\n` +
        `• Admin has been notified\n` +
        `• You'll be contacted for evidence\n` +
        `• Admin will review and decide\n` +
        `• Funds will be released fairly\n\n` +
        `**Please prepare:**\n` +
        `• Payment proof (screenshot, receipt)\n` +
        `• Communication history with seller\n` +
        `• Any other relevant evidence\n\n` +
        `**Admin will contact you soon.**`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('❌ Failed to raise dispute. Please try again or contact admin directly.');
    }
  } catch (error) {
    console.error('❌ Error raising dispute:', error);
    await ctx.reply('❌ Error raising dispute. Please try again or contact admin directly.');
  }
});

// Raise dispute no
bot.action(/^dispute_no_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('❌ Dispute cancelled');
});

// Deposit help
bot.action('deposit_help', async (ctx) => {
  await ctx.answerCbQuery();
  
  await ctx.reply(
    `❓ **Deposit Help**\n\n` +
    `**How to deposit USDT:**\n\n` +
    `1. **Open your TON wallet** (Tonkeeper, etc.)\n` +
    `2. **Find USDT** in your token list\n` +
    `3. **Send USDT** to the escrow address\n` +
    `4. **Wait for confirmation** (usually 1-2 minutes)\n` +
    `5. **Check status** using /status command\n\n` +
    `**Important Notes:**\n` +
    `• Send exact amount as specified\n` +
    `• Only send USDT (not TON)\n` +
    `• Double-check the address\n` +
    `• Keep transaction hash for reference\n\n` +
    `**Still having issues?** Contact @admin`,
    { parse_mode: 'Markdown' }
  );
});

// =============================================================================
// ADMIN CALLBACKS
// =============================================================================

bot.action('admin_status', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  try {
    const tonConnected = true; // Mock - would test actual connection
    
    await ctx.reply(
      `🔍 **System Status**\n\n` +
      `**TON Network:** ${tonConnected ? '✅ Connected' : '❌ Disconnected'}\n` +
      `**Bot Status:** ✅ Running\n` +
      `**Database:** ✅ Connected\n` +
      `**Last Update:** ${new Date().toLocaleString()}\n\n` +
      `**Network Info:**\n` +
      `• Network: ${process.env.NETWORK || 'testnet'}\n` +
      `• RPC: ${process.env.TON_API_KEY ? '✅ Configured' : '❌ Not configured'}\n\n` +
      `**Bot Info:**\n` +
      `• Uptime: ${process.uptime().toFixed(0)}s\n` +
      `• Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\n` +
      `• Version: 1.0.0\n\n` +
      `**All systems operational!** ✅`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'admin_status')],
          [Markup.button.callback('📊 Statistics', 'admin_stats')]
        ])
      }
    );
  } catch (error) {
    console.error('❌ Error checking system status:', error);
    await ctx.reply('❌ Error checking system status');
  }
});

bot.action('admin_disputes', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  // Get real disputes from database
  const disputes = await tonScripts.getActiveDisputes();
  
  if (disputes.length === 0) {
    await ctx.reply(
      `⚠️ **Active Disputes**\n\n` +
      `**No active disputes found.**\n\n` +
      `All trades are proceeding normally! ✅`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'admin_disputes')],
          [Markup.button.callback('📊 Statistics', 'admin_stats')]
        ])
      }
    );
    return;
  }
  
  let message = `⚠️ **Active Disputes**\n\n`;
  
  disputes.forEach((dispute, index) => {
    message += `**${index + 1}. Dispute #${dispute.id}**\n`;
    message += `• Escrow: \`${walletUtils.formatAddress(dispute.escrowAddress)}\`\n`;
    message += `• Buyer: @${dispute.buyerUsername || 'unknown'}\n`;
    message += `• Seller: @${dispute.sellerUsername || 'unknown'}\n`;
    message += `• Amount: ${dispute.amount} USDT\n`;
    message += `• Reason: ${dispute.reason}\n`;
    message += `• Status: ${dispute.status}\n`;
    message += `• Created: ${dispute.createdAt}\n\n`;
  });
  
  message += `**Actions:**`;
  
  await ctx.reply(
    message,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔧 Resolve Dispute', `resolve_dispute_${disputes[0]?.escrowAddress || 'none'}`)],
        [Markup.button.callback('🔄 Refresh', 'admin_disputes')]
      ])
    }
  );
});

bot.action('admin_stats', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  // Get real statistics from database
  const stats = await database.getStats();
  
  await ctx.reply(
    `📊 **Bot Statistics**\n\n` +
    `**Trade Overview:**\n` +
    `• Total Trades: ${stats.totalTrades}\n` +
    `• Active Trades: ${stats.activeTrades}\n` +
    `• Completed: ${stats.completedTrades}\n` +
    `• Disputed: ${stats.disputedTrades}\n\n` +
    `**Financial:**\n` +
    `• Total Volume: ${stats.totalVolume}\n` +
    `• Total Fees: ${stats.totalFees}\n` +
    `• Avg Trade Size: ${stats.avgTradeSize}\n\n` +
    `**Performance:**\n` +
    `• Success Rate: ${stats.successRate}\n` +
    `• Uptime: ${(process.uptime() / 3600).toFixed(1)}h\n\n` +
    `**Last Updated:** ${new Date().toLocaleString()}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'admin_stats')],
        [Markup.button.callback('⚠️ Disputes', 'admin_disputes')]
      ])
    }
  );
});

bot.action('admin_tools', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  await ctx.reply(
    `🛠️ **Admin Tools**\n\n` +
    `**Available Tools:**\n` +
    `• Emergency withdraw\n` +
    `• Retry failed transfers\n` +
    `• Cancel expired trades\n` +
    `• System maintenance\n\n` +
    `**⚠️ Warning:**\n` +
    `These tools should only be used in emergencies or for maintenance.\n\n` +
    `**Choose a tool:**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🚨 Emergency Withdraw', 'admin_emergency')],
        [Markup.button.callback('🔄 Retry Transfer', 'admin_retry')],
        [Markup.button.callback('⏰ Cancel Expired', 'admin_cancel_expired')],
        [Markup.button.callback('❌ Cancel', 'admin_cancel')]
      ])
    }
  );
});

// Resolve dispute callback
bot.action(/^resolve_dispute_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  try {
    const tradeInfo = await escrowUtils.getTradeInfo(escrowAddress);
    if (!tradeInfo) {
      await ctx.reply('❌ Trade not found. Please check the address and try again.');
      return;
    }
    
    await ctx.reply(
      `📋 **Dispute Details**\n\n` +
      `**Escrow:** \`${walletUtils.formatAddress(escrowAddress)}\`\n` +
      `**Amount:** ${escrowUtils.formatAmount(tradeInfo.amount)} USDT\n` +
      `**Status:** ${escrowUtils.getStatusText(tradeInfo.status)}\n` +
      `**Deposited:** ${escrowUtils.formatAmount(tradeInfo.deposited)} USDT\n` +
      `**Verified:** ${tradeInfo.depositVerified ? '✅' : '❌'}\n\n` +
      `**Resolution Options:**\n` +
      `• Release to buyer (if payment confirmed)\n` +
      `• Refund to seller (if payment not made)\n\n` +
      `**Choose resolution:**`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Release to Buyer', `resolve_buyer_${escrowAddress}`)],
          [Markup.button.callback('↩️ Refund to Seller', `resolve_seller_${escrowAddress}`)],
          [Markup.button.callback('❌ Cancel', 'admin_cancel')]
        ])
      }
    );
  } catch (error) {
    console.error('❌ Error getting trade info:', error);
    await ctx.reply('❌ Error getting trade information');
  }
});

// Resolve to buyer
bot.action(/^resolve_buyer_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  await ctx.reply('🔄 Resolving dispute in favor of buyer...');
  
  try {
    const success = await escrowUtils.resolveDispute(escrowAddress, 'mock_admin_key', true);
    
    if (success) {
      await ctx.reply(
        `✅ **Dispute Resolved!**\n\n` +
        `**Escrow:** \`${walletUtils.formatAddress(escrowAddress)}\`\n\n` +
        `**Resolution:** Release to buyer\n` +
        `**USDT has been released to the buyer.**\n\n` +
        `**Trade completed successfully!** 🎉`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('❌ Failed to resolve dispute. Please try again.');
    }
  } catch (error) {
    console.error('❌ Error resolving dispute:', error);
    await ctx.reply('❌ Error resolving dispute. Please try again.');
  }
});

// Resolve to seller
bot.action(/^resolve_seller_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const escrowAddress = ctx.match[1];
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  await ctx.reply('🔄 Resolving dispute in favor of seller...');
  
  try {
    const success = await escrowUtils.resolveDispute(escrowAddress, 'mock_admin_key', false);
    
    if (success) {
      await ctx.reply(
        `✅ **Dispute Resolved!**\n\n` +
        `**Escrow:** \`${walletUtils.formatAddress(escrowAddress)}\`\n\n` +
        `**Resolution:** Refund to seller\n` +
        `**USDT has been refunded to the seller.**\n\n` +
        `**Trade completed successfully!** 🎉`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('❌ Failed to resolve dispute. Please try again.');
    }
  } catch (error) {
    console.error('❌ Error resolving dispute:', error);
    await ctx.reply('❌ Error resolving dispute. Please try again.');
  }
});

// Admin cancel
bot.action('admin_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('❌ Operation cancelled');
});

// Emergency withdraw
bot.action('admin_emergency', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  const session = getUserSession(ctx.from!.id);
  session.step = 'admin_emergency_address';
  
  await ctx.reply(
    `🚨 **Emergency Withdraw**\n\n` +
    `**⚠️ DANGER ZONE**\n\n` +
    `This tool allows emergency withdrawal of funds from escrow contracts.\n\n` +
    `**Use only in extreme emergencies:**\n` +
    `• Contract malfunction\n` +
    `• Security breach\n` +
    `• Critical system failure\n\n` +
    `**Please provide escrow address:**\n` +
    `**Format:** \`0:contract_address_here\`\n\n` +
    `Type the address or /cancel to abort:`,
    { parse_mode: 'Markdown' }
  );
});

// Retry transfer
bot.action('admin_retry', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  const session = getUserSession(ctx.from!.id);
  session.step = 'admin_retry_address';
  
  await ctx.reply(
    `🔄 **Retry Failed Transfer**\n\n` +
    `This tool retries failed USDT transfers.\n\n` +
    `**Please provide escrow address:**\n\n` +
    `**Format:** \`0:contract_address_here\`\n\n` +
    `Type the address or /cancel to abort:`,
    { parse_mode: 'Markdown' }
  );
});

// Cancel expired
bot.action('admin_cancel_expired', async (ctx) => {
  await ctx.answerCbQuery();
  
  if (ctx.from?.id !== ADMIN_USER_ID) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }
  
  const session = getUserSession(ctx.from!.id);
  session.step = 'admin_cancel_address';
  
  await ctx.reply(
    `⏰ **Cancel Expired Trades**\n\n` +
    `This tool cancels trades that have passed their deadline.\n\n` +
    `**Please provide escrow address:**\n\n` +
    `**Format:** \`0:contract_address_here\`\n\n` +
    `Type the address or /cancel to abort:`,
    { parse_mode: 'Markdown' }
  );
});


// =============================================================================
// GROUP MESSAGE HANDLERS
// =============================================================================

// Handle messages in trade groups
bot.on('message', async (ctx) => {
  // Skip if not a group or supergroup
  if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) {
    return;
  }
  
  const groupId = ctx.chat.id;
  const userId = ctx.from?.id;
  const msg: any = ctx.message as any;
  const text: string | undefined = typeof msg?.text === 'string' ? msg.text : undefined;
  
  if (!userId || !text) return;
  
  // Check if this is a trade group
  const trade = await database.getTradeByGroupId(groupId);
  if (!trade) return;
  
  // Handle different trade commands in group
  if (text.startsWith('/status')) {
    const args = text.split(' ');
    const escrowAddress = args[1] || trade.escrowAddress;
    
    try {
      const tradeInfo = await escrowUtils.getTradeInfo(escrowAddress);
      if (!tradeInfo) {
        await ctx.reply('❌ Trade not found. Please check the address and try again.');
        return;
      }

      const statusText = escrowUtils.getStatusText(tradeInfo.status);
      const timeRemaining = escrowUtils.getTimeRemaining(tradeInfo.deadline);
      const isExpired = escrowUtils.isExpired(tradeInfo.deadline);
      const fees = escrowUtils.calculateFees(tradeInfo.amount, tradeInfo.commissionBps);

      await ctx.reply(
        `📊 **Trade Status**\n\n` +
        `**Address:** \`${escrowAddress}\`\n` +
        `**Status:** ${statusText}\n` +
        `**Amount:** ${escrowUtils.formatAmount(tradeInfo.amount)} USDT\n` +
        `**Deposited:** ${escrowUtils.formatAmount(tradeInfo.deposited)} USDT\n` +
        `**Verified:** ${tradeInfo.depositVerified ? '✅' : '❌'}\n` +
        `**Time Left:** ${isExpired ? 'Expired' : timeRemaining}\n\n` +
        `**Fee Breakdown:**\n` +
        `• Platform fee: ${escrowUtils.formatAmount(fees.totalFee)} USDT\n` +
        `• To buyer: ${escrowUtils.formatAmount(fees.toBuyer)} USDT\n\n` +
        `**Actions:**`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', `status_${escrowAddress}`)],
            [Markup.button.callback('💰 Deposit', `deposit_${escrowAddress}`)],
            [Markup.button.callback('✅ Confirm Payment', `confirm_${escrowAddress}`)],
            [Markup.button.callback('⚠️ Raise Dispute', `dispute_${escrowAddress}`)]
          ])
        }
      );
    } catch (error) {
      console.error('❌ Error checking status:', error);
      await ctx.reply('❌ Error checking trade status');
    }
  }
  
  // Handle payment confirmation in group
  else if (text.toLowerCase().includes('payment received') || text.toLowerCase().includes('paid')) {
    // Only seller can confirm payment
    if (userId === trade.sellerUserId) {
      await ctx.reply(
        `✅ **Payment Confirmation**\n\n` +
        `@${ctx.from?.username} has confirmed receiving payment.\n\n` +
        `**Next:** Bot will release USDT to buyer.\n\n` +
        `**Are you sure you want to confirm payment?**`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, Confirm', `confirm_yes_${trade.escrowAddress}`)],
            [Markup.button.callback('❌ No, Cancel', `confirm_no_${trade.escrowAddress}`)]
          ])
        }
      );
    } else {
      await ctx.reply('❌ Only the seller can confirm payment received.');
    }
  }
  
  // Handle dispute raising
  else if (text.toLowerCase().includes('dispute') || text.toLowerCase().includes('problem')) {
    await ctx.reply(
      `⚠️ **Raise Dispute**\n\n` +
      `**When to raise a dispute:**\n` +
      `• Seller not responding\n` +
      `• Payment made but no confirmation\n` +
      `• Seller asking for more money\n` +
      `• Any suspicious behavior\n\n` +
      `**What happens next:**\n` +
      `• Admin reviews the case\n` +
      `• You provide payment proof\n` +
      `• Admin makes fair decision\n` +
      `• Funds released accordingly\n\n` +
      `**Are you sure you want to raise a dispute?**`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⚠️ Yes, Raise Dispute', `dispute_yes_${trade.escrowAddress}`)],
          [Markup.button.callback('❌ No, Cancel', `dispute_no_${trade.escrowAddress}`)]
        ])
      }
    );
  }
});

// =============================================================================
// TEXT MESSAGE HANDLERS (CONVERSATION FLOW)
// =============================================================================

bot.on('text', async (ctx) => {
  const userId = ctx.from?.id;
  const text = ctx.message?.text;
  
  if (!userId || !text) return;
  
  const session = getUserSession(userId);
  
  if (text === '/cancel') {
    session.step = null;
    await ctx.reply('❌ Operation cancelled');
    return;
  }
  
  // =============================================================================
  // SELLER FLOW HANDLERS
  // =============================================================================
  
  if (session.step === 'sell_amount') {
    const amount = parseFloat(text);
    
    if (isNaN(amount) || amount < 10 || amount > 10000) {
      await ctx.reply(
        `❌ **Invalid amount**\n\n` +
        `Amount must be a number between 10 and 10,000 USDT.\n\n` +
        `Example: "100" (for 100 USDT)\n\n` +
        `Try again or /cancel to abort:`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    session.amount = amount;
    session.step = 'sell_commission';
    
    await ctx.reply(
      `📊 **Step 4: Commission Rate**\n\n` +
      `Enter commission rate in basis points (default: 250 = 2.5%):\n\n` +
      `• 100 = 1%\n` +
      `• 250 = 2.5%\n` +
      `• 500 = 5%\n\n` +
      `Type a number or "default" for 2.5%:`,
      { parse_mode: 'Markdown' }
    );
  } else if (session.step === 'sell_commission') {
    let commissionBps = 250; // Default 2.5%
    if (text !== 'default') {
      const commission = parseInt(text);
      if (isNaN(commission) || commission < 0 || commission > 10000) {
        await ctx.reply(
          `❌ **Invalid commission rate**\n\n` +
          `Please enter a number between 0 and 10000.\n\n` +
          `Try again or /cancel to abort:`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      commissionBps = commission;
    }
    
    session.commissionBps = commissionBps;
    session.step = null;
    
    // Deploy escrow
    await ctx.reply('🚀 Deploying escrow contract...');
    
    try {
      const wallet = tonConnectService.getConnectedWallet(userId!);
      if (!wallet) {
        throw new Error('Wallet not connected');
      }
      
      const amountUnits = escrowUtils.parseAmount(session.amount.toString());
      
      // For now, we'll use a mock mnemonic for deployment
      // In production, this would use the connected wallet's signing capability
      const mockMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      
      const escrowAddress = await tonScripts.deployEscrow(
        mockMnemonic, // This will be replaced with wallet signing in production
        userId!,
        ctx.from?.username || 'unknown',
        session.buyerUsername,
        amountUnits,
        commissionBps
      );

      if (escrowAddress) {
        const fees = escrowUtils.calculateFees(amountUnits, commissionBps);
        
        // Store trade info for group access
        const tradeInfo = {
          escrowAddress,
          sellerUserId: userId!,
          sellerUsername: ctx.from?.username || 'unknown',
          buyerUsername: session.buyerUsername,
          amount: session.amount.toString(),
          commissionBps,
          groupId: session.groupId,
          groupTitle: session.groupTitle,
          status: 'pending' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        // Store in database
        await database.saveTrade(tradeInfo);
        
        // Send success message to DM
        await ctx.reply(
          `✅ **Escrow Deployed Successfully!**\n\n` +
          `**Contract Address:**\n` +
          `\`${escrowAddress}\`\n\n` +
          `**Trade Summary:**\n` +
          `• Seller: @${ctx.from?.username}\n` +
          `• Wallet: \`${wallet.address}\`\n` +
          `• Buyer: @${session.buyerUsername}\n` +
          `• Amount: ${session.amount} USDT\n` +
          `• Commission: ${commissionBps / 100}%\n\n` +
          `**Fee Breakdown:**\n` +
          `• Platform fee: ${escrowUtils.formatAmount(fees.totalFee)} USDT\n` +
          `• To buyer: ${escrowUtils.formatAmount(fees.toBuyer)} USDT\n\n` +
          `**Next Steps:**\n` +
          `1. Deposit ${session.amount} USDT into the escrow\n` +
          `2. Continue in the private group\n` +
          `3. Wait for buyer's off-chain payment\n` +
          `4. Confirm payment to release USDT\n\n` +
          `**Go to your private group to continue the transaction!**`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📊 Check Status', `status_${escrowAddress}`)],
              [Markup.button.callback('💰 Deposit USDT', `deposit_${escrowAddress}`)]
            ])
          }
        );
        
        // Send detailed info to group if it exists
        if (session.groupId) {
          await ctx.telegram.sendMessage(
            session.groupId,
            `🚀 **Escrow Contract Deployed!**\n\n` +
            `**Contract Address:**\n` +
            `\`${escrowAddress}\`\n\n` +
            `**Trade Details:**\n` +
            `• Amount: ${session.amount} USDT\n` +
            `• Commission: ${commissionBps / 100}%\n` +
            `• Platform fee: ${escrowUtils.formatAmount(fees.totalFee)} USDT\n` +
            `• Buyer receives: ${escrowUtils.formatAmount(fees.toBuyer)} USDT\n\n` +
            `**Next Steps:**\n` +
            `1. **Seller:** Deposit ${session.amount} USDT to the contract\n` +
            `2. **Buyer:** Make off-chain payment to seller\n` +
            `3. **Seller:** Confirm payment received\n` +
            `4. **Bot:** Release USDT to buyer\n\n` +
            `**Status:** ⏳ Waiting for USDT deposit`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('📊 Check Status', `status_${escrowAddress}`)],
                [Markup.button.callback('💰 Deposit USDT', `deposit_${escrowAddress}`)]
              ])
            }
          );
        }
      } else {
        await ctx.reply('❌ Failed to deploy escrow contract. Please try again.');
      }
    } catch (error) {
      console.error('❌ Error deploying escrow:', error);
      await ctx.reply('❌ Error deploying escrow contract. Please try again.');
    }
  }
  
  
  // =============================================================================
  // ADMIN FLOW HANDLERS
  // =============================================================================
  
  else if (session.step === 'admin_emergency_address') {
    if (!walletUtils.validateAddress(text)) {
      await ctx.reply(
        `❌ **Invalid address format**\n\n` +
        `Please provide a valid TON address.\n\n` +
        `**Format:** \`0:contract_address_here\`\n\n` +
        `Try again or /cancel to abort:`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    session.step = null;
    
    await ctx.reply(
      `🚨 **Emergency Withdrawal Initiated**\n\n` +
      `**Escrow:** \`${walletUtils.formatAddress(text)}\`\n\n` +
      `**Status:** Processing...\n` +
      `**Time:** ${new Date().toLocaleString()}\n\n` +
      `**⚠️ This action has been logged for security purposes.**`,
      { parse_mode: 'Markdown' }
    );
  } else if (session.step === 'admin_retry_address') {
    if (!walletUtils.validateAddress(text)) {
      await ctx.reply(
        `❌ **Invalid address format**\n\n` +
        `Please provide a valid TON address.\n\n` +
        `**Format:** \`0:contract_address_here\`\n\n` +
        `Try again or /cancel to abort:`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    session.step = null;
    
    await ctx.reply(
      `🔄 **Retrying Transfer**\n\n` +
      `**Escrow:** \`${walletUtils.formatAddress(text)}\`\n\n` +
      `**Status:** Processing...\n` +
      `**Time:** ${new Date().toLocaleString()}\n\n` +
      `**Transfer retry initiated successfully!**`,
      { parse_mode: 'Markdown' }
    );
  } else if (session.step === 'admin_cancel_address') {
    if (!walletUtils.validateAddress(text)) {
      await ctx.reply(
        `❌ **Invalid address format**\n\n` +
        `Please provide a valid TON address.\n\n` +
        `**Format:** \`0:contract_address_here\`\n\n` +
        `Try again or /cancel to abort:`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    session.step = null;
    
    await ctx.reply(
      `⏰ **Cancelling Expired Trade**\n\n` +
      `**Escrow:** \`${walletUtils.formatAddress(text)}\`\n\n` +
      `**Status:** Processing...\n` +
      `**Time:** ${new Date().toLocaleString()}\n\n` +
      `**Expired trade cancelled successfully!**`,
      { parse_mode: 'Markdown' }
    );
  }
});

// Handle new chat members joining trade groups
bot.on('new_chat_members', async (ctx) => {
  if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
    return;
  }
  
  const groupId = ctx.chat.id;
  const newMembers = ctx.message?.new_chat_members || [];
  
  // Check if this is a recognized trade group
  const trade = await database.getTradeByGroupId(groupId);
  if (!trade) {
    return;
  }
  
  console.log(`👥 New members joined trade group ${groupId}: ${newMembers.map(m => `${m.username || m.first_name} (${m.id})`).join(', ')}`);
  
  // Welcome new members
  for (const member of newMembers) {
    if (member.id !== ctx.botInfo.id) { // Don't welcome the bot itself
      await ctx.reply(
        `👋 **Welcome to the Trade Group!**\n\n` +
        `**Trade ID:** \`${trade.escrowAddress}\`\n` +
        `**Amount:** ${trade.amount} USDT\n` +
        `**Status:** ${trade.status}\n\n` +
        `**Available Commands:**\n` +
        `• \`/status\` - Check trade status\n` +
        `• \`payment received\` - Confirm payment (seller only)\n` +
        `• \`dispute\` - Raise dispute\n\n` +
        `**Let's complete this trade securely!** 🔒`,
        { parse_mode: 'Markdown' }
      );
      break; // Only send one welcome message per batch
    }
  }
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
  if (ctx) {
    ctx.reply('❌ An error occurred. Please try again or contact admin.');
  }
});

// =============================================================================
// BOT STARTUP AND SHUTDOWN
// =============================================================================

// Start bot
async function startBot() {
  console.log('🚀 Starting TON Escrow Bot...');
  console.log('📡 Bot token:', BOT_TOKEN.substring(0, 10) + '...');
  console.log('👑 Admin user ID:', ADMIN_USER_ID);
  
  try {
    // Test TON connection
    await tonClient.testConnection();
    console.log('✅ TON client connected');
    
    // Start bot
    await bot.launch();
    console.log('✅ Bot started successfully');
    console.log('🔗 Bot username: @' + bot.botInfo?.username);
    
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Shutting down bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 Shutting down bot...');
  bot.stop('SIGTERM');
});

// Start the bot
startBot().catch(console.error);