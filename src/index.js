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
const UserStatsService = require('./services/UserStatsService');

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


function parseFlexibleNumber(value) {
  if (value === null || value === undefined) {
    return NaN;
  }
  let str = String(value).trim();
  if (!str) {
    return NaN;
  }
  str = str.replace(/[^\d.,-]/g, '');
  if (!str) {
    return NaN;
  }
  const isNegative = str.startsWith('-');
  if (isNegative) {
    str = str.slice(1);
  }
  
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');
  
  // Determine if separators are thousands separators or decimal separators
  let decimalSeparator = null;
  let hasBothSeparators = lastComma > -1 && lastDot > -1;
  
  if (hasBothSeparators) {
    // Both comma and dot present - the last one is the decimal separator
    decimalSeparator = lastComma > lastDot ? ',' : '.';
  } else if (lastComma > -1) {
    // Only comma present - check if it's thousands or decimal separator
    const afterComma = str.slice(lastComma + 1);
    // If comma is followed by exactly 3 digits, it's likely thousands separator
    if (afterComma.length === 3 && /^\d{3}$/.test(afterComma) && lastComma > 0) {
      // Likely thousands separator (e.g., "15,000")
      decimalSeparator = null;
    } else if (afterComma.length === 2 && /^00$/.test(afterComma)) {
      // "15,00" - two zeros, more likely thousands separator (1500) than decimal (15.00)
      decimalSeparator = null;
    } else if (afterComma.length <= 2 && /^\d{1,2}$/.test(afterComma) && !/^0+$/.test(afterComma)) {
      // 1-2 digits with at least one non-zero - likely decimal separator (e.g., "15,50", "15,5")
      decimalSeparator = ',';
    } else if (afterComma.length === 1 && afterComma === '0') {
      // Single zero after comma - likely decimal (e.g., "15,0")
      decimalSeparator = ',';
    } else {
      // Default: treat as thousands separator
      decimalSeparator = null;
    }
  } else if (lastDot > -1) {
    // Only dot present - check if it's thousands or decimal separator
    const afterDot = str.slice(lastDot + 1);
    // If dot is followed by exactly 3 digits, it's likely thousands separator
    if (afterDot.length === 3 && /^\d{3}$/.test(afterDot) && lastDot > 0) {
      // Likely thousands separator (e.g., "15.000")
      decimalSeparator = null;
    } else if (afterDot.length <= 2 && /^\d{1,2}$/.test(afterDot)) {
      // 1-2 digits after dot - typically decimal separator (e.g., "15.50", "15.5", "15.00", "15.0")
      decimalSeparator = '.';
    } else {
      // Default: treat as thousands separator
      decimalSeparator = null;
    }
  }
  
  let normalized = str;
  if (decimalSeparator) {
    // Has decimal separator - remove all other separators, then format with dot
    const otherSeparator = decimalSeparator === '.' ? ',' : '.';
    const otherSepRegex = new RegExp('\\' + otherSeparator, 'g');
    normalized = normalized.replace(otherSepRegex, '');
    const lastDecimalIndex = normalized.lastIndexOf(decimalSeparator);
    const integerPart = normalized
      .slice(0, lastDecimalIndex)
      .replace(new RegExp('\\' + decimalSeparator, 'g'), '');
    const decimalPart = normalized.slice(lastDecimalIndex + 1);
    normalized = `${integerPart}.${decimalPart}`;
  } else {
    // No decimal separator - remove all separators (they're thousands separators)
    normalized = normalized.replace(/[.,]/g, '');
  }
  
  const parsed = parseFloat(normalized);
  if (Number.isNaN(parsed)) {
    return NaN;
  }
  return isNegative ? -parsed : parsed;
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
        const chat = ctx.chat;
        const from = ctx.from;
        if (!chat || !from) {
          return next();
        }
        const chatId = chat.id;
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
        
        const userId = from.id;
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
        const chat = ctx.chat;
        const from = ctx.from;
        if (!chat || !from) {
          return next();
        }
        const chatId = chat.id;
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
        
        const userId = from.id;
        const text = ctx.message.text.trim();
        
        // Silently ignore messages from users who aren't the buyer
        if (!escrow.buyerId || escrow.buyerId !== userId) {
          return; // Silently ignore - don't send error message
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
        const chat = ctx.chat;
        const from = ctx.from;
        if (!chat || !from) {
          return next();
        }
        const chatId = chat.id;
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
        const userId = from.id;
        
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
          const decimals = BlockchainService.getTokenDecimals(escrow.token, escrow.chain);
          let amount = 0;
          let amountWeiBigInt = 0n;
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
                  amountWeiBigInt = BigInt(value.toString());
                  amount = Number(amountWeiBigInt) / Math.pow(10, decimals);
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
          
          // Update accumulated amount (decimal and wei) and transaction hashes
          freshEscrow.accumulatedDepositAmount = newAccumulated;
          const currentAccumulatedWei = BigInt(freshEscrow.accumulatedDepositAmountWei || '0');
          const newAccumulatedWei = currentAccumulatedWei + amountWeiBigInt;
          freshEscrow.accumulatedDepositAmountWei = newAccumulatedWei.toString();
          
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
        const chat = ctx.chat;
        const from = ctx.from;
        if (!chat || !from) {
          return next();
        }
        const chatId = chat.id;
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
        const userId = from.id;
        
        // Silently ignore messages from users who aren't buyer or seller
        if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
          return; // Silently ignore
        }
        
        const telegram = ctx.telegram;
        const groupId = escrow.groupId;
        
        if (escrow.tradeDetailsStep === 'step1_amount') {
          const amount = parseFlexibleNumber(text);
          if (isNaN(amount) || amount <= 0) {
            await ctx.reply('❌ Please enter a valid amount. Examples: 1,500 or 1.500,50');
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
          const rate = parseFlexibleNumber(text);
          if (isNaN(rate) || rate <= 0) {
            await ctx.reply('❌ Please enter a valid rate. Examples: 89.5 or 89,50');
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
    
    // Restart trade command (trade groups only)
    const restartHandler = require('./handlers/restartHandler');
    this.bot.command('restart', restartHandler);
    
    // Dispute command (trade groups only)
    const disputeHandler = require('./handlers/disputeHandler');
    this.bot.command('dispute', disputeHandler);
    
    // Admin/seller release command (with confirmation)
    this.bot.command('release', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        
        // Must be in a group
        if (chatId > 0) {
          return ctx.reply('❌ This command can only be used in a group chat.');
        }

        // Find active escrow (including disputed trades so admins can resolve)
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
        });
        
        // Silently ignore if no escrow found (command should only work in trade groups)
        if (!escrow) {
          return;
        }
        
        const normalizedUsername = (ctx.from.username || '').toLowerCase();
        const isAdmin = config.getAllAdminUsernames().some((name) => name && name.toLowerCase() === normalizedUsername) || 
                        config.getAllAdminIds().includes(String(userId));
        const isSellerIdMatch = escrow.sellerId && Number(escrow.sellerId) === Number(userId);
        const isSellerUsernameMatch = escrow.sellerUsername && escrow.sellerUsername.toLowerCase() === normalizedUsername;
        const isSeller = Boolean(isSellerIdMatch || isSellerUsernameMatch);
        
        // For partial release, only admin can use
        const commandText = ctx.message.text.trim();
        const parts = commandText.split(/\s+/);
        const hasAmount = parts.length > 1;
        
        if (hasAmount && !isAdmin) {
          return ctx.reply('❌ Only admins can use partial release. Use /release without amount for normal release.');
        }
        
        if (!isAdmin && !isSeller) {
          return ctx.reply('❌ Only admins or the seller can use this command.');
        }
        
        if (!escrow.buyerAddress) {
          return ctx.reply('❌ Buyer address is not set.');
        }
        
        // Parse amount from command (e.g., /release -50 or /release 50)
        let requestedAmount = null;
        
        if (hasAmount) {
          const amountStr = parts[1].replace(/^-/, ''); // Remove leading minus if present
          requestedAmount = parseFloat(amountStr);
          if (isNaN(requestedAmount) || requestedAmount <= 0) {
            return ctx.reply('❌ Invalid amount. Usage: /release or /release <amount>');
          }
        }
        
        const decimals = BlockchainService.getTokenDecimals(escrow.token, escrow.chain);
        const amountWeiOverride = escrow.accumulatedDepositAmountWei && escrow.accumulatedDepositAmountWei !== '0'
          ? escrow.accumulatedDepositAmountWei
          : null;
        const totalDeposited = Number(
          escrow.accumulatedDepositAmount ||
          escrow.depositAmount ||
          escrow.confirmedAmount ||
          0
        );
        const formattedTotalDeposited = amountWeiOverride
          ? Number(ethers.formatUnits(BigInt(amountWeiOverride), decimals))
          : totalDeposited;
          
        if (totalDeposited <= 0) {
          return ctx.reply('❌ No confirmed deposit found.');
        }
        
        // Determine release amount
        const releaseAmount = requestedAmount !== null ? requestedAmount : formattedTotalDeposited;
        
        // Validate amount - check against available balance
        if (releaseAmount > formattedTotalDeposited) {
          return ctx.reply(`❌ Release amount (${releaseAmount.toFixed(5)}) exceeds available balance (${formattedTotalDeposited.toFixed(5)} ${escrow.token}).`);
        }
        
        if (releaseAmount <= 0) {
          return ctx.reply('❌ Release amount must be greater than 0.');
        }
        
        // Store pending release amount
        escrow.pendingReleaseAmount = requestedAmount !== null ? releaseAmount : null;
        escrow.pendingRefundAmount = null; // Clear any pending refund
        
        // For admin partial releases, only admin confirmation is needed
        // For full releases or seller releases, adjust confirmation requirements
        const isPartialReleaseByAdmin = hasAmount && isAdmin;
        const sellerInitiatedRelease = !isAdmin && isSeller && !hasAmount;
        
        if (isPartialReleaseByAdmin) {
          // Admin partial release: only admin needs to confirm
          escrow.adminConfirmedRelease = false;
          escrow.buyerConfirmedRelease = false;
          escrow.sellerConfirmedRelease = false;
          await escrow.save();
          
          const releaseCaption = `<b>Admin Partial Release Confirmation</b>

Amount: ${releaseAmount.toFixed(5)} ${escrow.token}
Total Deposited: ${formattedTotalDeposited.toFixed(5)} ${escrow.token}

⚠️ Admin approval required for partial release.`;
          
          const releaseMsg = await ctx.replyWithPhoto(images.RELEASE_CONFIRMATION, {
            caption: releaseCaption,
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Confirm Release', `admin_release_confirm_yes_${escrow.escrowId}`),
                Markup.button.callback('❌ Cancel', `admin_release_confirm_no_${escrow.escrowId}`)
              ]
            ]).reply_markup
          });
          
          escrow.releaseConfirmationMessageId = releaseMsg.message_id;
          await escrow.save();
          } else {
          // Full release or seller release
          // Reset confirmation flags
          escrow.adminConfirmedRelease = false;
          if (sellerInitiatedRelease) {
            // Auto-confirm buyer; only seller needs to approve
            escrow.buyerConfirmedRelease = true;
            escrow.sellerConfirmedRelease = false;
          } else {
            escrow.buyerConfirmedRelease = false;
            escrow.sellerConfirmedRelease = false;
          }
          escrow.adminConfirmedRelease = false;
          await escrow.save();
          
          // Get usernames from escrow (exact same format as DEAL CONFIRMED message)
          // At this point, buyerId and sellerId should always be set (deal must be confirmed to reach this status)
          const buyerTag = escrow.buyerUsername ? `@${escrow.buyerUsername}` : `[${escrow.buyerId}]`;
          const sellerTag = escrow.sellerUsername ? `@${escrow.sellerUsername}` : `[${escrow.sellerId}]`;
          
          const releaseType = requestedAmount !== null ? 'Partial' : 'Full';
          const approvalNote = sellerInitiatedRelease
            ? 'Only the seller needs to approve to release payment.'
            : 'Both users must approve to release payment.';
          
          // Build caption based on whether seller initiated
          let releaseCaption;
          if (sellerInitiatedRelease) {
            // Only show seller line when seller initiates
            const sellerLine = `⌛️ ${sellerTag} - Waiting...`;
            releaseCaption = `<b>Release Confirmation (${releaseType})</b>

${requestedAmount !== null ? `Amount: ${releaseAmount.toFixed(5)} ${escrow.token}\nTotal Deposited: ${formattedTotalDeposited.toFixed(5)} ${escrow.token}\n\n` : ''}${sellerLine}

${approvalNote}`;
          } else {
            // Show both lines when admin initiates
            const buyerLine = escrow.buyerConfirmedRelease
              ? `✅ ${buyerTag} - Confirmed`
              : `⌛️ ${buyerTag} - Waiting...`;
            const sellerLine = escrow.sellerConfirmedRelease
              ? `✅ ${sellerTag} - Confirmed`
              : `⌛️ ${sellerTag} - Waiting...`;
            releaseCaption = `<b>Release Confirmation (${releaseType})</b>

${requestedAmount !== null ? `Amount: ${releaseAmount.toFixed(5)} ${escrow.token}\nTotal Deposited: ${formattedTotalDeposited.toFixed(5)} ${escrow.token}\n\n` : ''}${buyerLine}
${sellerLine}

${approvalNote}`;
          }
          
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
        
        // Find active escrow (including disputed trades so admins can resolve)
        const escrow = await Escrow.findOne({ 
          groupId: chatId.toString(), 
          status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
        });
        
        // Silently ignore if no escrow found (command should only work in trade groups)
        if (!escrow) {
          return;
        }
        
        if (!escrow.sellerAddress) {
          return ctx.reply('❌ Seller address is not set.');
        }
        
        // Parse amount from command (e.g., /refund -50 or /refund 50)
        const commandText = ctx.message.text.trim();
        const parts = commandText.split(/\s+/);
        let requestedAmount = null;
        
        if (parts.length > 1) {
          const amountStr = parts[1].replace(/^-/, ''); // Remove leading minus if present
          requestedAmount = parseFloat(amountStr);
          if (isNaN(requestedAmount) || requestedAmount <= 0) {
            return ctx.reply('❌ Invalid amount. Usage: /refund or /refund <amount>');
          }
        }
        
        // Use accumulatedDepositAmount first (actual amount received from all transactions)
        // Then fall back to depositAmount, then confirmedAmount
        // NEVER use quantity as that's the expected amount, not the actual received amount
        const decimals = BlockchainService.getTokenDecimals(escrow.token, escrow.chain);
        const amountWeiOverride = escrow.accumulatedDepositAmountWei && escrow.accumulatedDepositAmountWei !== '0'
          ? escrow.accumulatedDepositAmountWei
          : null;
        const totalDeposited = Number(
          escrow.accumulatedDepositAmount || 
          escrow.depositAmount || 
          escrow.confirmedAmount || 
          0
        );
        const formattedTotalDeposited = amountWeiOverride
          ? Number(ethers.formatUnits(BigInt(amountWeiOverride), decimals))
          : totalDeposited;
        
        if (totalDeposited <= 0) {
          return ctx.reply('❌ No confirmed deposit found.');
        }
        
        // Determine refund amount
        const refundAmount = requestedAmount !== null ? requestedAmount : formattedTotalDeposited;
        
        // Validate amount - check against available balance
        if (refundAmount > formattedTotalDeposited) {
          return ctx.reply(`❌ Refund amount (${refundAmount.toFixed(5)}) exceeds available balance (${formattedTotalDeposited.toFixed(5)} ${escrow.token}).`);
        }
        
        if (refundAmount <= 0) {
          return ctx.reply('❌ Refund amount must be greater than 0.');
        }
        
        // Store pending refund amount
        escrow.pendingRefundAmount = refundAmount;
        escrow.pendingReleaseAmount = null; // Clear any pending release
        
        // Send refund confirmation message
        const sellerLabel = escrow.sellerUsername
          ? `@${escrow.sellerUsername}`
          : escrow.sellerId
            ? `[${escrow.sellerId}]`
            : 'the seller';
        
        const refundType = requestedAmount !== null ? 'Partial' : 'Full';
        const refundCaption = `<b>Refund Confirmation (${refundType})</b>

Amount: ${refundAmount.toFixed(5)} ${escrow.token}
${requestedAmount !== null ? `Total Deposited: ${formattedTotalDeposited.toFixed(5)} ${escrow.token}\n` : ''}To: ${sellerLabel}
Address: <code>${escrow.sellerAddress}</code>

⚠️ Are you sure you want to refund the funds?`;

        const refundMsg = await ctx.replyWithPhoto(images.RELEASE_CONFIRMATION, {
          caption: refundCaption,
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
              [
              Markup.button.callback('✅ Confirm Refund', `refund_confirm_yes_${escrow.escrowId}`),
              Markup.button.callback('❌ Cancel', `refund_confirm_no_${escrow.escrowId}`)
              ]
          ]).reply_markup
        });
        
        escrow.refundConfirmationMessageId = refundMsg.message_id;
        await escrow.save();
        
      } catch (error) {
        console.error('Error in refund command:', error);
        ctx.reply('❌ An error occurred.');
      }
    });
    
    this.bot.command('balance', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        
        // Must be in a group
        if (chatId > 0) {
          return ctx.reply('❌ This command can only be used in a group chat.');
        }
        
        // Find active escrow
        const escrow = await Escrow.findOne({
          groupId: chatId.toString(),
          status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
        });
        
        // Silently ignore if no escrow found (command should only work in trade groups)
        if (!escrow) {
          return;
        }
        
        // Calculate available balance
        const decimals = BlockchainService.getTokenDecimals(escrow.token, escrow.chain);
        const amountWeiOverride = escrow.accumulatedDepositAmountWei && escrow.accumulatedDepositAmountWei !== '0'
          ? escrow.accumulatedDepositAmountWei
          : null;
        const totalDeposited = Number(
          escrow.accumulatedDepositAmount ||
          escrow.depositAmount ||
          escrow.confirmedAmount ||
          0
        );
        const availableBalance = amountWeiOverride
          ? Number(ethers.formatUnits(BigInt(amountWeiOverride), decimals))
          : totalDeposited;
        
        if (availableBalance <= 0) {
          return ctx.reply('❌ No available balance found.');
        }
        
        // Format network name
        const networkName = (escrow.chain || 'BSC').toUpperCase();
        
        // Build balance message
        const balanceMessage = `<b>💰 Available Balance</b>

<b>Amount:</b> ${availableBalance.toFixed(5)} ${escrow.token}
<b>Token:</b> ${escrow.token}
<b>Network:</b> ${networkName}

This is the current available balance for this trade.`;
        
        await ctx.reply(balanceMessage, { parse_mode: 'HTML' });
        
      } catch (error) {
        console.error('Error in balance command:', error);
        ctx.reply('❌ An error occurred.');
      }
    });

    this.bot.command('stats', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        
        if (chatId > 0) {
          return ctx.reply('❌ This command can only be used in a group chat.');
        }
        
        const messageText = ctx.message.text || '';
        const parts = messageText.trim().split(/\s+/);
        let targetUsername = null;
        let targetTelegramId = null;
        
        if (parts.length > 1 && parts[1]) {
          targetUsername = parts[1].replace(/^@/, '');
        } else {
          targetTelegramId = ctx.from.id;
        }
        
        let userStats = await UserStatsService.getUserStats({
          telegramId: targetTelegramId,
          username: targetUsername
        });
        
        // Helper to get telegramId from escrows by username
        let foundTelegramIdFromEscrow = null;
        if (targetUsername) {
          const Escrow = require('./models/Escrow');
          const escrowWithUser = await Escrow.findOne({
            $or: [
              { buyerUsername: { $regex: new RegExp(`^${targetUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
              { sellerUsername: { $regex: new RegExp(`^${targetUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
            ]
          }).sort({ createdAt: -1 });
          
          if (escrowWithUser) {
            foundTelegramIdFromEscrow = escrowWithUser.buyerUsername?.toLowerCase() === targetUsername.toLowerCase()
              ? escrowWithUser.buyerId
              : escrowWithUser.sellerId;
          }
        }
        
        // If not found by username and username was provided, try searching by Telegram ID from escrow
        if (!userStats && foundTelegramIdFromEscrow) {
          userStats = await UserStatsService.getUserStats({
            telegramId: foundTelegramIdFromEscrow,
            username: null
          });
        }
        
        // Always prioritize telegramId: from userStats first, then escrow, then target
        let finalTelegramId = null;
        if (userStats) {
          // Convert Mongoose document to plain object if needed
          const userStatsObj = userStats.toObject ? userStats.toObject() : userStats;
          // Get telegramId - User model should ALWAYS have it (required field)
          // Check both userStatsObj.telegramId and userStats.telegramId (in case toObject() loses it)
          const userTelegramId = userStatsObj.telegramId || userStats.telegramId;
          // Prioritize telegramId from User model (most reliable), then escrow, then target
          finalTelegramId = userTelegramId || foundTelegramIdFromEscrow || targetTelegramId;
          
          // Debug: Log if telegramId is missing (should never happen for User model)
          if (!userTelegramId && userStats) {
            console.log('WARNING: User found but telegramId is missing!', {
              hasTelegramId: !!userStatsObj.telegramId,
              hasUserStatsTelegramId: !!userStats.telegramId,
              username: userStatsObj.username,
              foundTelegramIdFromEscrow
            });
          }
          // CRITICAL: Force set telegramId to ensure it's always present
          userStatsObj.telegramId = finalTelegramId;
          userStats = userStatsObj;
        } else {
          // If still no stats found, create a default stats object with 0 trades
          finalTelegramId = foundTelegramIdFromEscrow || targetTelegramId;
          userStats = {
            telegramId: finalTelegramId || null,
            username: targetUsername || null,
            totalBoughtVolume: 0,
            totalSoldVolume: 0,
            totalTradedVolume: 0,
            totalBoughtTrades: 0,
            totalSoldTrades: 0,
            totalParticipatedTrades: 0,
            totalCompletedTrades: 0
          };
        }
        
        // CRITICAL: Final safety check - ensure telegramId is ALWAYS set and is a valid number
        if (userStats) {
          if (!userStats.telegramId || userStats.telegramId === null || userStats.telegramId === undefined) {
            if (finalTelegramId) {
              userStats.telegramId = finalTelegramId;
            }
          }
          // Ensure it's a number
          if (userStats.telegramId) {
            userStats.telegramId = Number(userStats.telegramId);
          }
        }
        
        const statsMessage = UserStatsService.formatStatsMessage(userStats);
        await ctx.reply(statsMessage, { parse_mode: 'HTML' });
      } catch (error) {
        console.error('Error in stats command:', error);
        ctx.reply('❌ Unable to fetch stats right now.');
      }
    });
    
    this.bot.command('leaderboard', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        
        if (chatId > 0) {
          return ctx.reply('❌ This command can only be used in a group chat.');
        }
        
        const topUsers = await UserStatsService.getLeaderboard(5);
        const leaderboardMessage = UserStatsService.formatLeaderboard(topUsers);
        await ctx.reply(leaderboardMessage, { parse_mode: 'HTML' });
      } catch (error) {
        console.error('Error in leaderboard command:', error);
        ctx.reply('❌ Unable to fetch leaderboard right now.');
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
      adminCleanupAddresses,
      adminGroupReset,
      adminResetForce,
      adminResetAllGroups
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
    this.bot.command('admin_cleanup_addresses', adminCleanupAddresses);
    this.bot.command('admin_group_reset', adminGroupReset);
    this.bot.command('admin_reset_force', adminResetForce);
    this.bot.command('admin_reset_all_groups', adminResetAllGroups);

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
