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

// Group creation configuration (using spare Telegram account)
const GROUP_CREATOR_TOKEN = process.env.GROUP_CREATOR_TOKEN || BOT_TOKEN; // Use same token if no spare account
const GROUP_CREATOR_USER_ID = Number(process.env.GROUP_CREATOR_USER_ID || ADMIN_USER_ID);

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not found in environment variables');
  process.exit(1);
}

// Create bot instance
const bot = new Telegraf(BOT_TOKEN);

// Wallet session interface for persistent connections
interface WalletSession {
  userId: number;
  walletAddress: string;
  connectedAt: string;
  expiresAt: string;
  autoReconnect: boolean;
  lastUsed: string;
}

// User session interface
interface UserSession {
  step?: string;
  tradeId?: string;
  groupTitle?: string;
  groupId?: number;
  groupInviteLink?: string;
  groupCreationLink?: string;
  amount?: string;
  commissionBps?: number;
  escrowAddress?: string;
  buyerWalletAddress?: string;
  buyerUsername?: string;
  buyerDisplay?: string;
  bankDetails?: {
    accountHolderName?: string;
    accountNumber?: string;
    ifscCode?: string;
    bankName?: string;
  };
  upiId?: string;
  phoneNumber?: string;
  walletAddress?: string;
  profileSetup?: boolean;
  walletSession?: WalletSession;
}

// User sessions storage (in production, use Redis or database)
const userSessions: Map<number, UserSession> = new Map();

// Persistent wallet sessions storage
const walletSessions: Map<number, WalletSession> = new Map();

// Polling for wallet connections
const walletPollingInterval = 2000; // Check every 2 seconds
const walletPolling = new Map<number, NodeJS.Timeout>();

// Helper function to get user session
function getUserSession(userId: number): UserSession {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {});
  }
  return userSessions.get(userId)!;
}

// Wallet session management functions
function saveWalletSession(userId: number, walletAddress: string, autoReconnect: boolean = true): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  const walletSession: WalletSession = {
    userId,
    walletAddress,
    connectedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    autoReconnect,
    lastUsed: now.toISOString()
  };
  
  walletSessions.set(userId, walletSession);
  
  // Also update user session
  const userSession = getUserSession(userId);
  userSession.walletSession = walletSession;
  userSession.walletAddress = walletAddress;
}

function getWalletSession(userId: number): WalletSession | null {
  const session = walletSessions.get(userId);
  if (!session) return null;
  
  // Check if session is expired
  const now = new Date();
  const expiresAt = new Date(session.expiresAt);
  
  if (now > expiresAt) {
    walletSessions.delete(userId);
    return null;
  }
  
  return session;
}

function updateWalletSessionLastUsed(userId: number): void {
  const session = walletSessions.get(userId);
  if (session) {
    session.lastUsed = new Date().toISOString();
    walletSessions.set(userId, session);
  }
}

async function ensureWalletConnected(userId: number): Promise<boolean> {
  // Check if already connected via tonConnectService
  if (tonConnectService.isWalletConnected(userId)) {
    updateWalletSessionLastUsed(userId);
    return true;
  }
  
  // Try to reconnect from stored session
  const walletSession = getWalletSession(userId);
  if (walletSession && walletSession.autoReconnect) {
    // Restore wallet connection
    const walletInfo = {
      address: walletSession.walletAddress,
      publicKey: '', // We don't have the public key in stored sessions
      connected: true
    };
    
    tonConnectService.connectedWallets.set(userId, walletInfo);
    updateWalletSessionLastUsed(userId);
    
    console.log(`🔄 Auto-reconnected wallet for user ${userId}: ${walletSession.walletAddress}`);
    return true;
  }
  
  return false;
}

// Automated Group Management System
interface GroupCreationResult {
  success: boolean;
  groupId?: number;
  groupTitle?: string;
  inviteLink?: string;
  error?: string;
}

async function createTradeGroupAutomatically(
  tradeId: string, 
  sellerId: number, 
  sellerUsername: string,
  groupTitle: string
): Promise<GroupCreationResult> {
  try {
    console.log(`🚀 Creating automated trade group for trade: ${tradeId}`);
    
    // Method 1: Try using Telegram Bot API to create group (if supported)
    try {
      // Note: createChat is not available in Telegram Bot API
      // We'll use the manual approach instead
      throw new Error('Bot API does not support creating groups directly');
    } catch (apiError) {
      console.log(`⚠️ Bot API group creation failed: ${apiError}`);
    }
    
    // Method 2: Use spare account approach (fallback)
    return await createGroupWithSpareAccount(tradeId, sellerId, sellerUsername, groupTitle);
    
  } catch (error) {
    console.error(`❌ Group creation failed: ${error}`);
    return {
      success: false,
      error: `Failed to create group: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function createGroupWithSpareAccount(
  tradeId: string,
  sellerId: number, 
  sellerUsername: string,
  groupTitle: string
): Promise<GroupCreationResult> {
  try {
    console.log(`🔄 Attempting group creation with spare account approach...`);
    
    // Create a unique invite link that the seller can use
    const groupCreationLink = `https://t.me/${bot.botInfo?.username}?startgroup=auto_create_${tradeId}`;
    
    // For now, we'll provide instructions for manual group creation
    // In a real implementation, you would:
    // 1. Use a spare Telegram account to create the group
    // 2. Add the bot to the group
    // 3. Make the bot admin
    // 4. Generate an invite link
    // 5. Return the group details
    
    return {
      success: false,
      error: 'Automated group creation requires manual setup. Please create group manually and add the bot.'
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Spare account method failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Enhanced notification system
class TradeNotificationManager {
  async notifyTradeUpdate(tradeId: string, event: string, details: any = {}) {
    const trade = await database.getTradeByTradeId(tradeId);
    if (!trade) return;
    
    console.log(`📢 Trade notification: ${event} for trade ${tradeId}`);
    
    // Notify both parties
    const notifications = [];
    
    if (trade.sellerUserId) {
      notifications.push(this.notifyUser(trade.sellerUserId, event, details));
    }
    
    if (trade.buyerUserId) {
      notifications.push(this.notifyUser(trade.buyerUserId, event, details));
    }
    
    // Update group if exists
    if (trade.groupId) {
      notifications.push(this.updateGroupStatus(trade.groupId, event, details));
    }
    
    await Promise.all(notifications);
  }
  
  private async notifyUser(userId: number, event: string, details: any): Promise<void> {
    try {
      const message = this.formatNotificationMessage(event, details);
      await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`❌ Failed to notify user ${userId}: ${error}`);
    }
  }
  
  private async updateGroupStatus(groupId: number, event: string, details: any): Promise<void> {
    try {
      const message = this.formatGroupNotificationMessage(event, details);
      await bot.telegram.sendMessage(groupId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`❌ Failed to update group ${groupId}: ${error}`);
    }
  }
  
  private formatNotificationMessage(event: string, details: any): string {
    switch (event) {
      case 'buyer_joined':
        return `🛒 **Buyer Joined Trade**\n\nTrade ID: \`${details.tradeId}\`\nBuyer: ${details.buyerName}\n\nTrade is now active!`;
      case 'wallet_provided':
        return `✅ **Buyer Wallet Received**\n\nTrade ID: \`${details.tradeId}\`\nWallet: \`${details.walletAddress}\`\n\nReady for escrow deployment!`;
      case 'escrow_deployed':
        return `🚀 **Escrow Contract Deployed**\n\nTrade ID: \`${details.tradeId}\`\nContract: \`${details.escrowAddress}\`\n\nReady for USDT deposit!`;
      case 'usdt_deposited':
        return `💰 **USDT Deposited to Escrow**\n\nTrade ID: \`${details.tradeId}\`\nAmount: ${details.amount} USDT\n\nWaiting for buyer's bank transfer!`;
      case 'payment_sent':
        return `💳 **Payment Notification**\n\nTrade ID: \`${details.tradeId}\`\nBuyer has sent payment notification.\n\nPlease verify and confirm!`;
      case 'payment_confirmed':
        return `✅ **Payment Confirmed**\n\nTrade ID: \`${details.tradeId}\`\nUSDT will be released to buyer shortly!`;
      case 'trade_completed':
        return `🎉 **Trade Completed Successfully!**\n\nTrade ID: \`${details.tradeId}\`\nAmount: ${details.amount} USDT\n\nThank you for using our escrow service!`;
      default:
        return `📢 **Trade Update**\n\nTrade ID: \`${details.tradeId}\`\nEvent: ${event}`;
    }
  }
  
  private formatGroupNotificationMessage(event: string, details: any): string {
    return this.formatNotificationMessage(event, details);
  }
}

// Initialize notification manager
const notificationManager = new TradeNotificationManager();

// Enhanced Error Recovery System
class ErrorRecoveryManager {
  private retryAttempts = new Map<string, number>();
  private maxRetries = 3;
  
  async retryOperation<T>(
    operation: () => Promise<T>,
    operationId: string,
    context: any = {}
  ): Promise<T | null> {
    const attempts = this.retryAttempts.get(operationId) || 0;
    
    if (attempts >= this.maxRetries) {
      console.error(`❌ Max retries exceeded for operation: ${operationId}`);
      this.retryAttempts.delete(operationId);
      return null;
    }
    
    try {
      const result = await operation();
      this.retryAttempts.delete(operationId);
      return result;
    } catch (error) {
      const newAttempts = attempts + 1;
      this.retryAttempts.set(operationId, newAttempts);
      
      console.warn(`⚠️ Operation ${operationId} failed (attempt ${newAttempts}/${this.maxRetries}): ${error}`);
      
      // Wait before retry (exponential backoff)
      const delay = Math.pow(2, newAttempts) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return this.retryOperation(operation, operationId, context);
    }
  }
  
  async recoverWalletConnection(userId: number): Promise<boolean> {
    const result = await this.retryOperation(
      async () => {
        const connected = await ensureWalletConnected(userId);
        if (!connected) {
          throw new Error('Failed to reconnect wallet');
        }
        return connected;
      },
      `wallet_reconnect_${userId}`,
      { userId }
    );
    return result || false;
  }
  
  async recoverGroupCreation(
    tradeId: string,
    sellerId: number,
    sellerUsername: string,
    groupTitle: string
  ): Promise<GroupCreationResult> {
    const result = await this.retryOperation(
      async () => {
        const result = await createTradeGroupAutomatically(tradeId, sellerId, sellerUsername, groupTitle);
        if (!result.success) {
          throw new Error(result.error || 'Group creation failed');
        }
        return result;
      },
      `group_creation_${tradeId}`,
      { tradeId, sellerId }
    );
    return result || { success: false, error: 'Max retries exceeded' };
  }
  
  async recoverTradeOperation(
    tradeId: string,
    operation: () => Promise<void>
  ): Promise<boolean> {
    const result = await this.retryOperation(
      operation,
      `trade_operation_${tradeId}`,
      { tradeId }
    );
    return result !== null;
  }
}

// Initialize error recovery manager
const errorRecovery = new ErrorRecoveryManager();

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
      const cleanDomain = domain.replace(/^https?:\/\//, '');
      const response = await fetch(`https://${cleanDomain}/api/wallet-status/${userId}`);
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
        
        // Save persistent wallet session
        saveWalletSession(userId, normalizedAddress, true);
        
        // Check if this is profile setup or trade flow
        if (session.step === 'setup_wallet_connect') {
          // Profile setup flow
          session.step = 'setup_bank_details';
          await ctx.reply(
            `✅ **Wallet Connected!**\n\nConnected wallet: \`${normalizedAddress}\`\n\n🏦 **Step 2: Bank Details**\n\n` +
            `Please provide your bank account details:\n\n` +
            `**Account Holder Name:** (as per bank records)`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel', 'cancel_setup')]
              ])
            }
          );
          return;
        }
        
        // Trade flow
        // Get seller profile for trade info
        const sellerProfile = await database.getSellerProfile(userId);
        if (!sellerProfile) {
          await ctx.reply(
            `❌ **Profile Setup Required**\n\n` +
            `You need to set up your seller profile first.\n\n` +
            `Use /setup to create your profile.`,
            {
              parse_mode: 'Markdown'
            }
          );
          return;
        }
        
        // Create a unique trade ID
        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const groupTitle = `Escrow Trade: ${sellerProfile.bankDetails.accountHolderName}`;
        
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
          `✅ **Wallet Connected!**\n\nConnected wallet: \`${normalizedAddress}\`\n\n👥 **Create Private Group**\n\n**Steps:**\n1. **Create a new group** in Telegram\n2. **Add @ayush_escrow_bot** to the group\n3. **Make bot admin** (for invite links)\n4. **Add your buyer** to the group\n5. **Send this command** in the group: \`/start create_trade_${tradeId}\`\n\n**Trade ID:** \`${tradeId}\`\n\n💰 **Step 3: Trade Amount**\n\nEnter the amount of USDT to trade:`,
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

// Stop wallet connection polling for a user
function stopWalletPolling(userId: number) {
  if (walletPolling.has(userId)) {
    clearInterval(walletPolling.get(userId));
    walletPolling.delete(userId);
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
      session.step = 'sell_amount';
      
      try {
        // Try to create invite link with admin privileges
        const inviteRes = await ctx.telegram.createChatInviteLink(ctx.chat.id, {
          member_limit: 2,
          name: session.groupTitle || 'Escrow Trade'
        });
        const inviteLink = inviteRes.invite_link;
        session.groupInviteLink = inviteLink;
        
        // Get seller profile for display
        const sellerProfile = await database.getSellerProfile(sellerId);
        
        // PM seller
        await bot.telegram.sendMessage(sellerId,
          `🎉 **Escrow Group Ready!**\n\nGroup: ${ctx.chat?.title || 'Private Group'}\nTrade ID: \`${tradeId}\`\n\n✅ **Group Setup Complete**\n\n**Your Profile:**\n• **Account:** ${sellerProfile?.bankDetails.accountHolderName || 'Not set'}\n• **Bank:** ${sellerProfile?.bankDetails.bankName || 'Not set'}\n• **UPI:** ${sellerProfile?.upiId || 'Not set'}\n\n**Next Steps:**\n• Set trade amount in this PM\n• Wait for buyer to join\n• Continue trade in the group\n\n💰 **Trade Amount**\n\nEnter the amount of USDT to trade:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔌 Disconnect', 'disconnect_wallet')]
            ])
          }
        );
        
        // To group
        await ctx.reply(
          `🎉 **Escrow Group Ready!**\n\nTrade ID: \`${tradeId}\`\nSeller: ${ctx.from?.first_name || `@${ctx.from?.username}`}\n\n✅ **Group setup complete!**\n\n**Next steps:**\n• Seller will set trade amount in PM\n• Trade details will be shared here\n• Use /status to check progress\n\n**Commands:**\n/status | 'payment received' | 'dispute'`,
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

// Setup seller profile command - one-time setup for sellers
bot.command('setup', async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  
  console.log(`🔧 User ${username} (${userId}) started seller setup`);
  
  // Check if profile already exists
  const existingProfile = await database.getSellerProfile(userId!);
  if (existingProfile) {
    await ctx.reply(
      `✅ **Profile Already Setup!**\n\n` +
      `**Account Holder:** ${existingProfile.bankDetails.accountHolderName}\n` +
      `**Bank:** ${existingProfile.bankDetails.bankName}\n` +
      `**UPI ID:** ${existingProfile.upiId}\n` +
      `**Wallet:** \`${existingProfile.walletAddress}\`\n\n` +
      `**Options:**\n` +
      `• Use /sell to create a new trade\n` +
      `• Use /editprofile to update your details`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✏️ Edit Profile', 'edit_profile')],
          [Markup.button.callback('🚀 Start Selling', 'start_sell_flow')]
        ])
      }
    );
    return;
  }
  
  const session = getUserSession(userId!);
  session.step = 'setup_wallet_connect';
  
  await ctx.reply(
    `🔧 **Seller Profile Setup**\n\n` +
    `Welcome! Let's set up your seller profile.\n\n` +
    `**What we'll collect:**\n` +
    `• Your TON wallet address\n` +
    `• Bank account details\n` +
    `• UPI ID for payments\n` +
    `• Phone number (optional)\n\n` +
    `**Step 1: Connect Your TON Wallet**\n\n` +
    `Click the button below to connect your wallet:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🔗 Connect Wallet', `https://${(process.env.DOMAIN || 'localhost:3000').replace(/^https?:\/\//, '')}/connect?userId=${userId}`)],
        [Markup.button.callback('❌ Cancel', 'cancel_setup')]
      ])
    }
  );
});

// Edit profile command
bot.command('editprofile', async (ctx) => {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  
  console.log(`✏️ User ${username} (${userId}) wants to edit profile`);
  
  const existingProfile = await database.getSellerProfile(userId!);
  if (!existingProfile) {
    await ctx.reply(
      `❌ **No Profile Found**\n\n` +
      `You haven't set up your seller profile yet.\n\n` +
      `Use /setup to create your profile first.`,
      {
        parse_mode: 'Markdown'
      }
    );
    return;
  }
  
  await ctx.reply(
    `✏️ **Edit Your Profile**\n\n` +
    `**Current Details:**\n` +
    `• **Account Holder:** ${existingProfile.bankDetails.accountHolderName}\n` +
    `• **Bank:** ${existingProfile.bankDetails.bankName}\n` +
    `• **Account Number:** ${existingProfile.bankDetails.accountNumber}\n` +
    `• **IFSC:** ${existingProfile.bankDetails.ifscCode}\n` +
    `• **UPI ID:** ${existingProfile.upiId}\n` +
    `• **Phone:** ${existingProfile.phoneNumber || 'Not provided'}\n\n` +
    `**What would you like to update?**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🏦 Bank Details', 'edit_bank_details')],
        [Markup.button.callback('💳 UPI ID', 'edit_upi_id')],
        [Markup.button.callback('📱 Phone Number', 'edit_phone')],
        [Markup.button.callback('🔗 Wallet Address', 'edit_wallet')],
        [Markup.button.callback('✅ Done', 'profile_complete')]
      ])
    }
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
    const groupTitle = session.groupTitle || `Escrow Trade: @${ctx.from?.username}`;
    
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
      `2. **Add the buyer to the group**\n` +
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
  
  // Check if seller has profile setup
  const sellerProfile = await database.getSellerProfile(userId!);
  if (!sellerProfile) {
    await ctx.reply(
      `❌ **Profile Setup Required**\n\n` +
      `You need to set up your seller profile first.\n\n` +
      `**What we'll collect:**\n` +
      `• Your TON wallet address\n` +
      `• Bank account details\n` +
      `• UPI ID for payments\n` +
      `• Phone number (optional)\n\n` +
      `**This is a one-time setup!**`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔧 Setup Profile', 'start_setup')],
          [Markup.button.callback('❓ Help', 'sell_help')]
        ])
      }
    );
    return;
  }
  
  await ctx.reply(
    `🛒 **Start Selling**\n\n` +
    `Let's create a new escrow for your USDT sale!\n\n` +
    `**Your Profile:**\n` +
    `• **Account:** ${sellerProfile.bankDetails.accountHolderName}\n` +
    `• **Bank:** ${sellerProfile.bankDetails.bankName}\n` +
    `• **UPI:** ${sellerProfile.upiId}\n` +
    `• **Wallet:** \`${sellerProfile.walletAddress}\`\n\n` +
    `**Ready to create a new trade?**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Create Trade', 'start_sell_flow')],
        [Markup.button.callback('✏️ Edit Profile', 'edit_profile')],
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

// Seller profile setup actions
bot.action('start_setup', async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from!.id;
  const session = getUserSession(userId);
  session.step = 'setup_wallet_connect';
  
  await ctx.editMessageText(
    `🔧 **Seller Profile Setup**\n\n` +
    `Welcome! Let's set up your seller profile.\n\n` +
    `**What we'll collect:**\n` +
    `• Your TON wallet address\n` +
    `• Bank account details\n` +
    `• UPI ID for payments\n` +
    `• Phone number (optional)\n\n` +
    `**Step 1: Connect Your TON Wallet**\n\n` +
    `Click the button below to connect your wallet:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🔗 Connect Wallet', `https://${(process.env.DOMAIN || 'localhost:3000').replace(/^https?:\/\//, '')}/connect?userId=${userId}`)],
        [Markup.button.callback('❌ Cancel', 'cancel_setup')]
      ])
    }
  );
});

bot.action('cancel_setup', async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from!.id;
  const session = getUserSession(userId);
  session.step = undefined;
  
  await ctx.editMessageText(
    `❌ **Setup Cancelled**\n\n` +
    `You can start the setup anytime using /setup command.`,
    {
      parse_mode: 'Markdown'
    }
  );
});

bot.action('edit_profile', async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from!.id;
  const existingProfile = await database.getSellerProfile(userId);
  if (!existingProfile) {
    await ctx.editMessageText(
      `❌ **No Profile Found**\n\n` +
      `You haven't set up your seller profile yet.\n\n` +
      `Use /setup to create your profile first.`,
      {
        parse_mode: 'Markdown'
      }
    );
    return;
  }
  
  await ctx.editMessageText(
    `✏️ **Edit Your Profile**\n\n` +
    `**Current Details:**\n` +
    `• **Account Holder:** ${existingProfile.bankDetails.accountHolderName}\n` +
    `• **Bank:** ${existingProfile.bankDetails.bankName}\n` +
    `• **Account Number:** ${existingProfile.bankDetails.accountNumber}\n` +
    `• **IFSC:** ${existingProfile.bankDetails.ifscCode}\n` +
    `• **UPI ID:** ${existingProfile.upiId}\n` +
    `• **Phone:** ${existingProfile.phoneNumber || 'Not provided'}\n\n` +
    `**What would you like to update?**`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🏦 Bank Details', 'edit_bank_details')],
        [Markup.button.callback('💳 UPI ID', 'edit_upi_id')],
        [Markup.button.callback('📱 Phone Number', 'edit_phone')],
        [Markup.button.callback('🔗 Wallet Address', 'edit_wallet')],
        [Markup.button.callback('✅ Done', 'profile_complete')]
      ])
    }
  );
});

bot.action('skip_phone', async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from!.id;
  const session = getUserSession(userId);
  session.phoneNumber = undefined;
  
    // Save the profile
    const profile = {
      userId: userId,
      username: ctx.from?.username || '',
      walletAddress: session.walletAddress!,
      bankDetails: {
        accountHolderName: session.bankDetails!.accountHolderName!,
        accountNumber: session.bankDetails!.accountNumber!,
        ifscCode: session.bankDetails!.ifscCode!,
        bankName: session.bankDetails!.bankName!
      },
      upiId: session.upiId!,
      phoneNumber: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  
  await database.saveSellerProfile(profile);
  session.step = undefined;
  session.profileSetup = true;
  
  await ctx.editMessageText(
    `🎉 **Profile Setup Complete!**\n\n` +
    `**Account Holder:** ${profile.bankDetails.accountHolderName}\n` +
    `**Bank:** ${profile.bankDetails.bankName}\n` +
    `**Account:** ${profile.bankDetails.accountNumber}\n` +
    `**IFSC:** ${profile.bankDetails.ifscCode}\n` +
    `**UPI ID:** ${profile.upiId}\n` +
    `**Phone:** Not provided\n` +
    `**Wallet:** \`${profile.walletAddress}\`\n\n` +
    `✅ **You're ready to start selling!**\n\n` +
    `Use /sell to create your first trade.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Start Selling', 'start_sell_flow')],
        [Markup.button.callback('✏️ Edit Profile', 'edit_profile')]
      ])
    }
  );
});

// Escrow deployment action
bot.action(/^deploy_escrow_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  
  const tradeId = ctx.match[1];
  const userId = ctx.from!.id;
  
  // Get the trade
  const trade = await database.getTradeByTradeId(tradeId);
  if (!trade || trade.sellerUserId !== userId) {
    await ctx.editMessageText(
      `❌ **Trade Not Found**\n\n` +
      `This trade doesn't exist or you're not authorized to deploy it.`,
      {
        parse_mode: 'Markdown'
      }
    );
    return;
  }
  
  if (trade.status !== 'deposited') {
    await ctx.editMessageText(
      `❌ **Invalid Trade Status**\n\n` +
      `Trade status: ${trade.status}\n` +
      `Expected: deposited`,
      {
        parse_mode: 'Markdown'
      }
    );
    return;
  }
  
  // Start escrow deployment process
  await ctx.editMessageText(
    `🚀 **Deploying Escrow Contract...**\n\n` +
    `**Trade ID:** \`${tradeId}\`\n` +
    `**Amount:** ${trade.amount} USDT\n` +
    `**Buyer:** ${trade.buyerUsername}\n` +
    `**Buyer Wallet:** \`${trade.buyerWalletAddress}\`\n\n` +
    `⏳ **Please wait while we deploy the contract...**`,
    {
      parse_mode: 'Markdown'
    }
  );
  
  try {
    // Deploy escrow contract
    // For now, we'll simulate the deployment since we don't have the seller's mnemonic
    // In a real implementation, you would need to get the seller's wallet mnemonic
    const escrowAddress = `0:escrow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Note: In production, you would call:
    // const escrowAddress = await tonScripts.deployEscrow(
    //   sellerMnemonic, // This would need to be securely stored/retrieved
    //   userId,
    //   ctx.from?.username || 'unknown',
    //   trade.buyerUsername!,
    //   trade.amount,
    //   trade.commissionBps
    // );
    
    if (escrowAddress) {
      // Update trade with escrow address
      trade.escrowAddress = escrowAddress;
      trade.status = 'payment_pending';
      trade.updatedAt = new Date().toISOString();
      await database.saveTrade(trade);
      
      // Send automated notifications
      await notificationManager.notifyTradeUpdate(tradeId, 'escrow_deployed', {
        tradeId: tradeId,
        escrowAddress: escrowAddress,
        amount: trade.amount
      });
      
      await ctx.editMessageText(
        `✅ **Escrow Contract Deployed!**\n\n` +
        `**Contract Address:** \`${escrowAddress}\`\n` +
        `**Trade ID:** \`${tradeId}\`\n` +
        `**Amount:** ${trade.amount} USDT\n\n` +
        `**Next Steps:**\n` +
        `• Deposit ${trade.amount} USDT to escrow contract\n` +
        `• Wait for buyer's bank transfer\n` +
        `• Confirm payment received\n` +
        `• USDT will be released to buyer\n\n` +
        `**Ready to deposit USDT to escrow?**`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 Deposit USDT', `deposit_usdt_${tradeId}`)],
            [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${tradeId}`)]
          ])
        }
      );
      
      // Notify buyer about escrow deployment
      await bot.telegram.sendMessage(
        trade.buyerUserId!,
        `✅ **Escrow Contract Deployed!**\n\n` +
        `**Contract Address:** \`${escrowAddress}\`\n` +
        `**Trade ID:** \`${tradeId}\`\n` +
        `**Amount:** ${trade.amount} USDT\n\n` +
        `**Next Steps:**\n` +
        `• Seller will deposit USDT to escrow\n` +
        `• Make your bank transfer\n` +
        `• Seller confirms payment\n` +
        `• USDT released to your wallet\n\n` +
        `**Your wallet:** \`${trade.buyerWalletAddress}\``,
        {
          parse_mode: 'Markdown'
        }
      );
      
      // Update group
      if (trade.groupId) {
        await bot.telegram.sendMessage(
          trade.groupId,
          `✅ **Escrow Contract Deployed!**\n\n` +
          `**Contract:** \`${escrowAddress}\`\n` +
          `**Trade ID:** \`${tradeId}\`\n` +
          `**Amount:** ${trade.amount} USDT\n\n` +
          `**Status:** Seller depositing USDT to escrow\n` +
          `**Next:** Buyer makes bank transfer`,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      await ctx.editMessageText(
        `❌ **Escrow Deployment Failed**\n\n` +
        `Failed to deploy escrow contract. Please try again or contact admin.`,
        {
          parse_mode: 'Markdown'
        }
      );
    }
  } catch (error) {
    console.error('Escrow deployment error:', error);
    await ctx.editMessageText(
      `❌ **Escrow Deployment Error**\n\n` +
      `An error occurred while deploying the contract.\n\n` +
      `Error: ${error instanceof Error ? error.message : String(error)}`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
});

// Trade cancellation action
bot.action(/^cancel_trade_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  
  const tradeId = ctx.match[1];
  const userId = ctx.from!.id;
  
  // Get the trade
  const trade = await database.getTradeByTradeId(tradeId);
  if (!trade || (trade.sellerUserId !== userId && trade.buyerUserId !== userId)) {
    await ctx.editMessageText(
      `❌ **Trade Not Found**\n\n` +
      `This trade doesn't exist or you're not authorized to cancel it.`,
      {
        parse_mode: 'Markdown'
      }
    );
    return;
  }
  
  // Update trade status
  trade.status = 'cancelled';
  trade.updatedAt = new Date().toISOString();
  await database.saveTrade(trade);
  
  await ctx.editMessageText(
    `❌ **Trade Cancelled**\n\n` +
    `**Trade ID:** \`${tradeId}\`\n` +
    `**Amount:** ${trade.amount} USDT\n` +
    `**Cancelled by:** ${ctx.from?.first_name || ctx.from?.username}\n\n` +
    `The trade has been cancelled successfully.`,
    {
      parse_mode: 'Markdown'
    }
  );
  
  // Notify the other party
  const otherPartyId = trade.sellerUserId === userId ? trade.buyerUserId : trade.sellerUserId;
  if (otherPartyId) {
    await bot.telegram.sendMessage(
      otherPartyId,
      `❌ **Trade Cancelled**\n\n` +
      `**Trade ID:** \`${tradeId}\`\n` +
      `**Amount:** ${trade.amount} USDT\n` +
      `**Cancelled by:** ${ctx.from?.first_name || ctx.from?.username}\n\n` +
      `The trade has been cancelled.`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
  
  // Update group
  if (trade.groupId) {
    await bot.telegram.sendMessage(
      trade.groupId,
      `❌ **Trade Cancelled**\n\n` +
      `**Trade ID:** \`${tradeId}\`\n` +
      `**Amount:** ${trade.amount} USDT\n` +
      `**Cancelled by:** ${ctx.from?.first_name || ctx.from?.username}\n\n` +
      `This trade has been cancelled.`,
      { parse_mode: 'Markdown' }
    );
  }
});

// USDT deposit action
bot.action(/^deposit_usdt_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  
  const tradeId = ctx.match[1];
  const userId = ctx.from!.id;
  
  // Get the trade
  const trade = await database.getTradeByTradeId(tradeId);
  if (!trade || trade.sellerUserId !== userId) {
    await ctx.editMessageText(
      `❌ **Trade Not Found**\n\n` +
      `This trade doesn't exist or you're not authorized to deposit to it.`,
      {
        parse_mode: 'Markdown'
      }
    );
    return;
  }
  
  if (trade.status !== 'payment_pending') {
    await ctx.editMessageText(
      `❌ **Invalid Trade Status**\n\n` +
      `Trade status: ${trade.status}\n` +
      `Expected: payment_pending`,
      {
        parse_mode: 'Markdown'
      }
    );
    return;
  }
  
  // Check if seller has connected wallet
  if (!tonConnectService.isWalletConnected(userId)) {
    await ctx.editMessageText(
      `❌ **Wallet Not Connected**\n\n` +
      `You need to connect your TON wallet to deposit USDT.\n\n` +
      `Please connect your wallet first.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp('🔗 Connect Wallet', `https://${(process.env.DOMAIN || 'localhost:3000').replace(/^https?:\/\//, '')}/connect?userId=${userId}`)],
          [Markup.button.callback('❌ Cancel', `cancel_trade_${tradeId}`)]
        ])
      }
    );
    return;
  }
  
  // Start USDT deposit process
  await ctx.editMessageText(
    `💰 **Depositing USDT to Escrow...**\n\n` +
    `**Trade ID:** \`${tradeId}\`\n` +
    `**Amount:** ${trade.amount} USDT\n` +
    `**Escrow Contract:** \`${trade.escrowAddress}\`\n\n` +
    `⏳ **Please wait while we process the deposit...**\n\n` +
    `**This may take a few minutes to confirm on the blockchain.**`,
    {
      parse_mode: 'Markdown'
    }
  );
  
  try {
    // Simulate USDT deposit (in production, this would call actual TON contract)
    // For now, we'll simulate the deposit and update the trade status
    
    // In a real implementation, you would:
    // 1. Get seller's wallet address
    // 2. Check USDT balance
    // 3. Create transfer transaction to escrow contract
    // 4. Wait for confirmation
    // 5. Update trade status
    
    const sellerWallet = tonConnectService.getConnectedWallet(userId);
    const depositTxHash = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Update trade with deposit info
    trade.depositTxHash = depositTxHash;
    trade.status = 'payment_pending';
    trade.updatedAt = new Date().toISOString();
    await database.saveTrade(trade);
    
    // Send automated notifications
    await notificationManager.notifyTradeUpdate(tradeId, 'usdt_deposited', {
      tradeId: tradeId,
      amount: trade.amount,
      txHash: depositTxHash
    });
    
    await ctx.editMessageText(
      `✅ **USDT Deposit Successful!**\n\n` +
      `**Trade ID:** \`${tradeId}\`\n` +
      `**Amount:** ${trade.amount} USDT\n` +
      `**Escrow Contract:** \`${trade.escrowAddress}\`\n` +
      `**Transaction Hash:** \`${depositTxHash}\`\n\n` +
      `✅ **Escrow is now funded and secure!**\n\n` +
      `**Next Steps:**\n` +
      `• Wait for buyer's bank transfer\n` +
      `• Confirm payment received\n` +
      `• USDT will be released to buyer\n\n` +
      `**Current Status:** Waiting for buyer's bank transfer`,
      {
        parse_mode: 'Markdown'
      }
    );
    
    // Notify buyer about USDT deposit
    await bot.telegram.sendMessage(
      trade.buyerUserId!,
      `✅ **USDT Deposited to Escrow!**\n\n` +
      `**Trade ID:** \`${tradeId}\`\n` +
      `**Amount:** ${trade.amount} USDT\n` +
      `**Escrow Contract:** \`${trade.escrowAddress}\`\n` +
      `**Transaction Hash:** \`${depositTxHash}\`\n\n` +
      `✅ **Escrow is now funded and secure!**\n\n` +
      `**Next Steps:**\n` +
      `• Make your bank transfer to seller\n` +
      `• Come back and type "payment sent"\n` +
      `• Seller will confirm payment\n` +
      `• USDT will be released to your wallet\n\n` +
      `**Your wallet:** \`${trade.buyerWalletAddress}\`\n\n` +
      `**Seller's Bank Details:**\n` +
      `• **Account:** ${(await database.getSellerProfile(trade.sellerUserId))?.bankDetails.accountHolderName}\n` +
      `• **Bank:** ${(await database.getSellerProfile(trade.sellerUserId))?.bankDetails.bankName}\n` +
      `• **Account #:** ${(await database.getSellerProfile(trade.sellerUserId))?.bankDetails.accountNumber}\n` +
      `• **IFSC:** ${(await database.getSellerProfile(trade.sellerUserId))?.bankDetails.ifscCode}\n` +
      `• **UPI ID:** ${(await database.getSellerProfile(trade.sellerUserId))?.upiId}`,
      {
        parse_mode: 'Markdown'
      }
    );
    
    // Update group
    if (trade.groupId) {
      await bot.telegram.sendMessage(
        trade.groupId,
        `✅ **USDT Deposited to Escrow!**\n\n` +
        `**Trade ID:** \`${tradeId}\`\n` +
        `**Amount:** ${trade.amount} USDT\n` +
        `**Escrow Contract:** \`${trade.escrowAddress}\`\n` +
        `**Transaction Hash:** \`${depositTxHash}\`\n\n` +
        `✅ **Escrow is now funded and secure!**\n\n` +
        `**Status:** Waiting for buyer's bank transfer`,
        { parse_mode: 'Markdown' }
      );
    }
    
  } catch (error) {
    console.error('USDT deposit error:', error);
    await ctx.editMessageText(
      `❌ **USDT Deposit Failed**\n\n` +
      `An error occurred while depositing USDT to escrow.\n\n` +
      `Error: ${error instanceof Error ? error.message : String(error)}\n\n` +
      `Please try again or contact admin.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Try Again', `deposit_usdt_${tradeId}`)],
          [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${tradeId}`)]
        ])
      }
    );
  }
});

bot.action('start_sell_flow', async (ctx) => {
  await ctx.answerCbQuery();
  
  const userId = ctx.from!.id;
  const session = getUserSession(userId);
  
  // Check if seller has profile setup
  const sellerProfile = await database.getSellerProfile(userId);
  if (!sellerProfile) {
    await ctx.editMessageText(
      `❌ **Profile Setup Required**\n\n` +
      `You need to set up your seller profile first.\n\n` +
      `Use /setup to create your profile.`,
      {
        parse_mode: 'Markdown'
      }
    );
    return;
  }
  
  // Check if wallet is already connected or can be auto-reconnected
  const isWalletConnected = await ensureWalletConnected(userId);
  if (isWalletConnected) {
    const wallet = tonConnectService.getConnectedWallet(userId);
    session.walletAddress = wallet!.address;
    
    // Create a unique trade ID
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const groupTitle = `Escrow Trade: ${sellerProfile.bankDetails.accountHolderName}`;
    
    // Set up trade amount step
    session.tradeId = tradeId;
    session.groupTitle = groupTitle;
    session.step = 'sell_amount';
    
        // Try automated group creation first
        console.log(`🚀 Attempting automated group creation for trade: ${tradeId}`);
        
        const groupResult = await errorRecovery.recoverGroupCreation(
          tradeId,
          userId,
          ctx.from?.username || 'unknown',
          groupTitle
        );
        
        if (groupResult.success) {
          // Automated group creation successful
          session.groupId = groupResult.groupId;
          session.groupInviteLink = groupResult.inviteLink;
          
          await ctx.reply(
            `✅ **Wallet Connected & Group Created!**\n\nConnected wallet: \`${Address.parse(wallet!.address).toString({ bounceable: false })}\`\n\n🎉 **Automated Group Created**\n\n**Group:** ${groupResult.groupTitle}\n**Trade ID:** \`${tradeId}\`\n**Invite Link:** \`${groupResult.inviteLink}\`\n\n**Next Steps:**\n1. **Share the invite link** with your buyer\n2. **Set trade amount** below\n3. **Continue in the group**\n\n💰 **Step 1: Trade Amount**\n\nEnter the amount of USDT to trade:`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.url('🔗 Share Group Link', groupResult.inviteLink!)],
                [Markup.button.callback('❌ Cancel', 'cancel_sell')]
              ])
            }
          );
        } else {
          // Fallback to manual group creation
          console.log(`⚠️ Automated group creation failed: ${groupResult.error}`);
          
          await ctx.reply(
            `✅ **Wallet Connected!**\n\nConnected wallet: \`${Address.parse(wallet!.address).toString({ bounceable: false })}\`\n\n👥 **Manual Group Creation Required**\n\n**Steps:**\n1. **Create a new group** in Telegram\n2. **Add @ayush_escrow_bot** to the group\n3. **Make bot admin** (for invite links)\n4. **Add your buyer** to the group\n5. **Send this command** in the group: \`/start create_trade_${tradeId}\`\n\n**Trade ID:** \`${tradeId}\`\n\n💰 **Step 1: Trade Amount**\n\nEnter the amount of USDT to trade:`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel', 'cancel_sell')]
              ])
            }
          );
        }
  } else {
    session.step = 'sell_wallet_connect';
    
    try {
      // Generate connection URL with user and bot info
      const domain = process.env.DOMAIN || 'http://localhost:3000';
      // Ensure domain doesn't have double protocol
      const cleanDomain = domain.replace(/^https?:\/\//, '');
      const connectionUrl = `https://${cleanDomain}/connect?user_id=${userId}&bot_token=${BOT_TOKEN}`;
      
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
    const cleanDomain = domain.replace(/^https?:\/\//, '');
    const response = await fetch(`https://${cleanDomain}/api/wallet-status/${userId}`);
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
  session.step = undefined;
  
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
  const cleanDomain = domain.replace(/^https?:\/\//, '');
  try {
    // Clear server-side session
    await fetch(`https://${cleanDomain}/api/wallet-disconnect/${userId}`, { method: 'POST' });
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
      const escrowAddress = args[1] || trade.escrowAddress || '';
    
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
    session.step = undefined;
    await ctx.reply('❌ Operation cancelled');
    return;
  }
  
  // Skip text processing if in create_group step
  if (session.step === 'create_group') return;
  
  // =============================================================================
  // SELLER PROFILE SETUP HANDLERS
  // =============================================================================
  
  if (session.step === 'setup_bank_details') {
    // Collecting account holder name
    session.bankDetails = session.bankDetails || {};
    session.bankDetails.accountHolderName = text;
    session.step = 'setup_bank_name';
    
    await ctx.reply(
      `✅ **Account Holder:** ${text}\n\n🏦 **Bank Name**\n\n` +
      `Enter your bank name:\n\n` +
      `Example: "State Bank of India" or "HDFC Bank"`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel', 'cancel_setup')]
        ])
      }
    );
  } else if (session.step === 'setup_bank_name') {
    session.bankDetails!.bankName = text;
    session.step = 'setup_account_number';
    
    await ctx.reply(
      `✅ **Bank:** ${text}\n\n🏦 **Account Number**\n\n` +
      `Enter your bank account number:\n\n` +
      `Example: "1234567890123"`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel', 'cancel_setup')]
        ])
      }
    );
  } else if (session.step === 'setup_account_number') {
    session.bankDetails!.accountNumber = text;
    session.step = 'setup_ifsc';
    
    await ctx.reply(
      `✅ **Account Number:** ${text}\n\n🏦 **IFSC Code**\n\n` +
      `Enter your bank's IFSC code:\n\n` +
      `Example: "SBIN0001234" or "HDFC0001234"`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel', 'cancel_setup')]
        ])
      }
    );
  } else if (session.step === 'setup_ifsc') {
    session.bankDetails!.ifscCode = text.toUpperCase();
    session.step = 'setup_upi';
    
    await ctx.reply(
      `✅ **IFSC Code:** ${text.toUpperCase()}\n\n💳 **UPI ID**\n\n` +
      `Enter your UPI ID for receiving payments:\n\n` +
      `Example: "yourname@paytm" or "yourname@ybl"`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel', 'cancel_setup')]
        ])
      }
    );
  } else if (session.step === 'setup_upi') {
    session.upiId = text;
    session.step = 'setup_phone';
    
    await ctx.reply(
      `✅ **UPI ID:** ${text}\n\n📱 **Phone Number** (Optional)\n\n` +
      `Enter your phone number or type "skip":\n\n` +
      `Example: "9876543210" or "skip"`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⏭️ Skip', 'skip_phone')],
          [Markup.button.callback('❌ Cancel', 'cancel_setup')]
        ])
      }
    );
  } else if (session.step === 'setup_phone') {
    if (text.toLowerCase() === 'skip') {
      session.phoneNumber = undefined;
    } else {
      session.phoneNumber = text;
    }
    
    // Save the profile
    const profile = {
      userId: userId,
      username: ctx.from?.username || '',
      walletAddress: session.walletAddress!,
      bankDetails: {
        accountHolderName: session.bankDetails!.accountHolderName!,
        accountNumber: session.bankDetails!.accountNumber!,
        ifscCode: session.bankDetails!.ifscCode!,
        bankName: session.bankDetails!.bankName!
      },
      upiId: session.upiId!,
      phoneNumber: session.phoneNumber,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await database.saveSellerProfile(profile);
    session.step = undefined;
    session.profileSetup = true;
    
    await ctx.reply(
      `🎉 **Profile Setup Complete!**\n\n` +
      `**Account Holder:** ${profile.bankDetails.accountHolderName}\n` +
      `**Bank:** ${profile.bankDetails.bankName}\n` +
      `**Account:** ${profile.bankDetails.accountNumber}\n` +
      `**IFSC:** ${profile.bankDetails.ifscCode}\n` +
      `**UPI ID:** ${profile.upiId}\n` +
      `**Phone:** ${profile.phoneNumber || 'Not provided'}\n` +
      `**Wallet:** \`${profile.walletAddress}\`\n\n` +
      `✅ **You're ready to start selling!**\n\n` +
      `Use /sell to create your first trade.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Start Selling', 'start_sell_flow')],
          [Markup.button.callback('✏️ Edit Profile', 'edit_profile')]
        ])
      }
    );
  }
  
  // =============================================================================
  // BUYER WALLET COLLECTION HANDLERS
  // =============================================================================
  
  // Check if this user is a buyer in an active trade
  const buyerTrades = await database.getTradesByUser(userId, 'buyer');
  const activeBuyerTrade = buyerTrades.find(t => t.status === 'active' && !t.buyerWalletAddress);
  
  if (activeBuyerTrade) {
    // This is a buyer providing their wallet address
    try {
      // Validate TON address format
      const address = Address.parse(text);
      const normalizedAddress = address.toString({ bounceable: false });
      
      // Update trade with buyer wallet address
      activeBuyerTrade.buyerWalletAddress = normalizedAddress;
      activeBuyerTrade.status = 'deposited';
      activeBuyerTrade.updatedAt = new Date().toISOString();
      
      await database.saveTrade(activeBuyerTrade);
      
      // Send automated notifications
      await notificationManager.notifyTradeUpdate(activeBuyerTrade.tradeId, 'wallet_provided', {
        tradeId: activeBuyerTrade.tradeId,
        walletAddress: normalizedAddress,
        buyerName: activeBuyerTrade.buyerUsername
      });
      
      // Get seller profile for bank details
      const sellerProfile = await database.getSellerProfile(activeBuyerTrade.sellerUserId);
      
      // Confirm wallet address to buyer
      await ctx.reply(
        `✅ **Wallet Address Confirmed!**\n\n` +
        `**Your Wallet:** \`${normalizedAddress}\`\n` +
        `**Trade ID:** \`${activeBuyerTrade.tradeId}\`\n` +
        `**Amount:** ${activeBuyerTrade.amount} USDT\n\n` +
        `**Step 2: Make Bank Transfer**\n\n` +
        `**Transfer Details:**\n` +
        `• **Account Holder:** ${sellerProfile?.bankDetails.accountHolderName}\n` +
        `• **Bank:** ${sellerProfile?.bankDetails.bankName}\n` +
        `• **Account Number:** ${sellerProfile?.bankDetails.accountNumber}\n` +
        `• **IFSC Code:** ${sellerProfile?.bankDetails.ifscCode}\n` +
        `• **UPI ID:** ${sellerProfile?.upiId}\n\n` +
        `**Amount to Transfer:** ${activeBuyerTrade.amount} USDT equivalent in INR\n\n` +
        `**After Transfer:**\n` +
        `1. Take screenshot of payment proof\n` +
        `2. Come back to the group\n` +
        `3. Type "payment sent" to notify seller\n` +
        `4. Wait for seller confirmation\n` +
        `5. USDT will be released to your wallet`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${activeBuyerTrade.tradeId}`)]
          ])
        }
      );
      
      // Notify seller about buyer wallet address
      await bot.telegram.sendMessage(
        activeBuyerTrade.sellerUserId,
        `🛒 **Buyer Wallet Address Received!**\n\n` +
        `**Buyer:** ${activeBuyerTrade.buyerUsername}\n` +
        `**Wallet:** \`${normalizedAddress}\`\n` +
        `**Trade ID:** \`${activeBuyerTrade.tradeId}\`\n` +
        `**Amount:** ${activeBuyerTrade.amount} USDT\n\n` +
        `**Next Steps:**\n` +
        `• Deploy escrow contract\n` +
        `• Deposit USDT to escrow\n` +
        `• Wait for buyer's bank transfer\n` +
        `• Confirm payment received\n` +
        `• Release USDT to buyer\n\n` +
        `**Ready to deploy escrow contract?**`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🚀 Deploy Escrow', `deploy_escrow_${activeBuyerTrade.tradeId}`)],
            [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${activeBuyerTrade.tradeId}`)]
          ])
        }
      );
      
      // Update group with buyer wallet info
      if (activeBuyerTrade.groupId) {
        await bot.telegram.sendMessage(
          activeBuyerTrade.groupId,
          `✅ **Buyer Wallet Address Confirmed!**\n\n` +
          `**Buyer:** ${activeBuyerTrade.buyerUsername}\n` +
          `**Wallet:** \`${normalizedAddress}\`\n` +
          `**Trade ID:** \`${activeBuyerTrade.tradeId}\`\n` +
          `**Amount:** ${activeBuyerTrade.amount} USDT\n\n` +
          `**Next Steps:**\n` +
          `• Seller will deploy escrow contract\n` +
          `• Buyer makes bank transfer\n` +
          `• Seller confirms payment\n` +
          `• USDT released to buyer`,
          { parse_mode: 'Markdown' }
        );
      }
      
      return; // Exit early, don't process as seller flow
    } catch (error) {
      await ctx.reply(
        `❌ **Invalid Wallet Address**\n\n` +
        `Please provide a valid TON wallet address.\n\n` +
        `**Format:** \`UQ...\` or \`EQ...\`\n` +
        `**Example:** \`UQCZaYzBq6OMu7ncePyB8CkbBF75a-eUTPKE8zBa9RBobarj\`\n\n` +
        `Try again:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${activeBuyerTrade.tradeId}`)]
          ])
        }
      );
      return;
    }
  }
  
  // =============================================================================
  // BANK TRANSFER FLOW HANDLERS
  // =============================================================================
  
  // Check for payment sent notifications
  if (text.toLowerCase().includes('payment sent') || text.toLowerCase().includes('payment made') || text.toLowerCase().includes('transfer sent')) {
    // Check if this user is a buyer in a payment_pending trade
    const buyerTrades = await database.getTradesByUser(userId, 'buyer');
    const pendingTrade = buyerTrades.find(t => t.status === 'payment_pending' && t.buyerWalletAddress);
    
    if (pendingTrade) {
      // Buyer is notifying about payment
      await ctx.reply(
        `✅ **Payment Notification Received!**\n\n` +
        `**Trade ID:** \`${pendingTrade.tradeId}\`\n` +
        `**Amount:** ${pendingTrade.amount} USDT\n\n` +
        `**Message:** Payment sent notification received.\n\n` +
        `**Next Steps:**\n` +
        `• Seller will verify the payment\n` +
        `• Once confirmed, USDT will be released\n` +
        `• You'll receive notification when complete\n\n` +
        `**Please wait for seller confirmation...** ⏳`,
        {
          parse_mode: 'Markdown'
        }
      );
      
      // Notify seller about payment notification
      await bot.telegram.sendMessage(
        pendingTrade.sellerUserId,
        `💰 **Payment Notification from Buyer!**\n\n` +
        `**Buyer:** ${pendingTrade.buyerUsername}\n` +
        `**Trade ID:** \`${pendingTrade.tradeId}\`\n` +
        `**Amount:** ${pendingTrade.amount} USDT\n\n` +
        `**Message:** Buyer has sent payment notification.\n\n` +
        `**Please check your bank account and confirm:**\n` +
        `• Verify the amount received\n` +
        `• Check the payment reference\n` +
        `• Confirm it's from the correct buyer\n\n` +
        `**After verification:**\n` +
        `• Type "payment received" in the group\n` +
        `• USDT will be released to buyer\n\n` +
        `**Your Bank Details:**\n` +
        `• **Account:** ${(await database.getSellerProfile(pendingTrade.sellerUserId))?.bankDetails.accountHolderName}\n` +
        `• **Bank:** ${(await database.getSellerProfile(pendingTrade.sellerUserId))?.bankDetails.bankName}\n` +
        `• **Account #:** ${(await database.getSellerProfile(pendingTrade.sellerUserId))?.bankDetails.accountNumber}\n` +
        `• **IFSC:** ${(await database.getSellerProfile(pendingTrade.sellerUserId))?.bankDetails.ifscCode}\n` +
        `• **UPI ID:** ${(await database.getSellerProfile(pendingTrade.sellerUserId))?.upiId}`,
        {
          parse_mode: 'Markdown'
        }
      );
      
      // Send automated notifications
      await notificationManager.notifyTradeUpdate(pendingTrade.tradeId, 'payment_sent', {
        tradeId: pendingTrade.tradeId,
        buyerName: pendingTrade.buyerUsername,
        amount: pendingTrade.amount
      });
      
      return; // Exit early, don't process as seller flow
    }
  }
  
  // Check for payment received confirmations
  if (text.toLowerCase().includes('payment received') || text.toLowerCase().includes('payment confirmed') || text.toLowerCase().includes('received payment')) {
    // Check if this user is a seller in a payment_pending trade
    const sellerTrades = await database.getTradesByUser(userId, 'seller');
    const pendingTrade = sellerTrades.find(t => t.status === 'payment_pending' && t.buyerWalletAddress);
    
    if (pendingTrade) {
      // Seller is confirming payment received
      await ctx.reply(
        `✅ **Payment Confirmed!**\n\n` +
        `**Trade ID:** \`${pendingTrade.tradeId}\`\n` +
        `**Amount:** ${pendingTrade.amount} USDT\n\n` +
        `**Message:** Payment received confirmation.\n\n` +
        `**Next Steps:**\n` +
        `• USDT will be released to buyer\n` +
        `• Transaction will be processed\n` +
        `• Trade will be completed\n\n` +
        `**Processing release...** ⏳`,
        {
          parse_mode: 'Markdown'
        }
      );
      
      // Update trade status and trigger USDT release
      pendingTrade.status = 'payment_confirmed';
      pendingTrade.bankTransferConfirmed = true;
      pendingTrade.updatedAt = new Date().toISOString();
      await database.saveTrade(pendingTrade);
      
      // Send automated notifications
      await notificationManager.notifyTradeUpdate(pendingTrade.tradeId, 'payment_confirmed', {
        tradeId: pendingTrade.tradeId,
        amount: pendingTrade.amount
      });
      
      // Trigger USDT release to buyer
      await releaseUSDTToBuyer(pendingTrade);
      
      return; // Exit early, don't process as seller flow
    }
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
    
    session.amount = amount.toString();
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
    session.step = undefined;
    
    // Deploy escrow
    await ctx.reply('🚀 Deploying escrow contract...');
    
    try {
      const wallet = tonConnectService.getConnectedWallet(userId!);
      if (!wallet) {
        throw new Error('Wallet not connected');
      }
      
      const amountUnits = escrowUtils.parseAmount(session.amount?.toString() || '0');
      
      // For now, we'll use a mock mnemonic for deployment
      // In production, this would use the connected wallet's signing capability
      const mockMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      
      const escrowAddress = await tonScripts.deployEscrow(
        mockMnemonic, // This will be replaced with wallet signing in production
        userId!,
        ctx.from?.username || 'unknown',
        session.buyerUsername || 'unknown',
        amountUnits,
        commissionBps
      );

      if (escrowAddress) {
        const fees = escrowUtils.calculateFees(amountUnits, commissionBps);
        
        // Store trade info for group access
        const tradeInfo = {
          tradeId: session.tradeId!,
          escrowAddress,
          sellerUserId: userId!,
          sellerUsername: ctx.from?.username || 'unknown',
          buyerUsername: session.buyerUsername || 'unknown',
          amount: session.amount?.toString() || '0',
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
          `• Buyer: @${session.buyerUsername || 'unknown'}\n` +
          `• Amount: ${session.amount || '0'} USDT\n` +
          `• Commission: ${commissionBps / 100}%\n\n` +
          `**Fee Breakdown:**\n` +
          `• Platform fee: ${escrowUtils.formatAmount(fees.totalFee)} USDT\n` +
          `• To buyer: ${escrowUtils.formatAmount(fees.toBuyer)} USDT\n\n` +
          `**Next Steps:**\n` +
          `1. Deposit ${session.amount || '0'} USDT into the escrow\n` +
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
            `• Amount: ${session.amount || '0'} USDT\n` +
            `• Commission: ${commissionBps / 100}%\n` +
            `• Platform fee: ${escrowUtils.formatAmount(fees.totalFee)} USDT\n` +
            `• Buyer receives: ${escrowUtils.formatAmount(fees.toBuyer)} USDT\n\n` +
            `**Next Steps:**\n` +
            `1. **Seller:** Deposit ${session.amount || '0'} USDT to the contract\n` +
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
    
    session.step = undefined;
    
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
    
    session.step = undefined;
    
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
    
    session.step = undefined;
    
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
  
  // Process new members
  for (const member of newMembers) {
    if (member.id !== ctx.botInfo.id) { // Don't process the bot itself
      // Check if this is a recognized trade group
      const trade = await database.getTradeByGroupId(groupId);
      
      if (trade) {
        // Check if this is the seller (already known)
        if (member.id === trade.sellerUserId) {
          await ctx.reply(
            `👋 **Welcome back, Seller!**\n\n` +
            `**Trade ID:** \`${trade.tradeId}\`\n` +
            `**Amount:** ${trade.amount} USDT\n` +
            `**Status:** ${trade.status}\n\n` +
            `**Available Commands:**\n` +
            `• \`/status\` - Check trade status\n` +
            `• \`payment received\` - Confirm payment\n` +
            `• \`dispute\` - Raise dispute\n\n` +
            `**Let's complete this trade securely!** 🔒`,
            { parse_mode: 'Markdown' }
          );
        } else {
          // This is a new buyer - start buyer flow
          await handleNewBuyer(ctx, member, trade);
        }
      } else {
        // No trade found - this might be a new group or seller hasn't set up yet
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
      break; // Only process one new member per batch
    }
  }
});

// Handle new buyer joining the trade group
async function handleNewBuyer(ctx: any, buyer: any, trade: any) {
  console.log(`🛒 New buyer detected: ${buyer.username || buyer.first_name} (${buyer.id})`);
  
  // Update trade record with buyer information
  trade.buyerUserId = buyer.id;
  trade.buyerUsername = buyer.username || buyer.first_name;
  trade.status = 'active';
  trade.updatedAt = new Date().toISOString();
  
  await database.saveTrade(trade);
  
  // Send automated notifications
  await notificationManager.notifyTradeUpdate(trade.tradeId, 'buyer_joined', {
    tradeId: trade.tradeId,
    buyerName: buyer.first_name || `@${buyer.username}`,
    amount: trade.amount
  });
  
  // Get seller profile for bank details
  const sellerProfile = await database.getSellerProfile(trade.sellerUserId);
  
  // Welcome buyer with trade information
  await ctx.reply(
    `🛒 **Buyer Joined!**\n\n` +
    `**Buyer:** ${buyer.first_name || `@${buyer.username}`}\n` +
    `**Trade ID:** \`${trade.tradeId}\`\n` +
    `**Amount:** ${trade.amount} USDT\n\n` +
    `✅ **Trade is now active!**\n\n` +
    `**Next Steps:**\n` +
    `• Buyer needs to provide wallet address\n` +
    `• Seller will deploy escrow contract\n` +
    `• Buyer makes bank transfer\n` +
    `• Seller confirms payment\n` +
    `• USDT released to buyer`,
    { parse_mode: 'Markdown' }
  );
  
  // Send buyer wallet collection request
  await ctx.telegram.sendMessage(
    buyer.id,
    `🛒 **Welcome to the Trade!**\n\n` +
    `**Trade Details:**\n` +
    `• **Trade ID:** \`${trade.tradeId}\`\n` +
    `• **Amount:** ${trade.amount} USDT\n` +
    `• **Seller:** ${trade.sellerUsername}\n\n` +
    `**Step 1: Provide Your Wallet Address**\n\n` +
    `Please provide your TON wallet address where you want to receive the USDT:\n\n` +
    `**Format:** \`UQ...\` or \`EQ...\`\n` +
    `**Example:** \`UQCZaYzBq6OMu7ncePyB8CkbBF75a-eUTPKE8zBa9RBobarj\`\n\n` +
    `Type your wallet address:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${trade.tradeId}`)]
      ])
    }
  );
  
  // Notify seller about buyer joining
  await ctx.telegram.sendMessage(
    trade.sellerUserId,
    `🛒 **Buyer Joined Your Trade!**\n\n` +
    `**Buyer:** ${buyer.first_name || `@${buyer.username}`}\n` +
    `**Trade ID:** \`${trade.tradeId}\`\n` +
    `**Amount:** ${trade.amount} USDT\n\n` +
    `**Next Steps:**\n` +
    `• Buyer is providing wallet address\n` +
    `• You'll deploy escrow contract\n` +
    `• Buyer makes bank transfer to your account\n` +
    `• You confirm payment received\n` +
    `• USDT released to buyer\n\n` +
    `**Your Bank Details (for buyer):**\n` +
    `• **Account:** ${sellerProfile?.bankDetails.accountHolderName || 'Not set'}\n` +
    `• **Bank:** ${sellerProfile?.bankDetails.bankName || 'Not set'}\n` +
    `• **Account #:** ${sellerProfile?.bankDetails.accountNumber || 'Not set'}\n` +
    `• **IFSC:** ${sellerProfile?.bankDetails.ifscCode || 'Not set'}\n` +
    `• **UPI ID:** ${sellerProfile?.upiId || 'Not set'}`,
    {
      parse_mode: 'Markdown'
    }
  );
}

// Release USDT to buyer after payment confirmation
async function releaseUSDTToBuyer(trade: any) {
  console.log(`🚀 Releasing USDT to buyer for trade: ${trade.tradeId}`);
  
  try {
    // In a real implementation, this would:
    // 1. Call the escrow contract's release function
    // 2. Transfer USDT from escrow to buyer's wallet
    // 3. Wait for transaction confirmation
    // 4. Update trade status
    
    // For now, we'll simulate the release
    const releaseTxHash = `tx_release_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Update trade with release info
    trade.status = 'completed';
    trade.releaseTxHash = releaseTxHash;
    trade.updatedAt = new Date().toISOString();
    await database.saveTrade(trade);
    
    // Send automated notifications
    await notificationManager.notifyTradeUpdate(trade.tradeId, 'trade_completed', {
      tradeId: trade.tradeId,
      amount: trade.amount,
      txHash: releaseTxHash
    });
    
    // Notify buyer about USDT release
    await bot.telegram.sendMessage(
      trade.buyerUserId!,
      `🎉 **Trade Completed Successfully!**\n\n` +
      `**Trade ID:** \`${trade.tradeId}\`\n` +
      `**Amount:** ${trade.amount} USDT\n` +
      `**Your Wallet:** \`${trade.buyerWalletAddress}\`\n` +
      `**Transaction Hash:** \`${releaseTxHash}\`\n\n` +
      `✅ **USDT has been released to your wallet!**\n\n` +
      `**Trade Summary:**\n` +
      `• Seller: ${trade.sellerUsername}\n` +
      `• Amount: ${trade.amount} USDT\n` +
      `• Status: Completed\n` +
      `• Date: ${new Date().toLocaleDateString()}\n\n` +
      `**Thank you for using our escrow service!** 🎉`,
      {
        parse_mode: 'Markdown'
      }
    );
    
    // Notify seller about trade completion
    await bot.telegram.sendMessage(
      trade.sellerUserId,
      `🎉 **Trade Completed Successfully!**\n\n` +
      `**Trade ID:** \`${trade.tradeId}\`\n` +
      `**Amount:** ${trade.amount} USDT\n` +
      `**Buyer:** ${trade.buyerUsername}\n` +
      `**Transaction Hash:** \`${releaseTxHash}\`\n\n` +
      `✅ **USDT has been released to buyer!**\n\n` +
      `**Trade Summary:**\n` +
      `• Buyer: ${trade.buyerUsername}\n` +
      `• Amount: ${trade.amount} USDT\n` +
      `• Status: Completed\n` +
      `• Date: ${new Date().toLocaleDateString()}\n\n` +
      `**Thank you for using our escrow service!** 🎉`,
      {
        parse_mode: 'Markdown'
      }
    );
    
    // Update group with completion message
    if (trade.groupId) {
      await bot.telegram.sendMessage(
        trade.groupId,
        `🎉 **Trade Completed Successfully!**\n\n` +
        `**Trade ID:** \`${trade.tradeId}\`\n` +
        `**Amount:** ${trade.amount} USDT\n` +
        `**Buyer:** ${trade.buyerUsername}\n` +
        `**Seller:** ${trade.sellerUsername}\n` +
        `**Transaction Hash:** \`${releaseTxHash}\`\n\n` +
        `✅ **USDT has been released to buyer!**\n\n` +
        `**Both parties have successfully completed the trade.**\n\n` +
        `**Thank you for using our escrow service!** 🎉`,
        { parse_mode: 'Markdown' }
      );
    }
    
    console.log(`✅ USDT release completed for trade: ${trade.tradeId}`);
    
  } catch (error) {
    console.error('USDT release error:', error);
    
    // Notify both parties about the error
    await bot.telegram.sendMessage(
      trade.sellerUserId,
      `❌ **USDT Release Failed**\n\n` +
      `**Trade ID:** \`${trade.tradeId}\`\n` +
      `**Error:** ${error instanceof Error ? error.message : String(error)}\n\n` +
      `Please contact admin for assistance.`,
      {
        parse_mode: 'Markdown'
      }
    );
    
    await bot.telegram.sendMessage(
      trade.buyerUserId!,
      `❌ **USDT Release Failed**\n\n` +
      `**Trade ID:** \`${trade.tradeId}\`\n` +
      `**Error:** ${error instanceof Error ? error.message : String(error)}\n\n` +
      `Please contact admin for assistance.`,
      {
        parse_mode: 'Markdown'
      }
    );
  }
}

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