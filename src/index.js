const { Telegraf, Markup } = require('telegraf');
const connectDB = require('./utils/database');
const config = require('../config');

// Import models
const User = require('./models/User');
const Escrow = require('./models/Escrow');
const DepositAddress = require('./models/DepositAddress');
const Event = require('./models/Event');

// Import services
const WalletService = require('./services/WalletService');
const BlockchainService = require('./services/BlockchainService');
const ActivityMonitoringService = require('./services/ActivityMonitoringService');

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
    // Add debugging for all messages
    this.bot.use((ctx, next) => {
      console.log('📨 Received message:', ctx.message?.text || 'non-text message', 'from:', ctx.from?.username);
      return next();
    });
    
    // Activity tracking middleware - track user activity in groups
    this.bot.use(async (ctx, next) => {
      try {
        const chatId = ctx.chat.id;
        const userId = ctx.from?.id;
        
        // Only track activity in groups (negative chat ID)
        if (chatId > 0 || !userId || !ctx.message) return next();
        
        // Find active escrow in this group
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'] }
        });
        
        if (escrow) {
          // Track activity for this user
          await ActivityMonitoringService.trackActivity(chatId.toString(), escrow.escrowId, userId, this.bot);
        }
        
      } catch (error) {
        console.error('Error in activity tracking middleware:', error);
      }
      
      return next();
    });
    
    // Capture deal details after /dd - MUST be before command handlers
    this.bot.use(async (ctx, next) => {
      try {
        const chatId = ctx.chat.id;
        if (chatId > 0 || !ctx.message || !ctx.message.text) return next();
        
        // Skip if it's a command
        if (ctx.message.text.startsWith('/')) return next();
                
        const escrow = await Escrow.findOne({ groupId: chatId.toString(), status: 'awaiting_details' });
        if (!escrow) {
          console.log('No escrow in awaiting_details status');
          return next();
        }
                
        const text = ctx.message.text;
        // Parse deal details from user message
        const qtyMatch = text.match(/Quantity\s*[-:]*\s*(\d+(?:\.\d+)?)/i);
        const rateMatch = text.match(/Rate\s*[-:]*\s*(\d+(?:\.\d+)?)/i);
        const condMatch = text.match(/Conditions?\s*\(?.*\)?\s*[-:]*\s*([\s\S]+)/i);
        
        if (!qtyMatch || !rateMatch) {
          return ctx.reply('❌ Please provide at least Quantity and Rate in the format:\nQuantity - 10\nRate - 90');
        }
        
        escrow.quantity = Number(qtyMatch[1]);
        escrow.rate = Number(rateMatch[1]);
        if (condMatch) escrow.conditions = condMatch[1].trim();
        escrow.status = 'draft';
        await escrow.save();
        
        await ctx.reply('✅ Deal details saved. Now set /seller and /buyer addresses.');
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
      console.log('🧪 Test command received');
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
      adminPoolReset,
      adminPoolResetAssigned,
      adminPoolCleanup,
      adminPoolArchive,
      adminActivityStats
    } = require('./handlers/adminHandler');
    this.bot.command('admin_disputes', adminDashboard);
    this.bot.command('admin_resolve_release', adminResolveRelease);
    this.bot.command('admin_resolve_refund', adminResolveRefund);
    this.bot.command('admin_stats', adminStats);
    this.bot.command('admin_pool', adminGroupPool);
    this.bot.command('admin_pool_add', adminPoolAdd);
    this.bot.command('admin_pool_list', adminPoolList);
    this.bot.command('admin_pool_reset', adminPoolReset);
    this.bot.command('admin_pool_reset_assigned', adminPoolResetAssigned);
    this.bot.command('admin_pool_cleanup', adminPoolCleanup);
    this.bot.command('admin_pool_archive', adminPoolArchive);
    this.bot.command('admin_activity_stats', adminActivityStats);

    // Callback query handler
    this.bot.on('callback_query', callbackHandler);
    
    // Menu command
    this.bot.command('menu', (ctx) => {
      const menuText = `
🤖 *Easy Escrow Bot Menu*

📋 *Available Commands:*
/start - Start the bot
/escrow - Create new escrow
/dd - Set deal details
/seller [address] - Set seller address
/buyer [address] - Set buyer address
/token - Select token and network
/deposit - Get deposit address
/release [amount] - Release funds
/refund [amount] - Refund to seller
/dispute - Call administrator

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
          user = new User({
            telegramId: telegramUser.id,
            username: telegramUser.username,
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            isAdmin: telegramUser.username === config.ADMIN_USERNAME
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
      await connectDB();
      // Initialize on-chain vault (optional for basic bot functionality)
      try {
        const addr = await BlockchainService.initialize();
        console.log('✅ EscrowVault initialized at:', addr);
      } catch (e) {
        console.warn('⚠️ EscrowVault not found. Bot will work in limited mode. Deploy with `npm run deploy:sepolia`');
      }
      await this.bot.launch();
      console.log('🤖 Escrow Bot started successfully!');
      
      // Start deposit monitoring
      this.startDepositMonitoring();
      
      // Start activity monitoring
      ActivityMonitoringService.setBotInstance(this.bot);
      ActivityMonitoringService.startMonitoring();
      
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
      const activeAddresses = await DepositAddress.find({
        status: 'active',
        expiresAt: { $gt: new Date() }
      });

      for (const depositAddr of activeAddresses) {
        const transactions = await BSCService.getUSDTTransactions(depositAddr.address);
        
        if (transactions.length > 0) {
          const escrow = await Escrow.findOne({ escrowId: depositAddr.escrowId });
          const sellerAddr = (escrow?.sellerAddress || '').toLowerCase();
          const vaultAddr = depositAddr.address.toLowerCase();
          const totalAmount = transactions.reduce((sum, tx) => {
            const from = (tx.from || '').toLowerCase();
            const to = (tx.to || '').toLowerCase();
            if (to === vaultAddr && (!sellerAddr || from === sellerAddr)) {
              return sum + Number(tx.valueDecimal || 0);
            }
            return sum;
          }, 0);

          if (totalAmount > depositAddr.observedAmount) {
            depositAddr.observedAmount = totalAmount;
            depositAddr.status = 'used';
            await depositAddr.save();

            // Update escrow
            if (escrow) {
              escrow.depositAmount = totalAmount;
              escrow.confirmedAmount = totalAmount;
              escrow.status = 'deposited';
              await escrow.save();

              // Notify in group
              await this.bot.telegram.sendMessage(
                escrow.groupId,
                `💰 *Deposit Confirmed*\n\n🪙 Token: BSC-USDT\n💰 Amount: ${totalAmount.toFixed(5)} [$${totalAmount.toFixed(2)}]\n💸 Balance: ${totalAmount.toFixed(5)} [$${totalAmount.toFixed(2)}]\n\nPlease click update button to show the updated data.`,
                { parse_mode: 'Markdown' }
              );
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking deposits:', error);
    }
  }
}

// Start the bot
const bot = new EscrowBot();
bot.start();
