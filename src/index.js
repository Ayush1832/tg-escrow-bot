const { Telegraf, Markup } = require('telegraf');
const { ethers } = require('ethers');
const mongoose = require('mongoose');
const connectDB = require('./utils/database');
const config = require('../config');

const User = require('./models/User');
const Escrow = require('./models/Escrow');
const GroupPool = require('./models/GroupPool');

const BlockchainService = require('./services/BlockchainService');

const groupDealHandler = require('./handlers/groupDealHandler');
const joinRequestHandler = require('./handlers/joinRequestHandler');
const callbackHandler = require('./handlers/callbackHandler');
const adminHandler = require('./handlers/adminHandler');
const GroupPoolService = require('./services/GroupPoolService');

/**
 * RPC Rate Limiting Queue
 */
class RPCRateLimiter {
  constructor(maxConcurrent = 5, delayBetweenRequests = 100) {
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = maxConcurrent;
    this.delayBetweenRequests = delayBetweenRequests;
    this.lastRequestTime = 0;
  }

  async execute(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.active++;
    const { fn, resolve, reject } = this.queue.shift();

    // Rate limiting: ensure minimum delay between requests
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.delayBetweenRequests) {
      await new Promise(resolve => setTimeout(resolve, this.delayBetweenRequests - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.active--;
      this.process();
    }
  }
}

const rpcRateLimiter = new RPCRateLimiter(5, 200);

/**
 * Execute RPC call with rate limiting and retry logic
 */
async function executeRPCWithRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await rpcRateLimiter.execute(fn);
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const isRetryableError = error.code === 'ECONNRESET' || 
                                error.code === 'ETIMEDOUT' || 
                                error.code === 'SERVER_ERROR' ||
                                error.message?.includes('timeout') ||
                                error.message?.includes('network');

      if (!isRetryableError || isLastAttempt) {
        throw error;
      }

      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Build OTC Deal Summary text
 */
async function buildDealSummary(escrow) {
  const amount = escrow.quantity || 0;
  const rate = escrow.rate || 0;
  const paymentMethod = escrow.paymentMethod || 'N/A';
  const chain = escrow.chain || 'BSC';
  const buyerAddress = escrow.buyerAddress || 'Not set';
  const sellerAddress = escrow.sellerAddress || 'Not set';
  
  const buyerUsername = escrow.buyerUsername || 'Buyer';
  const sellerUsername = escrow.sellerUsername || 'Seller';
  
  let approvalStatus = '';
  if (escrow.buyerApproved && escrow.sellerApproved) {
    approvalStatus = '✅ Both parties have approved.';
  } else {
    const approvals = [];
    if (escrow.buyerApproved) {
      approvals.push(`✅ @${buyerUsername} has approved.`);
    } else {
      approvals.push(`⏳ Waiting for @${buyerUsername} to approve.`);
    }
    if (escrow.sellerApproved) {
      approvals.push(`✅ @${sellerUsername} has approved.`);
    } else {
      approvals.push(`⏳ Waiting for @${sellerUsername} to approve.`);
    }
    approvalStatus = approvals.join('\n');
  }
  
  return `📋 <b>OTC Deal Summary</b>

• <b>Amount:</b> ${amount} ${escrow.token || 'USDT'}
• <b>Rate:</b> ₹${rate.toFixed(1)}
• <b>Payment:</b> ${paymentMethod}
• <b>Chain:</b> ${chain}
• <b>Buyer Address:</b> <code>${buyerAddress}</code>
• <b>Seller Address:</b> <code>${sellerAddress}</code>

🛑 <b>Do not send funds here</b> 🛑

${approvalStatus}`;
}


class EscrowBot {
  constructor() {
    this.bot = new Telegraf(config.BOT_TOKEN);
    this.setupMiddleware();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    this.bot.use(async (ctx, next) => {
      const user = ctx.from;
      if (user) {
        await this.ensureUser(user);
      }
      return next();
    });
  }

  setupHandlers() {
    this.bot.use(async (ctx, next) => {
      try {
        const chatId = ctx.chat.id;
        if (chatId > 0 || !ctx.message || !ctx.message.text) return next();
        
        if (ctx.message.text.startsWith('/')) return next();
        
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          tradeDetailsStep: 'step6_seller_address',
          status: { $in: ['draft', 'awaiting_details'] }
        });
        
        if (!escrow) {
          return next();
        }
        
        const userId = ctx.from.id;
        const text = ctx.message.text.trim();
        
        if (!escrow.sellerId || escrow.sellerId !== userId) {
          return next();
        }
        
        const telegram = ctx.telegram;
        const groupId = escrow.groupId;
        
        if (!text.startsWith('0x') || text.length !== 42 || !/^0x[a-fA-F0-9]{40}$/.test(text)) {
          const errorMsg = await ctx.reply('❌ Invalid address format. Address must start with 0x and be 42 characters (0x + 40 hexadecimal characters).');
          // Try to delete the invalid message to avoid confusion
          try {
            await telegram.deleteMessage(groupId, ctx.message.message_id);
          } catch (deleteErr) {
            // non-critical
          }
          setTimeout(async () => {
            try {
              await telegram.deleteMessage(groupId, errorMsg.message_id);
            } catch (deleteErr) {
              console.error(`Failed to delete error message:`, deleteErr.message);
            }
          }, 5 * 60 * 1000);
          return;
        }
        
        // Delete user input message immediately
        try {
          await telegram.deleteMessage(groupId, ctx.message.message_id);
        } catch (deleteErr) {
          // Message might already be deleted
        }
        
        // Delete Step 6 instruction message
        if (escrow.step6SellerAddressMessageId) {
          try {
            await telegram.deleteMessage(groupId, escrow.step6SellerAddressMessageId);
          } catch (deleteErr) {
            // Message might already be deleted
          }
        }
        
        escrow.sellerAddress = text;
        escrow.tradeDetailsStep = 'completed';
        escrow.status = 'draft';
        escrow.buyerApproved = false;
        escrow.sellerApproved = false;
        await escrow.save();
        
        const summaryText = await buildDealSummary(escrow);
        const summaryMsg = await telegram.sendMessage(groupId, summaryText, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Approve', callback_data: 'approve_deal_summary' }]
            ]
          }
        });
        escrow.dealSummaryMessageId = summaryMsg.message_id;
        await escrow.save();
        
        return;
      } catch (e) {
        console.error('Step 6 seller address error', e);
      }
      return next();
    });
    
    this.bot.use(async (ctx, next) => {
      try {
        const chatId = ctx.chat.id;
        if (chatId > 0 || !ctx.message || !ctx.message.text) return next();
        
        if (ctx.message.text.startsWith('/')) return next();
        
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          tradeDetailsStep: 'step5_buyer_address',
          status: { $in: ['draft', 'awaiting_details'] }
        });
        
        if (!escrow) {
          return next();
        }
        
        const userId = ctx.from.id;
        const text = ctx.message.text.trim();
        
        if (!escrow.buyerId || escrow.buyerId !== userId) {
          try {
            const onlyBuyerMsg = await ctx.reply('❌ Only the designated buyer can submit the wallet address for this step.');
            const telegram = ctx.telegram;
            const groupId = escrow.groupId;
            setTimeout(async () => {
              try {
                await telegram.deleteMessage(groupId, onlyBuyerMsg.message_id);
              } catch (deleteErr) {
                console.error(`Failed to delete only-buyer warning:`, deleteErr.message);
              }
            }, 5 * 60 * 1000);
          } catch (warnErr) {
          }
          return; // Block others from proceeding
        }
        
        const telegram = ctx.telegram;
        const groupId = escrow.groupId;
        
        if (!text.startsWith('0x') || text.length !== 42 || !/^0x[a-fA-F0-9]{40}$/.test(text)) {
          const errorMsg = await ctx.reply('❌ Invalid address format. Address must start with 0x and be 42 characters (0x + 40 hexadecimal characters).');
          setTimeout(async () => {
            try {
              await telegram.deleteMessage(groupId, errorMsg.message_id);
            } catch (deleteErr) {
              console.error(`Failed to delete error message:`, deleteErr.message);
            }
          }, 5 * 60 * 1000);
          return;
        }
        
        // Delete user input message immediately
        try {
          await telegram.deleteMessage(groupId, ctx.message.message_id);
        } catch (deleteErr) {
          // Message might already be deleted
        }
        
        // Delete Step 5 instruction message
        if (escrow.step5BuyerAddressMessageId) {
          try {
            await telegram.deleteMessage(groupId, escrow.step5BuyerAddressMessageId);
          } catch (deleteErr) {
            // Message might already be deleted
          }
        }
        
        escrow.buyerAddress = text;
        escrow.tradeDetailsStep = 'step6_seller_address';
        escrow.status = 'draft';
        await escrow.save();
        
        const sellerUsername = escrow.sellerUsername ? `@${escrow.sellerUsername}` : 'Seller';
        const chainName = escrow.chain || 'BSC';
        const step6Msg = await telegram.sendMessage(
          groupId,
          `💰 Step 6 - ${sellerUsername}, enter your ${chainName} wallet address\nto receive refund if deal is cancelled.`
        );
        escrow.step6SellerAddressMessageId = step6Msg.message_id;
        await escrow.save();
        
        setTimeout(async () => {
          try {
            await telegram.deleteMessage(groupId, step6Msg.message_id);
          } catch (deleteErr) {
            // Message might already be deleted
          }
        }, 5 * 60 * 1000); // 5 minutes
        
        return; // Don't continue to next handlers
      } catch (e) {
        console.error('Step 5 buyer address error', e);
      }
      return next();
    });
    
    this.bot.use(async (ctx, next) => {
      try {
        const chatId = ctx.chat.id;
        if (chatId > 0 || !ctx.message || !ctx.message.text) return next();
        
        if (ctx.message.text.startsWith('/')) return next();
        
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          status: { $in: ['awaiting_deposit', 'deposited'] },
          transactionHashMessageId: { $exists: true }
        });
        
        if (!escrow) {
          return next();
        }
        
        const text = ctx.message.text.trim();
        const userId = ctx.from.id;
        
        if (escrow.sellerId !== userId) {
          return next();
        }
        
        let txHash = text;
        const urlPatterns = [
          /bscscan\.com\/tx\/(0x[a-fA-F0-9]{64})/i,
          /tronscan\.org\/#\/transaction\/([a-fA-F0-9]{64})/i,
          /solscan\.io\/tx\/([a-fA-F0-9]{64,})/i,
          /etherscan\.io\/tx\/(0x[a-fA-F0-9]{64})/i
        ];
        
        for (const pattern of urlPatterns) {
          const match = text.match(pattern);
          if (match) {
            txHash = match[1];
            if (!txHash.startsWith('0x') && (pattern.source.includes('bscscan') || pattern.source.includes('etherscan'))) {
              txHash = '0x' + txHash;
            }
            break;
          }
        }
        
        if (!/^(0x)?[a-fA-F0-9]{64}$/.test(txHash)) {
          await ctx.reply('❌ Invalid transaction hash format. Please provide a valid transaction hash or explorer link.');
          return;
        }
        
        if (escrow.chain && ['BSC', 'ETH', 'SEPOLIA'].includes(escrow.chain.toUpperCase()) && !txHash.startsWith('0x')) {
          txHash = '0x' + txHash;
        }
        
        const existingEscrow = await Escrow.findOne({
          transactionHash: txHash
        });
        
        if (existingEscrow) {
          await ctx.reply('❌ This transaction hash has already been used in a previous trade. Each transaction can only be used once.');
          return;
        }
        
        if (escrow.transactionHash) {
          if (escrow.transactionHash === txHash) {
            await ctx.reply('❌ This transaction has already been submitted for this trade. Please wait for confirmation or contact support if there\'s an issue.');
            return;
          }
          await ctx.reply('❌ This escrow already has a transaction hash. Cannot submit a different one.');
          return;
        }
        
        const provider = BlockchainService.providers[escrow.chain?.toUpperCase()] || BlockchainService.providers['BSC'];
        
        try {
            const tx = await executeRPCWithRetry(async () => {
              return await provider.getTransaction(txHash);
            });
            
            if (!tx) {
              await ctx.reply('❌ Transaction not found. Please check the transaction hash.');
              return;
            }
            
            const receipt = await executeRPCWithRetry(async () => {
              return await provider.getTransactionReceipt(txHash);
            });
            
            if (!receipt) {
              await ctx.reply('❌ Transaction receipt not found. Transaction may still be pending. Please wait a moment and try again.');
              return;
            }
          
          const tokenAddress = BlockchainService.getTokenAddress(escrow.token, escrow.chain);
          if (!tokenAddress) {
            await ctx.reply('❌ Token address not found. Please contact admin.');
            return;
          }
          
          const iface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
          const logs = receipt.logs.filter(log => log.address.toLowerCase() === tokenAddress.toLowerCase());
          
          if (logs.length === 0) {
            await ctx.reply('❌ No token transfer found in this transaction.');
            return;
          }
          
          const depositAddr = escrow.depositAddress.toLowerCase();
          let transferLog = null;
          let amount = 0;
          let fromAddr = null;
          let toAddr = null;
          
          for (const log of logs) {
            try {
              const parsed = iface.parseLog({
                topics: log.topics,
                data: log.data
              });
              if (parsed && parsed.name === 'Transfer') {
                fromAddr = parsed.args[0];
                toAddr = parsed.args[1];
                const value = parsed.args[2];
                
                if (toAddr.toLowerCase() === depositAddr) {
                  transferLog = parsed;
                  const decimals = BlockchainService.getTokenDecimals(escrow.token, escrow.chain);
                  amount = Number(value) / Math.pow(10, decimals);
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
          
          if (!transferLog) {
            await ctx.reply('❌ No transfer to deposit address found in this transaction.');
            return;
          }
          
          const from = fromAddr;
          const to = toAddr;
          const expectedAmount = escrow.quantity || 0;
          const tolerance = 0.01;
          
          if (Math.abs(amount - expectedAmount) > tolerance) {
            await ctx.reply(`⚠️ Amount mismatch. Expected: ${expectedAmount} ${escrow.token}, Found: ${amount.toFixed(2)} ${escrow.token}`);
            return;
          }
          
          const freshEscrow = await Escrow.findById(escrow._id);
          if (freshEscrow.transactionHash) {
            if (freshEscrow.transactionHash === txHash) {
              await ctx.reply('❌ This transaction has already been submitted for this trade. Please wait for confirmation.');
              return;
            }
            await ctx.reply('❌ This escrow already has a transaction hash. Cannot submit a different one.');
            return;
          }
          
          freshEscrow.transactionHash = txHash;
          freshEscrow.depositAmount = amount;
          freshEscrow.depositTransactionFromAddress = from;
          await freshEscrow.save();
          
          try {
            await ctx.telegram.deleteMessage(chatId, freshEscrow.transactionHashMessageId);
          } catch (e) {
            console.error('Failed to delete transaction hash message:', e);
          }
          
          try {
            await ctx.telegram.deleteMessage(chatId, ctx.message.message_id);
          } catch (e) {
            console.error('Failed to delete transaction link message:', e);
          }
          
          const buyerUsername = freshEscrow.buyerUsername || 'Buyer';
          const txHashShort = txHash.substring(0, 10) + '...';
          
          const txDetailsText = `<b>OG OTC Bot 🤖</b>

🟢 Exact ${freshEscrow.token} found

<b>Amount:</b> ${amount.toFixed(1)}
<b>From:</b> <code>${from}</code>
<b>To:</b> <code>${to}</code>
<b>Tx:</b> <code>${txHashShort}</code>

Waiting for @${buyerUsername} to confirm...`;
          
          const txDetailsMsg = await ctx.telegram.sendMessage(
            chatId,
            txDetailsText,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Confirm ✅', callback_data: `confirm_transaction_${freshEscrow.escrowId}` }]
                ]
              }
            }
          );
          
          freshEscrow.transactionHashMessageId = txDetailsMsg.message_id;
          await freshEscrow.save();
          
          return;
        } catch (err) {
          console.error('Error fetching transaction:', err);
          await ctx.reply('❌ Error fetching transaction details. Please check the transaction hash and try again.');
          return;
        }
      } catch (e) {
        console.error('Transaction hash handler error:', e);
      }
      return next();
    });
    
    this.bot.use(async (ctx, next) => {
      try {
        const chatId = ctx.chat.id;
        if (chatId > 0 || !ctx.message || !ctx.message.text) return next();
        
        if (ctx.message.text.startsWith('/')) return next();
        
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          tradeDetailsStep: { $in: ['step1_amount', 'step2_rate', 'step3_payment'] },
          status: { $in: ['draft', 'awaiting_details'] }
        });
        
        if (!escrow) {
          return next();
        }
        
        const text = ctx.message.text.trim();
        const userId = ctx.from.id;
        
        if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
          return next();
        }
        
        const telegram = ctx.telegram;
        const groupId = escrow.groupId;
        
        const scheduleMessageDeletion = (messageId, delayMs = 5 * 60 * 1000) => {
          setTimeout(async () => {
            try {
              await telegram.deleteMessage(groupId, messageId);
            } catch (deleteErr) {
              // Message might already be deleted or bot doesn't have permission
            }
          }, delayMs);
        };
        
        const deleteMessageImmediately = async (messageId) => {
          try {
            await telegram.deleteMessage(groupId, messageId);
          } catch (deleteErr) {
            // Message might already be deleted or bot doesn't have permission
          }
        };
        
        if (escrow.tradeDetailsStep === 'step1_amount') {
          const amount = parseFloat(text);
          if (isNaN(amount) || amount <= 0) {
            const errorMsg = await ctx.reply('❌ Please enter a valid amount. Example: 1000');
            scheduleMessageDeletion(errorMsg.message_id);
            return;
          }
          
          // Delete user input message immediately
          await deleteMessageImmediately(ctx.message.message_id);
          // Delete Step 1 instruction message if it exists
          if (escrow.step1MessageId) {
            await deleteMessageImmediately(escrow.step1MessageId);
          }
          
          escrow.quantity = amount;
          escrow.tradeDetailsStep = 'step2_rate';
          await escrow.save();
          
          const step2Msg = await ctx.reply('📊 Step 2 - Rate per USDT → Example: 89.5');
          escrow.step2MessageId = step2Msg.message_id;
          await escrow.save();
          scheduleMessageDeletion(step2Msg.message_id);
          return;
          
        } else if (escrow.tradeDetailsStep === 'step2_rate') {
          const rate = parseFloat(text);
          if (isNaN(rate) || rate <= 0) {
            const errorMsg = await ctx.reply('❌ Please enter a valid rate. Example: 89.5');
            scheduleMessageDeletion(errorMsg.message_id);
            return;
          }
          
          // Delete user input message immediately
          await deleteMessageImmediately(ctx.message.message_id);
          // Delete Step 2 instruction message if it exists
          if (escrow.step2MessageId) {
            await deleteMessageImmediately(escrow.step2MessageId);
          }
          
          escrow.rate = rate;
          escrow.tradeDetailsStep = 'step3_payment';
          await escrow.save();
          
          const step3Msg = await ctx.reply('💳 Step 3 - Payment method → Examples: CDM, CASH, CCW');
          escrow.step3MessageId = step3Msg.message_id;
          await escrow.save();
          scheduleMessageDeletion(step3Msg.message_id);
          return;
          
        } else if (escrow.tradeDetailsStep === 'step3_payment') {
          const paymentMethod = text.toUpperCase().trim();
          if (!paymentMethod || paymentMethod.length < 2) {
            const errorMsg = await ctx.reply('❌ Please enter a valid payment method. Examples: CDM, CASH, CCW');
            scheduleMessageDeletion(errorMsg.message_id);
            return;
          }
          
          // Delete user input message immediately
          await deleteMessageImmediately(ctx.message.message_id);
          // Delete Step 3 instruction message if it exists
          if (escrow.step3MessageId) {
            await deleteMessageImmediately(escrow.step3MessageId);
          }
          
          escrow.paymentMethod = paymentMethod;
          escrow.tradeDetailsStep = 'step4_chain_coin';
          escrow.status = 'draft';
          if (!escrow.tradeStartTime) {
            escrow.tradeStartTime = escrow.createdAt || new Date();
          }
          await escrow.save();
          
          const step4ChainMsg = await ctx.reply('🔗 Step 4 – Choose Blockchain', {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'BSC', callback_data: 'step4_select_chain_BSC' }
                ]
              ]
            }
          });
          escrow.step4ChainMessageId = step4ChainMsg.message_id;
          await escrow.save();
          
          scheduleMessageDeletion(step4ChainMsg.message_id);
          
          return;
        }
      } catch (e) {
        console.error('step-by-step trade details error', e);
      }
      return next();
    });
    

    this.bot.use(async (ctx, next) => {
      try {
        const chatId = ctx.chat.id;
        if (chatId > 0 || !ctx.message || !ctx.message.text) return next();
        
        if (ctx.message.text.startsWith('/')) return next();
                
        const escrow = await Escrow.findOne({ 
          groupId: chatId.toString(), 
          status: { $in: ['awaiting_details', 'draft'] }
        });
        if (!escrow) {
          return next();
        }
        
        if (escrow.tradeDetailsStep && escrow.tradeDetailsStep !== 'completed') {
          return next();
        }
                
        const text = ctx.message.text;
        const qtyMatch = text.match(/Quantity\s*[-:]*\s*(\d+(?:\.\d+)?)/i);
        const rateMatch = text.match(/Rate\s*[-:]*\s*(\d+(?:\.\d+)?)/i);
        
        if (!qtyMatch || !rateMatch) {
          return ctx.reply('❌ Please provide at least Quantity and Rate in the format:\nQuantity - 10\nRate - 90');
        }
        
        const newQuantity = Number(qtyMatch[1]);
        const newRate = Number(rateMatch[1]);
        
        
        escrow.quantity = newQuantity;
        escrow.rate = newRate;
        escrow.status = 'draft';
        if (!escrow.tradeStartTime) {
          escrow.tradeStartTime = escrow.createdAt || new Date();
        }
        await escrow.save();
        
        await ctx.reply('✅ Deal details saved.');
        const roleSelectionMsg = await ctx.reply('👤 Both users select your roles:', {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💰 I am Buyer', callback_data: 'select_role_buyer' },
                { text: '💵 I am Seller', callback_data: 'select_role_seller' }
              ]
            ]
          }
        });
        escrow.roleSelectionMessageId = roleSelectionMsg.message_id;
        await escrow.save();
        return;
      } catch (e) {
        console.error('deal details parse error', e);
      }
      return next();
    });
    
    // Helper function to settle and recycle group
    const settleAndRecycleGroup = async (escrow, telegram) => {
      try {
        // Find the group in pool
        const group = await GroupPool.findOne({ 
          assignedEscrowId: escrow.escrowId 
        });
        
        if (group) {
          // Remove buyer and seller from group
          const allUsersRemoved = await GroupPoolService.removeUsersFromGroup(escrow, group.groupId, telegram);
          
          if (allUsersRemoved) {
            // Recycle group back to pool
            group.status = 'available';
            group.assignedEscrowId = null;
            group.assignedAt = null;
            group.completedAt = null;
            group.inviteLink = null;
            await group.save();
            
            await telegram.sendMessage(
              escrow.groupId,
              '✅ Settlement completed! Group has been recycled and is ready for a new deal.'
            );
          }
        }
      } catch (error) {
        console.error('Error settling and recycling group:', error);
      }
    };
    
    // Restrict interaction: only allow /deal in groups
    this.bot.command('deal', groupDealHandler);
    
    // Admin-only release/refund commands
    this.bot.command('release', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        
        // Must be in a group
        if (chatId > 0) {
          return ctx.reply('❌ This command can only be used in a group chat.');
        }
        
        // Check if user is admin
        const isAdmin = config.getAllAdminUsernames().includes(ctx.from.username) || 
                       config.getAllAdminIds().includes(String(userId));
        
        if (!isAdmin) {
          return ctx.reply('❌ Only admins can use this command.');
        }
        
        // Find active escrow
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
        });
        
        if (!escrow) {
          return ctx.reply('❌ No active escrow found in this group.');
        }
        
        if (!escrow.buyerAddress) {
          return ctx.reply('❌ Buyer address is not set.');
        }
        
        const amount = escrow.confirmedAmount || escrow.depositAmount || 0;
        if (amount <= 0) {
          return ctx.reply('❌ No confirmed deposit found.');
        }
        
        await ctx.reply('🚀 Releasing funds to buyer...');
        
        try {
          // Release funds to buyer
          const releaseResult = await BlockchainService.releaseFunds(
            escrow.token,
            escrow.chain,
            escrow.buyerAddress,
            amount
          );
          
          escrow.status = 'completed';
          if (releaseResult && releaseResult.transactionHash) {
            escrow.releaseTransactionHash = releaseResult.transactionHash;
          }
          await escrow.save();
          
          await ctx.reply(`✅ ${amount.toFixed(5)} ${escrow.token} has been released to buyer's address!`);
          
          // Remove users and recycle group
          await settleAndRecycleGroup(escrow, ctx.telegram);
          
        } catch (error) {
          console.error('Error releasing funds:', error);
          await ctx.reply('❌ Error releasing funds. Please check the logs.');
        }
        
      } catch (error) {
        console.error('Error in release command:', error);
        ctx.reply('❌ An error occurred.');
      }
    });
    
    this.bot.command('refund', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        
        // Must be in a group
        if (chatId > 0) {
          return ctx.reply('❌ This command can only be used in a group chat.');
        }
        
        // Check if user is admin
        const isAdmin = config.getAllAdminUsernames().includes(ctx.from.username) || 
                       config.getAllAdminIds().includes(String(userId));
        
        if (!isAdmin) {
          return ctx.reply('❌ Only admins can use this command.');
        }
        
        // Find active escrow
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
        });
        
        if (!escrow) {
          return ctx.reply('❌ No active escrow found in this group.');
        }
        
        if (!escrow.sellerAddress) {
          return ctx.reply('❌ Seller address is not set.');
        }
        
        const amount = escrow.confirmedAmount || escrow.depositAmount || 0;
        if (amount <= 0) {
          return ctx.reply('❌ No confirmed deposit found.');
        }
        
        await ctx.reply('🔄 Refunding funds to seller...');
        
        try {
          // Refund funds to seller
          await BlockchainService.refundFunds(
            escrow.token,
            escrow.chain,
            escrow.sellerAddress,
            amount
          );
          
          escrow.status = 'refunded';
          await escrow.save();
          
          await ctx.reply(`✅ ${amount.toFixed(5)} ${escrow.token} has been refunded to seller's address!`);
          
          // Remove users and recycle group
          await settleAndRecycleGroup(escrow, ctx.telegram);
          
        } catch (error) {
          console.error('Error refunding funds:', error);
          await ctx.reply('❌ Error refunding funds. Please check the logs.');
        }
        
      } catch (error) {
        console.error('Error in refund command:', error);
        ctx.reply('❌ An error occurred.');
      }
    });
    

    const {
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
      adminGroupReset
    } = adminHandler;
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
    this.bot.command('admin_address_pool', adminAddressPool);
    this.bot.command('admin_init_addresses', adminInitAddresses);
    this.bot.command('admin_timeout_stats', adminTimeoutStats);
    this.bot.command('admin_cleanup_addresses', adminCleanupAddresses);
    this.bot.command('admin_recycle_groups', adminRecycleGroups);
    this.bot.command('admin_group_reset', adminGroupReset);

    this.bot.on('callback_query', callbackHandler);
    this.bot.on('chat_join_request', joinRequestHandler);
    
    // Remove generic welcome on new chat members; join flow handled via join requests
    
    // Remove menu command
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
          if (duplicateError.code === 11000) {
            user = await User.findOne({ telegramId: telegramUser.id });
          } else {
            throw duplicateError;
          }
        }
      } else {
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
        
        await connectDB();
        
        try {
        const addr = await BlockchainService.initialize();
      } catch (e) {
        console.warn('⚠️ EscrowVault not found. Bot will work in limited mode. Deploy with `npm run deploy:sepolia`');
      }
      
        await this.bot.launch();
        console.log('🤖 Escrow Bot started successfully!');
        
        
        
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    } catch (error) {
      console.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  

  
}

const bot = new EscrowBot();
bot.start();

setTimeout(async () => {
  try {    
    if (mongoose.connection.readyState !== 1) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('MongoDB connection timeout during cleanup'));
        }, 15000);
        
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
    
  } catch (error) {
    console.error('❌ Startup cleanup error:', error);
  }
}, 5000);
