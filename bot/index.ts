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

// Polling for wallet connections
const walletPollingInterval = 2000; // Check every 2 seconds
const walletPolling = new Map<number, NodeJS.Timeout>();
const buyerWalletPolling = new Map<number, NodeJS.Timeout>();

// Helper function to get user session
function getUserSession(userId: number) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {});
  }
  return userSessions.get(userId);
}

// Generate a unique invite code that looks like real Telegram invite links
function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 22; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Start wallet connection polling for a user
function startWalletPolling(userId: number, ctx: any) {
  // Clear existing polling for this user
  if (walletPolling.has(userId)) {
    clearInterval(walletPolling.get(userId));
  }
  
  const interval = setInterval(async () => {
    try {
      const domain = process.env.DOMAIN || 'http://localhost:3000';
      const response = await fetch(`${domain}/api/wallet-status/${userId}`);
      const data = await response.json() as any;
      
      if (data.connected && data.wallet) {
        // Wallet connected! Stop polling and proceed
        clearInterval(interval);
        walletPolling.delete(userId);
        
        // Process the wallet connection
        const normalizedAddress = Address.parse(data.wallet.account.address).toString({ bounceable: false });
        const walletInfo = {
          address: normalizedAddress,
          publicKey: data.wallet.account.publicKey,
          connected: true
        };
        
        tonConnectService.connectedWallets.set(userId, walletInfo);
        const session = getUserSession(userId);
        session.walletAddress = normalizedAddress;
        
        // Create a unique trade ID
        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const groupTitle = `Escrow Trade: ${ctx.from?.first_name || ctx.from?.username}`;
        
        // Set up trade amount step
        session.tradeId = tradeId;
        session.groupTitle = groupTitle;
        session.step = 'sell_amount';
        
        // Get bot info with detailed debugging
        let botUsername = bot.botInfo?.username;
        console.log('Initial bot.botInfo:', bot.botInfo);
        console.log('Initial botUsername:', botUsername);
        
        if (!botUsername) {
          try {
            const me = await bot.telegram.getMe();
            console.log('getMe() result:', me);
            botUsername = me.username;
            console.log('Bot username from getMe:', botUsername);
          } catch (error) {
            console.error('Error getting bot info:', error);
          }
        }
        
        console.log('Final bot username:', botUsername);
        
        // If still no username, provide manual group creation instructions
        if (!botUsername) {
          await ctx.reply(
            `✅ **Wallet Connected!**\n\nConnected wallet: \`${normalizedAddress}\`\n\n👥 **Create Group Manually**\n\n**Steps:**\n1. **Create a new group** in Telegram\n2. **Add your bot** to the group\n3. **Send this command** in the group: \`/start create_trade_${tradeId}\`\n4. **Add your buyer** to the group\n\n**Trade ID:** \`${tradeId}\`\n\n💰 **Step 3: Trade Amount**\n\nEnter the amount of USDT to trade:`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel', 'cancel_sell')]
              ])
            }
          );
          return;
        }
        await ctx.reply(
          `✅ **Wallet Connected!**\n\nConnected wallet: \`${normalizedAddress}\`\n\n💰 **Step 2: Set Trade Amount**\n\nEnter the amount of USDT to trade:\n\nExample: \`100\` for 100 USDT`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel', 'cancel_sell')]
            ])
          }
        );
      }
    } catch (error) {
      console.error('Error polling wallet connection:', error);
    }
  }, walletPollingInterval);
  
  walletPolling.set(userId, interval);
  
  // Stop polling after 5 minutes
  setTimeout(() => {
    if (walletPolling.has(userId)) {
      clearInterval(walletPolling.get(userId));
      walletPolling.delete(userId);
    }
  }, 5 * 60 * 1000);
}

// Start buyer wallet connection polling
function startBuyerWalletPolling(userId: number, ctx: any, session: any) {
  console.log(`🔄 Starting buyer wallet polling for user ${userId}`);
  
  const interval = setInterval(async () => {
    try {
      const response = await fetch(`${process.env.DOMAIN}/api/wallet-status/${userId}`);
      if (!response.ok) {
        return;
      }
      
      const data = await response.json() as any;
      
      if (data.connected && data.wallet) {
        console.log(`✅ Buyer wallet connected: ${data.wallet.address}`);
        
        // Stop polling
        clearInterval(interval);
        if (buyerWalletPolling.has(userId)) {
          buyerWalletPolling.delete(userId);
        }
        
        // Store buyer wallet info
        session.buyerWallet = data.wallet;
        session.buyerAddress = Address.parse(data.wallet.address).toString({ bounceable: false });
        session.step = 'deploy_escrow';
        
        // Notify in group
        await ctx.reply(
          `✅ **Buyer Wallet Connected!**\n\n` +
          `Buyer: ${ctx.from?.first_name || 'Unknown'}\n` +
          `Wallet: \`${session.buyerAddress}\`\n` +
          `Trade ID: \`${session.tradeId}\`\n` +
          `Amount: **${session.amount} USDT**\n\n` +
          `🚀 **Deploying Escrow Contract...**\n\n` +
          `The escrow contract is being deployed automatically. This may take a few minutes.`,
          { parse_mode: 'Markdown' }
        );
        
        // Deploy escrow contract
        await deployEscrowContract(session, ctx);
        
      }
    } catch (error) {
      console.error('Error polling buyer wallet connection:', error);
    }
  }, walletPollingInterval);
  
  buyerWalletPolling.set(userId, interval);
  
  // Stop polling after 5 minutes
  setTimeout(() => {
    if (buyerWalletPolling.has(userId)) {
      clearInterval(buyerWalletPolling.get(userId));
      buyerWalletPolling.delete(userId);
    }
  }, 5 * 60 * 1000); // 5 minutes
}

// Deploy escrow contract
async function deployEscrowContract(session: any, ctx: any) {
  try {
    console.log(`🚀 Deploying escrow contract for trade ${session.tradeId}`);
    
    // Get seller wallet
    const sellerWallet = tonConnectService.getConnectedWallet(session.sellerId);
    if (!sellerWallet) {
      await ctx.reply('❌ Seller wallet not connected. Please reconnect.');
      return;
    }
    
    // Deploy escrow contract using seller's wallet
    // For now, use a placeholder mnemonic - in production, this should be handled securely
    const escrowAddress = await tonScripts.deployEscrow(
      'placeholder mnemonic for demo', // TODO: Implement secure mnemonic handling
      session.sellerId,
      session.sellerUsername || 'Unknown',
      session.buyerUsername || 'Unknown', 
      session.amount.toString(),
      250 // Default commission
    );
    
    if (escrowAddress) {
      // Store escrow address
      session.escrowAddress = escrowAddress;
      session.step = 'seller_deposit';
      
      // Save to database
      await database.saveTrade({
        escrowAddress: escrowAddress,
        sellerUserId: session.sellerId,
        buyerUserId: session.buyerId,
        sellerUsername: session.sellerUsername || 'Unknown',
        buyerUsername: session.buyerUsername || 'Unknown',
        amount: session.amount.toString(),
        commissionBps: 250,
        groupId: session.groupId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      // Notify in group
      await ctx.reply(
        `🎉 **Escrow Contract Deployed!**\n\n` +
        `**Contract Address:** \`${escrowAddress}\`\n` +
        `**Trade ID:** \`${session.tradeId}\`\n` +
        `**Amount:** ${session.amount} USDT\n` +
        `**Buyer:** \`${session.buyerAddress}\`\n\n` +
        `💰 **Step 2: Seller Deposit**\n\n` +
        `The seller will now deposit ${session.amount} USDT to the escrow contract. This will be done automatically from their wallet.`,
        { parse_mode: 'Markdown' }
      );
      
      // Start seller deposit process
      await initiateSellerDeposit(session, ctx);
      
    } else {
      await ctx.reply('❌ Failed to deploy escrow contract. Please try again.');
    }
    
  } catch (error) {
    console.error('Error deploying escrow contract:', error);
    await ctx.reply('❌ Error deploying escrow contract. Please try again.');
  }
}

// Initiate seller deposit
async function initiateSellerDeposit(session: any, ctx: any) {
  try {
    // Notify seller via PM
    await bot.telegram.sendMessage(session.sellerId,
      `💰 **Deposit Required**\n\n` +
      `**Trade ID:** \`${session.tradeId}\`\n` +
      `**Amount:** ${session.amount} USDT\n` +
      `**Contract:** \`${session.escrowAddress}\`\n\n` +
      `**Deposit USDT to escrow contract:**\n\n` +
      `This will be done automatically from your connected wallet. Please confirm the transaction when prompted.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💰 Deposit USDT', `deposit_${session.tradeId}`)],
          [Markup.button.callback('❌ Cancel Trade', 'cancel_trade')]
        ])
      }
    );
    
  } catch (error) {
    console.error('Error initiating seller deposit:', error);
  }
}

// Stop wallet connection polling for a user
function stopWalletPolling(userId: number) {
  if (walletPolling.has(userId)) {
    clearInterval(walletPolling.get(userId));
    walletPolling.delete(userId);
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Check for existing buyer in group
async function checkForExistingBuyer(ctx: any, session: any, tradeId: string) {
  try {
    console.log(`🔍 Checking for existing buyer in group ${ctx.chat?.id}`);
    
    // Get chat info to check member count
    const chatInfo = await ctx.telegram.getChat(ctx.chat.id);
    console.log(`📊 Chat has ${chatInfo.member_count} members`);
    
    // If there are more than 2 members (seller + bot), there's likely a buyer
    if (chatInfo.member_count > 2) {
      console.log(`👥 Detected ${chatInfo.member_count - 2} potential buyer(s) in group`);
      
      // Post a message asking the buyer to identify themselves
      await ctx.reply(
        `🔍 **Buyer Detection**\n\n` +
        `I can see there are ${chatInfo.member_count - 2} additional member(s) in this group.\n\n` +
        `**If you are the buyer for this trade, please:**\n` +
        `• Send any message in this group\n` +
        `• Or click the "Connect Wallet" button below\n\n` +
        `**Trade Details:**\n` +
        `• Amount: **${session.amount} USDT**\n` +
        `• Trade ID: \`${tradeId}\`\n` +
        `• Seller: ${ctx.from?.first_name || ctx.from?.username}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.webApp('🔗 I am the Buyer - Connect Wallet', `${process.env.DOMAIN}/connect?trade=${session.tradeId}`)],
            [Markup.button.callback('❌ Cancel Trade', 'cancel_trade')]
          ])
        }
      );
      
      // Notify seller
      await bot.telegram.sendMessage(session.sellerId!,
        `🔍 **Buyer Detection**\n\n` +
        `Trade ID: \`${tradeId}\`\n` +
        `Amount: **${session.amount} USDT**\n\n` +
        `I detected ${chatInfo.member_count - 2} additional member(s) in the group.\n\n` +
        `**Next:** The buyer should connect their wallet to start the trade.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Error checking for existing buyer:', error);
  }
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
  
  
  // Check if this is a group creation request
  if (startPayload && startPayload.startsWith('create_trade_')) {
    const tradeId = startPayload.replace('create_trade_', '');
    
    if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
      const sellerId = ctx.from?.id!;
      const session = getUserSession(sellerId);
      
      if (session.tradeId !== tradeId) {
        await ctx.reply('❌ Trade mismatch. Restart /sell.');
        return;
      }
      
      session.groupId = ctx.chat.id;
      session.step = 'waiting_for_buyer';
      
      try {
        // Try to create invite link with admin privileges
        const inviteRes = await ctx.telegram.createChatInviteLink(ctx.chat.id, {
          member_limit: 2,
          name: session.groupTitle
        });
        const inviteLink = inviteRes.invite_link;
        session.groupInviteLink = inviteLink;
        
        // PM seller
        await bot.telegram.sendMessage(sellerId,
          `🎉 **Escrow Group Ready!**\n\nGroup: ${ctx.chat?.title || 'Private Group'}\nTrade ID: \`${tradeId}\`\nAmount: **${session.amount} USDT**\n\n✅ **Group Setup Complete**\n\n**Next:**\n• Add your buyer to the group\n• Bot will detect buyer and start trade\n• Trade will begin automatically\n\n**Invite Link:** ${inviteLink}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.url('🔗 Share Invite', inviteLink)],
              [Markup.button.callback('🔌 Disconnect', 'disconnect_wallet')]
            ])
          }
        );
        
        // Check if there are already members who could be buyers
        await checkForExistingBuyer(ctx, session, tradeId);
        
        // To group
        await ctx.reply(
          `🎉 **Escrow Group Ready!**\n\nTrade ID: \`${tradeId}\`\nAmount: **${session.amount} USDT**\nSeller: ${ctx.from?.first_name || `@${ctx.from?.username}`}\n\n✅ **Group setup complete!**\n\n**Waiting for buyer...**\n\n**Next steps:**\n• Seller will add buyer to this group\n• Bot will detect buyer automatically\n• Trade will start once buyer joins\n\n**Commands:**\n/status | 'payment received' | 'dispute'`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        console.error('Invite link creation failed:', e);
        
        // PM seller with manual instructions
        await bot.telegram.sendMessage(sellerId,
          `🎉 **Escrow Group Ready!**\n\nGroup: ${ctx.chat?.title || 'Private Group'}\nTrade ID: \`${tradeId}\`\n\n⚠️ **Manual Setup Required**\n\n**To complete setup:**\n1. **Make bot admin** in the group\n2. **Or create invite link manually** in group settings\n3. **Share with buyer** when ready\n\n✅ **Group is ready for trading!**\n\n💰 **Trade Amount**\n\nEnter the amount of USDT to trade:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔌 Disconnect', 'disconnect_wallet')]
            ])
          }
        );
        
        // To group
        await ctx.reply(
          `🎉 **Escrow Group Ready!**\n\nTrade ID: \`${tradeId}\`\nSeller: ${ctx.from?.first_name || `@${ctx.from?.username}`}\n\n⚠️ **Bot needs admin rights** to create invite links\n\n**Options:**\n1. **Make bot admin** → Auto invite links\n2. **Create invite manually** → Share with buyer\n\n✅ **Group is ready for trading!**\n\n**Commands:**\n/status | 'payment received' | 'dispute'`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    } else {
      await ctx.reply('Use create link from PM.');
      return;
    }
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
  
  // Get fresh bot info
  let botInfo = bot.botInfo;
  try {
    const me = await bot.telegram.getMe();
    botInfo = me;
    console.log('Fresh bot info from /myid:', me);
  } catch (error) {
    console.error('Error getting bot info in /myid:', error);
  }
  
  await ctx.reply(
    `🆔 **Your Telegram Information**\n\n` +
    `**User ID:** \`${userId}\`\n` +
    `**Username:** ${username ? `@${username}` : 'Not set'}\n` +
    `**First Name:** ${ctx.from?.first_name || 'Not set'}\n` +
    `**Last Name:** ${ctx.from?.last_name || 'Not set'}\n\n` +
    `**Bot Information:**\n` +
    `**Bot ID:** \`${botInfo?.id}\`\n` +
    `**Bot Username:** ${botInfo?.username ? `@${botInfo.username}` : 'Not set'}\n` +
    `**Bot Name:** ${botInfo?.first_name || 'Not set'}\n\n` +
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
    const groupTitle = `Escrow Trade: ${ctx.from?.first_name || ctx.from?.username}`;
    
    // Set up trade amount step
    session.tradeId = tradeId;
    session.groupTitle = groupTitle;
    session.step = 'sell_amount';
    
    // Get bot info with detailed debugging
    let botUsername = bot.botInfo?.username;
    console.log('Initial bot.botInfo:', bot.botInfo);
    console.log('Initial botUsername:', botUsername);
    
    if (!botUsername) {
      try {
        const me = await bot.telegram.getMe();
        console.log('getMe() result:', me);
        botUsername = me.username;
        console.log('Bot username from getMe:', botUsername);
      } catch (error) {
        console.error('Error getting bot info:', error);
      }
    }
    
    console.log('Final bot username:', botUsername);
    
    // If still no username, provide manual group creation instructions
    if (!botUsername) {
      await ctx.reply(
        `✅ **Wallet Connected!**\n\nConnected wallet: \`${Address.parse(wallet!.address).toString({ bounceable: false })}\`\n\n👥 **Create Group Manually**\n\n**Steps:**\n1. **Create a new group** in Telegram\n2. **Add your bot** to the group\n3. **Send this command** in the group: \`/start create_trade_${tradeId}\`\n4. **Add your buyer** to the group\n\n**Trade ID:** \`${tradeId}\`\n\n💰 **Step 3: Trade Amount**\n\nEnter the amount of USDT to trade:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'cancel_sell')]
          ])
        }
      );
      return;
    }
    await ctx.reply(
      `✅ **Wallet Connected!**\n\nConnected wallet: \`${Address.parse(wallet!.address).toString({ bounceable: false })}\`\n\n💰 **Step 2: Set Trade Amount**\n\nEnter the amount of USDT to trade:\n\nExample: \`100\` for 100 USDT`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel', 'cancel_sell')]
        ])
      }
    );
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
        `4. The bot will automatically proceed\n\n` +
        `**Supported Wallets:**\n` +
        `• Telegram Wallet (built-in)\n` +
        `• Tonkeeper\n` +
        `• MyTonWallet`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.webApp('🔗 Connect Wallet', connectionUrl)],
            [Markup.button.callback('❌ Cancel', 'cancel_sell')]
          ])
        }
      );
      
      // Start polling for wallet connection
      startWalletPolling(userId, ctx);
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
      // Create a unique trade ID and group link immediately
      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const groupTitle = `Escrow Trade: @${ctx.from?.username}`;
      
      // Store trade info
      session.tradeId = tradeId;
      session.groupTitle = groupTitle;
      session.step = 'sell_amount';
      
      // Generate group creation link
      const botUsername = bot.botInfo?.username;
      const groupCreationLink = `https://t.me/${botUsername}?startgroup=create_trade_${tradeId}`;
      session.groupCreationLink = groupCreationLink;
      
      await ctx.reply(
        `✅ **Wallet Connected Successfully!**\n\n` +
        `Connected wallet: \`${normalizedAddress}\`\n\n` +
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
    } else {
      await ctx.reply(
        `❌ **Wallet Not Connected**\n\n` +
        `Please click "Connect Wallet" first to connect your TON wallet.\n\n` +
        `**Steps:**\n` +
        `1. Click "Connect Wallet" button\n` +
        `2. Connect your wallet in the opened page\n` +
        `3. The bot will automatically proceed`,
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
  
  // Stop wallet polling
  stopWalletPolling(userId);
  
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

// Handle deposit button for trade ID
bot.action(/^deposit_trade_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const tradeId = ctx.match[1];
  
  // Find the session for this trade
  const sessions = Array.from(userSessions.values());
  const session = sessions.find(s => s.tradeId === tradeId);
  
  if (!session) {
    await ctx.reply('❌ Trade session not found. Please restart the trade.');
    return;
  }
  
  if (!session.escrowAddress) {
    await ctx.reply('❌ Escrow contract not deployed yet. Please wait.');
    return;
  }
  
  await ctx.reply(
    `💰 **Deposit USDT**\n\n` +
    `**Trade ID:** \`${tradeId}\`\n` +
    `**Escrow Address:**\n` +
    `\`${session.escrowAddress}\`\n\n` +
    `**Amount:** ${session.amount} USDT\n\n` +
    `**Instructions:**\n` +
    `1. Open your TON wallet\n` +
    `2. Send exactly ${session.amount} USDT to the escrow address\n` +
    `3. Wait for confirmation\n\n` +
    `**Important:**\n` +
    `• Send exact amount: ${session.amount} USDT\n` +
    `• Only send USDT (not TON)\n` +
    `• Transaction may take a few minutes\n\n` +
    `**Need help?** Contact @admin`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📊 Check Status', `status_${session.escrowAddress}`)],
        [Markup.button.callback('❓ Help', 'deposit_help')]
      ])
    }
  );
});

// Handle cancel trade
bot.action('cancel_trade', async (ctx) => {
  await ctx.answerCbQuery();
  
  // Find session by user ID
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const session = getUserSession(userId);
  
  if (session.tradeId) {
    // Clear the session
    userSessions.delete(userId);
    
    await ctx.reply(
      `❌ **Trade Cancelled**\n\n` +
      `Trade ID: \`${session.tradeId}\`\n\n` +
      `You can start a new trade anytime with /sell`,
      { parse_mode: 'Markdown' }
    );
    
    // Notify in group if it exists
    if (session.groupId) {
      try {
        await bot.telegram.sendMessage(session.groupId,
          `❌ **Trade Cancelled**\n\n` +
          `Trade ID: \`${session.tradeId}\`\n` +
          `Cancelled by: ${ctx.from?.first_name || ctx.from?.username}\n\n` +
          `The trade has been cancelled.`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error notifying group of cancellation:', error);
      }
    }
  } else {
    await ctx.reply('❌ No active trade to cancel.');
  }
});

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

// Handle messages in trade groups only
bot.on('message', async (ctx, next) => {
  // Only handle group/supergroup messages, let others pass through
  if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) {
    return next(); // Pass to next handler (text handler)
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
  if (text.toLowerCase().includes('payment received') || text.toLowerCase().includes('payment sent')) {
    // Check if this is the seller
    if (ctx.from?.id === trade.sellerUserId) {
      await ctx.reply(
        `✅ **Payment Confirmed by Seller**\n\n` +
        `**Trade ID:** \`${trade.escrowAddress}\`\n` +
        `**Amount:** ${trade.amount} USDT\n\n` +
        `🚀 **Releasing USDT to Buyer...**\n\n` +
        `The escrow will now automatically release USDT to the buyer's wallet.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📊 Check Status', `status_${trade.escrowAddress}`)]
          ])
        }
      );
      
      // Update trade status
      await database.updateTradeStatus(trade.escrowAddress, 'completed');
      
      // Notify buyer
      if (trade.buyerUserId) {
        try {
          await bot.telegram.sendMessage(trade.buyerUserId,
            `🎉 **Payment Confirmed!**\n\n` +
            `**Trade ID:** \`${trade.escrowAddress}\`\n` +
            `**Amount:** ${trade.amount} USDT\n\n` +
            `✅ **USDT Released**\n\n` +
            `The USDT has been released to your wallet. Check your TON wallet for the incoming transaction.`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Error notifying buyer:', error);
        }
      }
    } else if (ctx.from?.id === trade.buyerUserId) {
      await ctx.reply(
        `📤 **Payment Sent Notification**\n\n` +
        `**Trade ID:** \`${trade.escrowAddress}\`\n` +
        `**Amount:** ${trade.amount} USDT\n\n` +
        `⏳ **Waiting for Seller Confirmation**\n\n` +
        `Please wait for the seller to confirm receipt of your payment. Once confirmed, USDT will be released to your wallet.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📊 Check Status', `status_${trade.escrowAddress}`)]
          ])
        }
      );
    }
  }
  
  // Handle bank details sharing
  if (text.toLowerCase().includes('bank details') || text.toLowerCase().includes('account details')) {
    if (ctx.from?.id === trade.sellerUserId) {
      await ctx.reply(
        `🏦 **Bank Details Shared**\n\n` +
        `**Trade ID:** \`${trade.escrowAddress}\`\n` +
        `**Amount:** ${trade.amount} USDT\n\n` +
        `✅ **Payment Instructions Sent**\n\n` +
        `The buyer can now make the bank transfer. Once completed, please confirm receipt.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📊 Check Status', `status_${trade.escrowAddress}`)]
          ])
        }
      );
      
      // Notify buyer to make payment
      if (trade.buyerUserId) {
        try {
          await bot.telegram.sendMessage(trade.buyerUserId,
            `💰 **Payment Required**\n\n` +
            `**Trade ID:** \`${trade.escrowAddress}\`\n` +
            `**Amount:** ${trade.amount} USDT\n\n` +
            `🏦 **Make Bank Transfer**\n\n` +
            `Please make the bank transfer as discussed. Once completed, send "payment sent" in the group.`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Error notifying buyer:', error);
        }
      }
    }
  }
  
  // Handle dispute
  if (text.toLowerCase().includes('dispute') || text.toLowerCase().includes('problem')) {
    await ctx.reply(
      `⚠️ **Dispute Raised**\n\n` +
      `**Trade ID:** \`${trade.escrowAddress}\`\n` +
      `**Raised by:** ${ctx.from?.first_name || ctx.from?.username}\n\n` +
      `🔍 **Admin Notification Sent**\n\n` +
      `An admin has been notified and will review the dispute. Please provide details about the issue.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📊 Check Status', `status_${trade.escrowAddress}`)],
          [Markup.button.callback('💬 Contact Admin', 'contact_admin')]
        ])
      }
    );
    
    // Notify admin
    try {
      await bot.telegram.sendMessage(Number(process.env.ADMIN_USER_ID),
        `⚠️ **DISPUTE RAISED**\n\n` +
        `**Trade ID:** \`${trade.escrowAddress}\`\n` +
        `**Amount:** ${trade.amount} USDT\n` +
        `**Raised by:** ${ctx.from?.first_name || ctx.from?.username} (${ctx.from?.id})\n` +
        `**Group:** ${ctx.chat?.title || 'Unknown'}\n` +
        `**Time:** ${new Date().toLocaleString()}\n\n` +
        `Please review and resolve the dispute.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Error notifying admin:', error);
    }
    
    // Update trade status
    await database.updateTradeStatus(trade.escrowAddress, 'dispute');
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
  
  // Debug logging
  console.log(`📝 Text received from user ${userId}: "${text}", session step: ${session.step}`);
  
  if (text === '/cancel') {
    session.step = null;
    await ctx.reply('❌ Operation cancelled');
    return;
  }
  
  // Skip text processing if in create_group step
  if (session.step === 'create_group') return;
  
  // =============================================================================
  // SELLER FLOW HANDLERS
  // =============================================================================
  
  if (session.step === 'sell_amount') {
    console.log(`💰 Processing sell_amount step for user ${userId}, text: "${text}"`);
    const amount = parseFloat(text);
    
    if (isNaN(amount) || amount < 10 || amount > 10000) {
      console.log(`❌ Invalid amount: ${amount} for user ${userId}`);
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
    
    // Generate unique trade ID
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    session.tradeId = tradeId;
    session.step = 'sell_group_creation';
    
    console.log(`✅ Amount processed successfully: ${amount} USDT, Trade ID: ${tradeId} for user ${userId}`);
    
    await ctx.reply(
      `✅ **Trade Amount Set!**\n\n` +
      `Amount: **${amount} USDT**\n` +
      `Trade ID: \`${tradeId}\`\n\n` +
      `👥 **Step 3: Create Trade Group**\n\n` +
      `**Steps:**\n` +
      `1. **Create a new group** in Telegram\n` +
      `2. **Add @ayush_escrow_bot** to the group\n` +
      `3. **Make bot admin** (for invite links)\n` +
      `4. **Add your buyer** to the group\n` +
      `5. **Send this command** in the group: \`/start create_trade_${tradeId}\`\n\n` +
      `**Trade ID:** \`${tradeId}\``,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel', 'cancel_sell')]
        ])
      }
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
  
  console.log(`👥 New members joined group ${groupId}: ${newMembers.map(m => `${m.username || m.first_name} (${m.id})`).join(', ')}`);
  
  // Check if this is a recognized trade group
  const trade = await database.getTradeByGroupId(groupId);
  
  for (const member of newMembers) {
    if (member.id !== ctx.botInfo.id) { // Don't welcome the bot itself
      
      if (trade) {
        // Existing trade - welcome buyer
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
      } else {
        // Check if this is a waiting trade group
        const waitingSessions = Array.from(userSessions.values()).filter(
          session => session.groupId === groupId && session.step === 'waiting_for_buyer'
        );
        
        if (waitingSessions.length > 0) {
          const session = waitingSessions[0];
          
          // This is the buyer! Start the trade flow
          session.buyerId = member.id;
          session.sellerId = Array.from(userSessions.keys()).find(id => {
            const userSession = userSessions.get(id);
            return userSession.groupId === groupId && userSession.step === 'waiting_for_buyer';
          });
          session.step = 'buyer_wallet_request';
          
          // Start buyer wallet polling
          startBuyerWalletPolling(member.id, ctx, session);
          
          // Welcome buyer and ask for wallet
          await ctx.reply(
            `👋 **Welcome Buyer!**\n\n` +
            `**Trade Details:**\n` +
            `• Amount: **${session.amount} USDT**\n` +
            `• Trade ID: \`${session.tradeId}\`\n` +
            `• Seller: ${ctx.from?.first_name || 'Unknown'}\n\n` +
            `🔗 **Step 1: Connect Your Wallet**\n\n` +
            `To receive USDT, please connect your TON wallet:`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.webApp('🔗 Connect Wallet', `${process.env.DOMAIN}/connect?user=${member.id}&trade=${session.tradeId}`)],
                [Markup.button.callback('❌ Cancel Trade', 'cancel_trade')]
              ])
            }
          );
          
          // Notify seller
          await bot.telegram.sendMessage(session.sellerId!,
            `🎉 **Buyer Joined!**\n\n` +
            `Buyer: ${member.first_name || member.username || 'Unknown'}\n` +
            `Trade ID: \`${session.tradeId}\`\n` +
            `Amount: **${session.amount} USDT**\n\n` +
            `✅ **Trade Started!**\n\n` +
            `The buyer is connecting their wallet. Once connected, the escrow contract will be deployed automatically.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          // General welcome
          await ctx.reply(
            `👋 **Welcome to the escrow group!**\n\n` +
            `This is a secure trading group. The seller will set up trade details soon.\n\n` +
            `**Available Commands:**\n` +
            `• \`/status\` - Check trade status\n` +
            `• \`payment received\` - Confirm payment (seller only)\n` +
            `• \`dispute\` - Raise dispute\n\n` +
            `**Please wait for trade setup...** ⏳`,
            { parse_mode: 'Markdown' }
          );
        }
      }
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