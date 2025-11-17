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
const verifyHandler = require('./handlers/verifyHandler');
const images = require('./config/images');

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
  
  return `📋 <b> Deal Summary</b>

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
          await ctx.reply('❌ Invalid address format. Address must start with 0x and be 42 characters (0x + 40 hexadecimal characters).');
          return;
        }
        
        escrow.sellerAddress = text;
        escrow.tradeDetailsStep = 'completed';
        escrow.status = 'draft';
        escrow.buyerApproved = false;
        escrow.sellerApproved = false;
        await escrow.save();
        
        const summaryText = await buildDealSummary(escrow);
        const summaryMsg = await telegram.sendPhoto(groupId, images.CONFIRM_SUMMARY, {
          caption: summaryText,
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
          await ctx.reply('❌ Only the designated buyer can submit the wallet address for this step.');
          return; // Block others from proceeding
        }
        
        const telegram = ctx.telegram;
        const groupId = escrow.groupId;
        
        if (!text.startsWith('0x') || text.length !== 42 || !/^0x[a-fA-F0-9]{40}$/.test(text)) {
          await ctx.reply('❌ Invalid address format. Address must start with 0x and be 42 characters (0x + 40 hexadecimal characters).');
          return;
        }
        
        escrow.buyerAddress = text;
        escrow.tradeDetailsStep = 'step6_seller_address';
        escrow.status = 'draft';
        await escrow.save();
        
        const sellerUsername = escrow.sellerUsername ? `@${escrow.sellerUsername}` : 'Seller';
        const chainName = escrow.chain || 'BSC';
        const step6Msg = await telegram.sendPhoto(
          groupId,
          images.ENTER_ADDRESS,
          {
            caption: `💰 Step 6 - ${sellerUsername}, enter your ${chainName} wallet address\nto receive refund if deal is cancelled.`
          }
        );
        escrow.step6SellerAddressMessageId = step6Msg.message_id;
        await escrow.save();
        
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
          status: { $in: ['awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'] },
          transactionHashMessageId: { $exists: true }
        });
        
        if (!escrow) {
          return next();
        }
        
        // If escrow is waiting for button clicks (not text input), ignore text messages
        // Only process text when status is 'awaiting_deposit' (waiting for transaction hash)
        if (escrow.status !== 'awaiting_deposit') {
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
        
        // Check if this transaction hash was already used in any escrow
        const existingEscrow = await Escrow.findOne({
          $or: [
            { transactionHash: txHash },
            { partialTransactionHashes: txHash }
          ]
        });
        
        if (existingEscrow) {
          await ctx.reply('❌ This transaction hash has already been used in a previous trade. Each transaction can only be used once.');
          return;
        }
        
        // Check if this transaction was already submitted for this escrow
        if (escrow.transactionHash === txHash || (escrow.partialTransactionHashes && escrow.partialTransactionHashes.includes(txHash))) {
          await ctx.reply('❌ This transaction has already been submitted for this trade. Please wait for confirmation or contact support if there\'s an issue.');
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
          
          // Get fresh escrow to check current accumulated amount
          const freshEscrow = await Escrow.findById(escrow._id);
          
          // Calculate accumulated amount (including this new transaction)
          const currentAccumulated = freshEscrow.accumulatedDepositAmount || 0;
          const newAccumulated = currentAccumulated + amount;
          const remainingAmount = expectedAmount - newAccumulated;
          
          // Check if this transaction was already added
          if (freshEscrow.transactionHash === txHash || (freshEscrow.partialTransactionHashes && freshEscrow.partialTransactionHashes.includes(txHash))) {
            await ctx.reply('❌ This transaction has already been submitted for this trade. Please wait for confirmation.');
            return;
          }
          
          // Update accumulated amount and transaction hashes
          freshEscrow.accumulatedDepositAmount = newAccumulated;
          
          // If this is the first transaction, store it in transactionHash, otherwise add to partialTransactionHashes
          if (!freshEscrow.transactionHash) {
            freshEscrow.transactionHash = txHash;
            freshEscrow.depositTransactionFromAddress = from;
          } else {
            if (!freshEscrow.partialTransactionHashes) {
              freshEscrow.partialTransactionHashes = [];
            }
            freshEscrow.partialTransactionHashes.push(txHash);
          }
          
          freshEscrow.depositAmount = newAccumulated;
          // Ensure status is 'awaiting_deposit' for partial payments to allow next transaction
          if (freshEscrow.status !== 'awaiting_deposit') {
            freshEscrow.status = 'awaiting_deposit';
          }
          await freshEscrow.save();
          
          // Check if full amount (or more) has been received
          // If amount is >= expected amount (with tolerance), proceed to confirmation
          if (newAccumulated >= expectedAmount - tolerance) {
            // Full amount received - proceed to confirmation
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
            
            const txHashShort = txHash.substring(0, 10) + '...';
            const totalTxCount = 1 + (freshEscrow.partialTransactionHashes ? freshEscrow.partialTransactionHashes.length : 0);
            const fromAddress = freshEscrow.depositTransactionFromAddress || from || 'N/A';
            const depositAddress = freshEscrow.depositAddress || 'N/A';
            const expectedAmountDisplay = (freshEscrow.quantity || 0).toFixed(2);
            const overDelivered = expectedAmount > 0 && (newAccumulated - expectedAmount) > tolerance;
            
            freshEscrow.confirmedAmount = newAccumulated;
            freshEscrow.status = 'deposited';
            await freshEscrow.save();
            
            const statusLine = overDelivered
              ? `🟢 Extra ${freshEscrow.token} received (expected ${expectedAmount.toFixed(2)}, got ${newAccumulated.toFixed(2)})`
              : `🟢 Exact ${freshEscrow.token} found`;
            
            let confirmedTxText = `<b>P2P MM Bot 🤖</b>

${statusLine}

<b>Total Amount:</b> ${newAccumulated.toFixed(2)} ${freshEscrow.token}
<b>Transactions:</b> ${totalTxCount} transaction(s)
<b>From:</b> <code>${fromAddress}</code>
<b>To:</b> <code>${depositAddress}</code>
<b>Main Tx:</b> <code>${txHashShort}</code>`;
            
            if (overDelivered) {
              confirmedTxText += `\n<b>Original Deal Amount:</b> ${expectedAmountDisplay} ${freshEscrow.token}`;
            }
            
            if (totalTxCount > 1) {
              confirmedTxText += `\n\n✅ Full amount received through ${totalTxCount} transaction(s)`;
            }
            
            const txDetailsMsg = await ctx.telegram.sendPhoto(
              chatId,
              images.DEPOSIT_FOUND,
              {
                caption: confirmedTxText,
                parse_mode: 'HTML'
              }
            );
            
            freshEscrow.transactionHashMessageId = txDetailsMsg.message_id;
            await freshEscrow.save();
            
            if (freshEscrow.buyerId) {
              const buyerMention = freshEscrow.buyerUsername
                ? `@${freshEscrow.buyerUsername}`
                : freshEscrow.buyerId
                  ? `[${freshEscrow.buyerId}]`
                  : 'Buyer';

              const buyerInstruction = `✅ Payment Received!

Use /release After Fund Transfer to Seller

⚠️ Please note:
• Don't share payment details on private chat
• Please share all deals in group`;

              await ctx.telegram.sendMessage(chatId, buyerInstruction);
            }
            
            return;
          } else {
            // Partial deposit - only show this if amount is actually less than expected
            // (This should only happen if newAccumulated < expectedAmount - tolerance)
            if (newAccumulated < expectedAmount - tolerance) {
              const remainingFormatted = remainingAmount.toFixed(2);
              const partialMessage = await ctx.reply(
                `✅ Partial deposit received: ${amount.toFixed(2)} ${escrow.token}\n\n` +
                `📊 Total received so far: ${newAccumulated.toFixed(2)} ${escrow.token}\n` +
                `💰 Remaining amount needed: ${remainingFormatted} ${escrow.token}\n\n` +
                `Please choose an option:`,
                {
                  parse_mode: 'HTML',
                  reply_markup: Markup.inlineKeyboard([
                    [
                      Markup.button.callback('✅ Continue with this amount', `partial_continue_${freshEscrow.escrowId}`),
                      Markup.button.callback('💰 Pay remaining amount', `partial_pay_remaining_${freshEscrow.escrowId}`)
                    ]
                  ]).reply_markup
                }
              );
              
              // Store partial payment message ID for potential updates
              freshEscrow.partialPaymentMessageId = partialMessage.message_id;
              await freshEscrow.save();
            }
            // If somehow we get here with excess amount, it should have been caught above
            return;
          }
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
        
        if (escrow.tradeDetailsStep === 'step1_amount') {
          const amount = parseFloat(text);
          if (isNaN(amount) || amount <= 0) {
            await ctx.reply('❌ Please enter a valid amount. Example: 1000');
            return;
          }
          
          escrow.quantity = amount;
          escrow.tradeDetailsStep = 'step2_rate';
          await escrow.save();
          
          const step2Msg = await ctx.replyWithPhoto(images.ENTER_RATE, {
            caption: '📊 Step 2 - Rate per USDT → Example: 89.5'
          });
          escrow.step2MessageId = step2Msg.message_id;
          await escrow.save();
          return;
          
        } else if (escrow.tradeDetailsStep === 'step2_rate') {
          const rate = parseFloat(text);
          if (isNaN(rate) || rate <= 0) {
            await ctx.reply('❌ Please enter a valid rate. Example: 89.5');
            return;
          }
          
          escrow.rate = rate;
          escrow.tradeDetailsStep = 'step3_payment';
          await escrow.save();
          
          const step3Msg = await ctx.replyWithPhoto(images.PAYMENT_METHOD, {
            caption: '💳 Step 3 - Payment method → Examples: CDM, CASH, CCW'
          });
          escrow.step3MessageId = step3Msg.message_id;
          await escrow.save();
          return;
          
        } else if (escrow.tradeDetailsStep === 'step3_payment') {
          const paymentMethod = text.toUpperCase().trim();
          if (!paymentMethod || paymentMethod.length < 2) {
            await ctx.reply('❌ Please enter a valid payment method. Examples: CDM, CASH, CCW');
            return;
          }
          
          escrow.paymentMethod = paymentMethod;
          escrow.tradeDetailsStep = 'step4_chain_coin';
          escrow.status = 'draft';
          if (!escrow.tradeStartTime) {
            escrow.tradeStartTime = escrow.createdAt || new Date();
          }
          await escrow.save();
          
          const step4ChainMsg = await ctx.replyWithPhoto(images.SELECT_CHAIN, {
            caption: '🔗 Step 4 – Choose Blockchain',
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
          
          return;
        }
      } catch (e) {
        console.error('step-by-step trade details error', e);
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
            // Clear escrow invite link (but keep group invite link - it's permanent)
            const freshEscrow = await Escrow.findOne({ escrowId: escrow.escrowId });
            if (freshEscrow && freshEscrow.inviteLink) {
              freshEscrow.inviteLink = null;
              await freshEscrow.save();
            }
            
            // Refresh invite link (revoke old and create new) so removed users can rejoin
            await GroupPoolService.refreshInviteLink(group.groupId, telegram);
            
            // Recycle group back to pool
            group.status = 'available';
            group.assignedEscrowId = null;
            group.assignedAt = null;
            group.completedAt = null;
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
    
    // Verify address command (main group only)
    this.bot.command('verify', verifyHandler);
    
    // Admin/seller release command (with confirmation)
    this.bot.command('release', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        
        // Must be in a group
        if (chatId > 0) {
          return ctx.reply('❌ This command can only be used in a group chat.');
        }
        
        // Find active escrow
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
        });
        
        if (!escrow) {
          return ctx.reply('❌ No active escrow found in this group.');
        }
        
        const isAdmin = config.getAllAdminUsernames().includes(ctx.from.username) || 
                        config.getAllAdminIds().includes(String(userId));
        const isSeller = Number(escrow.sellerId) === Number(userId);
        
        if (!isAdmin && !isSeller) {
          return ctx.reply('❌ Only admins or the seller can use this command.');
        }
        
        if (!escrow.buyerAddress) {
          return ctx.reply('❌ Buyer address is not set.');
        }
        
        const amount = Number(escrow.confirmedAmount || escrow.depositAmount || 0);
        if (amount <= 0) {
          return ctx.reply('❌ No confirmed deposit found.');
        }
        
        const buyerLabel = escrow.buyerUsername
          ? `@${escrow.buyerUsername}`
          : escrow.buyerId
            ? `[${escrow.buyerId}]`
            : 'the buyer';
        
        // Reset confirmation flags
        escrow.buyerConfirmedRelease = false;
        escrow.sellerConfirmedRelease = false;
        await escrow.save();
        
        const buyerLine = `⌛️ ${buyerLabel} - Waiting...`;
        const sellerLabel = escrow.sellerUsername
          ? `@${escrow.sellerUsername}`
          : escrow.sellerId
            ? `[${escrow.sellerId}]`
            : 'the seller';
        const sellerLine = `⌛️ ${sellerLabel} - Waiting...`;
        
        const releaseCaption = `<b>Release Confirmation</b>

${buyerLine}
${sellerLine}

Both users must approve to release payment.`;
        
        const releaseMsg = await ctx.replyWithPhoto(images.RELEASE_CONFIRMATION, {
          caption: releaseCaption,
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Approve', `release_confirm_yes_${escrow.escrowId}`),
              Markup.button.callback('❌ Decline', `release_confirm_no_${escrow.escrowId}`)
            ]
          ]).reply_markup
        });
        
        escrow.releaseConfirmationMessageId = releaseMsg.message_id;
        await escrow.save();
        
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
          const refundResult = await BlockchainService.refundFunds(
            escrow.token,
            escrow.chain,
            escrow.sellerAddress,
            amount
          );
          
          if (!refundResult || !refundResult.success) {
            throw new Error('Refund transaction failed - no result returned');
          }
          
          escrow.status = 'refunded';
          if (refundResult.transactionHash) {
            escrow.refundTransactionHash = refundResult.transactionHash;
          }
          await escrow.save();
          
          let successMessage = `✅ ${amount.toFixed(5)} ${escrow.token} has been refunded to seller's address!`;
          if (refundResult.transactionHash) {
            // Generate explorer link based on chain
            let explorerUrl = '';
            const chainUpper = escrow.chain.toUpperCase();
            if (chainUpper === 'BSC' || chainUpper === 'BNB') {
              explorerUrl = `https://bscscan.com/tx/${refundResult.transactionHash}`;
            } else if (chainUpper === 'ETH' || chainUpper === 'ETHEREUM') {
              explorerUrl = `https://etherscan.io/tx/${refundResult.transactionHash}`;
            } else if (chainUpper === 'POLYGON' || chainUpper === 'MATIC') {
              explorerUrl = `https://polygonscan.com/tx/${refundResult.transactionHash}`;
            }
            
            if (explorerUrl) {
              successMessage += `\n\n🔗 Transaction: ${explorerUrl}`;
            }
          }
          
          await ctx.reply(successMessage);
          
          // Remove users and recycle group
          await settleAndRecycleGroup(escrow, ctx.telegram);
          
        } catch (error) {
          console.error('Error refunding funds:', error);
          const errorMessage = error?.message || error?.toString() || 'Unknown error';
          await ctx.reply(`❌ Error refunding funds: ${errorMessage}`);
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
      adminGroupReset,
      adminResetForce
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
    this.bot.command('admin_reset_force', adminResetForce);

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
