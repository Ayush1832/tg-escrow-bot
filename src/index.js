const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const connectDB = require('./utils/database');
const config = require('../config');

// Import models
const User = require('./models/User');
const Escrow = require('./models/Escrow');
const DepositAddress = require('./models/DepositAddress');

// Import services
const WalletService = require('./services/WalletService');
const BlockchainService = require('./services/BlockchainService');
// Activity monitoring removed

// Import handlers
const startHandler = require('./handlers/startHandler');
const escrowHandler = require('./handlers/escrowHandler');
const dealDetailsHandler = require('./handlers/dealDetailsHandler');
const roleHandler = require('./handlers/roleHandler');
const tokenHandler = require('./handlers/tokenHandler');
const depositHandler = require('./handlers/depositHandler');
const releaseHandler = require('./handlers/releaseHandler');
const disputeHandler = require('./handlers/disputeHandler');
const callbackHandler = require('./handlers/callbackHandler');

class EscrowBot {
  constructor() {
    this.bot = new Telegraf(config.BOT_TOKEN);
    this.setupMiddleware();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // User registration middleware
    this.bot.use(async (ctx, next) => {
      const user = ctx.from;
      if (user) {
        await this.ensureUser(user);
      }
      return next();
    });
  }

  setupHandlers() {
    
    // (Inactivity tracking disabled)
    
    // Capture deal details after /dd - MUST be before command handlers
    this.bot.use(async (ctx, next) => {
      try {
        const chatId = ctx.chat.id;
        if (chatId > 0 || !ctx.message || !ctx.message.text) return next();
        
        // Skip if it's a command
        if (ctx.message.text.startsWith('/')) return next();
                
        const escrow = await Escrow.findOne({ groupId: chatId.toString(), status: 'awaiting_details' });
        if (!escrow) {
          return next();
        }
                
        const text = ctx.message.text;
        // Parse deal details from user message
        const qtyMatch = text.match(/Quantity\s*[-:]*\s*(\d+(?:\.\d+)?)/i);
        const rateMatch = text.match(/Rate\s*[-:]*\s*(\d+(?:\.\d+)?)/i);
        
        if (!qtyMatch || !rateMatch) {
          return ctx.reply('❌ Please provide at least Quantity and Rate in the format:\nQuantity - 10\nRate - 90');
        }
        
        escrow.quantity = Number(qtyMatch[1]);
        escrow.rate = Number(rateMatch[1]);
        escrow.status = 'draft';
        await escrow.save();
        
        // Show role selection buttons
        await ctx.reply('✅ Deal details saved.');
        await ctx.reply('👤 Both users select your roles:', {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '👤 Buyer', callback_data: 'select_role_buyer' },
                { text: '🏪 Seller', callback_data: 'select_role_seller' }
              ]
            ]
          }
        });
        return; // Don't continue to next handlers
      } catch (e) {
        console.error('deal details parse error', e);
      }
      return next();
    });
    
    // Start command
    this.bot.start(startHandler);
    
    // Test command
    this.bot.command('test', (ctx) => {
      ctx.reply('✅ Bot is working!');
    });
    
    // Escrow commands
    this.bot.command('escrow', escrowHandler);
    this.bot.command('dd', dealDetailsHandler);
    this.bot.command('seller', roleHandler);
    this.bot.command('buyer', roleHandler);
    this.bot.command('token', tokenHandler);
    this.bot.command('deposit', depositHandler);
    this.bot.command('release', releaseHandler);
    this.bot.command('refund', releaseHandler);
    this.bot.command('dispute', disputeHandler);

    // Admin commands
    const { 
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
    adminCleanupAddresses
  } = require('./handlers/adminHandler');
    this.bot.command('admin_disputes', adminDashboard);
    this.bot.command('admin_resolve_release', adminResolveRelease);
    this.bot.command('admin_resolve_refund', adminResolveRefund);
    this.bot.command('admin_stats', adminStats);
    this.bot.command('admin_pool', adminGroupPool);
    this.bot.command('admin_pool_add', adminPoolAdd);
    this.bot.command('admin_pool_list', adminPoolList);
    this.bot.command('admin_pool_delete_all', adminPoolDeleteAll);
    this.bot.command('admin_pool_delete', adminPoolDelete);
    this.bot.command('admin_help', adminHelp);
    this.bot.command('admin_trade_stats', adminTradeStats);
    this.bot.command('admin_export_trades', adminExportTrades);
    this.bot.command('admin_recent_trades', adminRecentTrades);
    this.bot.command('admin_settle_partial', adminSettlePartial);
    this.bot.command('admin_address_pool', adminAddressPool);
    this.bot.command('admin_init_addresses', adminInitAddresses);
    this.bot.command('admin_timeout_stats', adminTimeoutStats);
    this.bot.command('admin_cleanup_addresses', adminCleanupAddresses);

    // Callback query handler
    this.bot.on('callback_query', callbackHandler);
    
    // Handle new members joining the group
    this.bot.on('new_chat_members', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        const newMembers = ctx.message.new_chat_members;
        
        // Find active escrow in this group
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
        });
        
        if (!escrow) {
          return; // No active escrow, no need to send message
        }
        
        // Send welcome message for each new member
        for (const member of newMembers) {
          if (member.is_bot) continue; // Skip bots
          
          const welcomeText = `
🎉 *Welcome to the Escrow Group!*

📋 *Escrow ID:* ${escrow.escrowId}

👥 *Current Status:*
${escrow.status === 'draft' ? '📝 Setting up deal details' : 
  escrow.status === 'awaiting_details' ? '📝 Awaiting deal details' :
  escrow.status === 'awaiting_deposit' ? '⏳ Awaiting deposit' :
  escrow.status === 'deposited' ? '✅ Deposit confirmed' :
  escrow.status === 'in_fiat_transfer' ? '💸 Fiat transfer in progress' :
  escrow.status === 'ready_to_release' ? '🚀 Ready to release' :
  escrow.status === 'disputed' ? '⚠️ Under dispute' : '❓ Unknown'}

📋 *Next Steps:*
${escrow.status === 'draft' || escrow.status === 'awaiting_details' ? 
  '1. Use /dd to set deal details (Quantity - Rate)\n2. Set buyer address with /buyer [address]\n3. Select token with /token' :
  escrow.status === 'awaiting_deposit' ?
  '1. Use /deposit to generate deposit address\n2. Send the agreed amount to the address' :
  escrow.status === 'deposited' ?
  '1. Complete fiat payment handshake\n2. Confirm receipt when ready' :
  escrow.status === 'in_fiat_transfer' ?
  '1. Complete fiat payment confirmation\n2. Funds will be released automatically' :
  escrow.status === 'ready_to_release' ?
  '1. Both parties confirm release/refund\n2. Transaction will execute' :
  escrow.status === 'disputed' ?
  '1. Admin will join within 24 hours\n2. Provide dispute details' : 'Contact admin'}

💡 *Useful Commands:*
• /menu - Show all commands
• /dd - Set deal details
• /buyer [address] - Set buyer address
• /token - Select token and network
• /deposit - Get deposit address

⚠️ *Important:* Make sure to agree on all terms before proceeding!
          `;
          
          await ctx.reply(welcomeText, { parse_mode: 'Markdown' });
        }
      } catch (error) {
        console.error('Error handling new chat members:', error);
      }
    });
    
    // Menu command
    this.bot.command('menu', (ctx) => {
      const menuText = `
🤖 *MM Escrow Bot Menu*

📋 *Available Commands:*
/start - Start the bot
/escrow - Create new escrow
/dd - Set deal details
/buyer [address] - Set buyer address
/token - Select token and network
/deposit - Get deposit address

💡 *Tips:*
- Use /dd to set deal details first
- Make sure both parties confirm their roles
- Always verify addresses before depositing
      `;
      
      ctx.reply(menuText, { parse_mode: 'Markdown' });
    });
  }

  setupErrorHandling() {
    this.bot.catch((err, ctx) => {
      console.error('Bot error:', err);
      ctx.reply('❌ An error occurred. Please try again or contact support.');
    });
  }

  async ensureUser(telegramUser) {
    try {
      let user = await User.findOne({ telegramId: telegramUser.id });
      if (!user) {
        try {
          const fallbackUsername = telegramUser.username || (telegramUser.first_name ? `${telegramUser.first_name}` : `user_${telegramUser.id}`);
          user = new User({
            telegramId: telegramUser.id,
            username: fallbackUsername,
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            isAdmin: config.getAllAdminUsernames().includes(telegramUser.username || fallbackUsername)
          });
          await user.save();
        } catch (duplicateError) {
          // Handle duplicate key error - user might have been created by another instance
          if (duplicateError.code === 11000) {
            user = await User.findOne({ telegramId: telegramUser.id });
          } else {
            throw duplicateError;
          }
        }
      } else {
        // Update last active
        user.lastActive = new Date();
        await user.save();
      }
      return user;
    } catch (error) {
      console.error('Error ensuring user:', error);
    }
  }

  async start() {
    try {
      console.log('🚀 Starting Escrow Bot...');
      
      // Connect to MongoDB and wait for full connection
      await connectDB();
      
      // Initialize on-chain vault (optional for basic bot functionality)
      try {
        const addr = await BlockchainService.initialize();
      } catch (e) {
        console.warn('⚠️ EscrowVault not found. Bot will work in limited mode. Deploy with `npm run deploy:sepolia`');
      }
      
      // Launch the bot
      await this.bot.launch();
      console.log('🤖 Escrow Bot started successfully!');
      
      // Start deposit monitoring
      this.startDepositMonitoring();
      
      // Automatic 24h per-user lock cleanup for stale drafts (single-use groups preserved)
      this.startDraftLockCleanup();
      
      // Inactivity monitoring disabled
      
      // Graceful shutdown
      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    } catch (error) {
      console.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  startDepositMonitoring() {
    // Check for deposits every 30 seconds
    setInterval(async () => {
      try {
        await this.checkDeposits();
      } catch (error) {
        console.error('Error in deposit monitoring:', error);
      }
    }, 30000);
  }

  async checkDeposits() {
    try {
      // Get active escrows with unique deposit addresses
      const activeEscrows = await Escrow.find({
        status: 'awaiting_deposit',
        uniqueDepositAddress: { $exists: true, $ne: null }
      });

      for (const escrow of activeEscrows) {
        try {
          // Get token balance for the unique deposit address
          const BlockchainService = require('./services/BlockchainService');
          const balance = await BlockchainService.getTokenBalance(
            escrow.token,
            escrow.chain,
            escrow.uniqueDepositAddress
          );

          if (balance > 0) {
            // Update escrow with deposit information
            escrow.depositAmount = balance;
            escrow.confirmedAmount = balance;
            escrow.status = 'deposited';
            await escrow.save();

            // Cancel trade timeout since deposit was made
            const TradeTimeoutService = require('./services/TradeTimeoutService');
            await TradeTimeoutService.cancelTradeTimeout(escrow.escrowId);

            // Notify in group
            await this.bot.telegram.sendMessage(
              escrow.groupId,
              `💰 *Deposit Confirmed*\n\n🪙 Token: ${escrow.token}-${escrow.chain}\n💰 Amount: ${balance.toFixed(2)} ${escrow.token}\n💸 Balance: ${balance.toFixed(2)} ${escrow.token}\n\nPlease click update button to show the updated data.`
            );
          }
        } catch (error) {
          console.error(`Error checking deposit for escrow ${escrow.escrowId}:`, error);
        }
      }
    } catch (error) {
      console.error('Error checking deposits:', error);
    }
  }

  startDraftLockCleanup() {
    // Every 30 minutes, mark stale managed-pool drafts (>24h) as completed to free user lock
    setInterval(async () => {
      try {
        const Escrow = require('./models/Escrow');
        const cutoff = new Date(Date.now() - (24 * 60 * 60 * 1000));
        const staleDrafts = await Escrow.find({
          assignedFromPool: true,
          status: 'draft',
          createdAt: { $lt: cutoff }
        });

        for (const draft of staleDrafts) {
          try {
            draft.status = 'completed';
            await draft.save();
          } catch (e) {
            console.error('Error marking stale draft completed:', e);
          }
        }

        if (staleDrafts.length) {
          console.log(`🧹 Draft lock cleanup: freed ${staleDrafts.length} users (single-use groups preserved).`);
        }
      } catch (e) {
        console.error('Draft lock cleanup error:', e);
      }
    }, 30 * 60 * 1000);
  }
}

// Start the bot
const bot = new EscrowBot();
bot.start();

// Startup cleanup for timeouts and addresses
setTimeout(async () => {
  try {    
    // Ensure MongoDB is connected with timeout
    if (mongoose.connection.readyState !== 1) {
      console.log('⏳ Waiting for MongoDB connection...');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('MongoDB connection timeout during cleanup'));
        }, 15000); // 15 second timeout
        
        if (mongoose.connection.readyState === 1) {
          clearTimeout(timeout);
          resolve();
        } else {
          mongoose.connection.once('open', () => {
            clearTimeout(timeout);
            resolve();
          });
          mongoose.connection.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        }
      });
    }
    
    const TradeTimeoutService = require('./services/TradeTimeoutService');
    const AddressAssignmentService = require('./services/AddressAssignmentService');
    
    await TradeTimeoutService.cleanupExpiredTimeouts();
    
    await AddressAssignmentService.cleanupAbandonedAddresses();
    
  } catch (error) {
    console.error('❌ Startup cleanup error:', error);
  }
}, 5000); // Wait 5 seconds after bot starts
