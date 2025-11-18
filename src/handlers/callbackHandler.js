const { Markup } = require('telegraf');
const { ethers } = require('ethers');
const Escrow = require('../models/Escrow');
const BlockchainService = require('../services/BlockchainService');
const AddressAssignmentService = require('../services/AddressAssignmentService');
const GroupPoolService = require('../services/GroupPoolService');
const GroupPool = require('../models/GroupPool');
const Contract = require('../models/Contract');
const config = require('../../config');
const escrowHandler = require('./escrowHandler');
const images = require('../config/images');

// Track scheduled group recycling timeouts to avoid duplicate timers
const groupRecyclingTimers = new Map();

async function scheduleGroupRecycling(escrowId, telegram) {
  if (!escrowId || !telegram) {
    return;
  }

  if (groupRecyclingTimers.has(escrowId)) {
    return; // Recycling already scheduled
  }

  const timeoutId = setTimeout(async () => {
    groupRecyclingTimers.delete(escrowId);
    try {
      const finalEscrow = await Escrow.findOne({ escrowId });
      if (!finalEscrow) {
        return;
      }

      const group = await GroupPool.findOne({
        assignedEscrowId: finalEscrow.escrowId
      });

      if (group) {
        const allUsersRemoved = await GroupPoolService.removeUsersFromGroup(finalEscrow, group.groupId, telegram);

        if (allUsersRemoved) {
          try {
            await GroupPoolService.refreshInviteLink(group.groupId, telegram);
          } catch (refreshError) {
            console.error('Error refreshing invite link during recycling:', refreshError);
          }

          group.status = 'available';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = null;
          await group.save();

          try {
            await telegram.sendMessage(
              finalEscrow.groupId,
              '✅ Group has been recycled and is ready for a new trade.'
            );
          } catch (sendError) {
            console.error('Error sending recycled notification:', sendError);
          }
        } else {
          group.status = 'completed';
          group.assignedEscrowId = null;
          group.assignedAt = null;
          group.completedAt = new Date();
          await group.save();

          try {
            await telegram.sendMessage(
              finalEscrow.groupId,
              '✅ Trade closed successfully! Both parties have confirmed. Note: Some users could not be removed from the group.'
            );
          } catch (sendError) {
            console.error('Error sending partial recycling notification:', sendError);
          }
        }
      } else {
        try {
          await telegram.sendMessage(
            finalEscrow.groupId,
            '✅ Trade closed successfully! Both parties have confirmed.'
          );
        } catch (sendError) {
          console.error('Error sending completion notification:', sendError);
        }
      }
    } catch (error) {
      console.error('Error recycling group after delay:', error);
    }
  }, 5 * 60 * 1000);

  groupRecyclingTimers.set(escrowId, timeoutId);
}

async function recycleGroupImmediately(escrow, telegram) {
  try {
    if (!escrow || !telegram) {
      return;
    }

    const group = await GroupPool.findOne({
      assignedEscrowId: escrow.escrowId
    });

    if (!group) {
      return;
    }

    const allUsersRemoved = await GroupPoolService.removeUsersFromGroup(escrow, group.groupId, telegram);

    if (allUsersRemoved) {
      try {
        await GroupPoolService.refreshInviteLink(group.groupId, telegram);
      } catch (refreshError) {
        console.error('Error refreshing invite link during immediate recycle:', refreshError);
      }

      group.status = 'available';
      group.assignedEscrowId = null;
      group.assignedAt = null;
      group.completedAt = null;
      await group.save();
    } else {
      group.status = 'completed';
      group.assignedEscrowId = null;
      group.assignedAt = null;
      group.completedAt = new Date();
      await group.save();
    }
  } catch (error) {
    console.error('Error during immediate group recycle:', error);
  }
}

async function announceAndScheduleRecycling(escrow, ctx, messageText) {
  if (!escrow || !ctx || !ctx.telegram) {
    return;
  }

  const announcement = messageText || '✅ Trade closed successfully! Group will be recycled in 5 minutes.';

  try {
    await ctx.telegram.sendMessage(escrow.groupId, announcement);
  } catch (sendError) {
    console.error('Error sending recycling announcement:', sendError);
  }

  await scheduleGroupRecycling(escrow.escrowId, ctx.telegram);
}

/**
 * Update the role selection message with current status
 */
async function updateRoleSelectionMessage(ctx, escrow) {
  if (!escrow.roleSelectionMessageId) {
    return; // No message to update
  }
  
  try {
    // Get participant usernames (from allowedUsernames or from escrow)
    let participants = [];
    if (escrow.allowedUsernames && escrow.allowedUsernames.length > 0) {
      participants = escrow.allowedUsernames;
    } else if (escrow.buyerUsername || escrow.sellerUsername) {
      if (escrow.buyerUsername) participants.push(escrow.buyerUsername);
      if (escrow.sellerUsername && escrow.sellerUsername !== escrow.buyerUsername) {
        participants.push(escrow.sellerUsername);
      }
    }
    
    // Build status lines
    const statusLines = [];
    for (const username of participants) {
      const isBuyer = escrow.buyerUsername && escrow.buyerUsername.toLowerCase() === username.toLowerCase();
      const isSeller = escrow.sellerUsername && escrow.sellerUsername.toLowerCase() === username.toLowerCase();
      
      if (isBuyer) {
        statusLines.push(`✅ @${username} - BUYER`);
      } else if (isSeller) {
        statusLines.push(`✅ @${username} - SELLER`);
      } else {
        statusLines.push(`⏳ @${username} - Waiting...`);
      }
    }
    
    // If no participants list, use buyer/seller info directly
    if (statusLines.length === 0) {
      if (escrow.buyerUsername) {
        statusLines.push(`✅ @${escrow.buyerUsername} - BUYER`);
      } else {
        statusLines.push(`⏳ Buyer - Waiting...`);
      }
      if (escrow.sellerUsername) {
        statusLines.push(`✅ @${escrow.sellerUsername} - SELLER`);
      } else {
        statusLines.push(`⏳ Seller - Waiting...`);
      }
    }
    
    const messageText = statusLines.join('\n');
    
    // Update the message (remove buttons if both roles are set)
    const replyMarkup = (escrow.buyerId && escrow.sellerId) ? undefined : {
      inline_keyboard: [
        [
          { text: '💰 I am Buyer', callback_data: 'select_role_buyer' },
          { text: '💵 I am Seller', callback_data: 'select_role_seller' }
        ]
      ]
    };
    
    // Role selection message is now a photo, so we need to edit the caption
    try {
      await ctx.telegram.editMessageCaption(
      escrow.groupId,
      escrow.roleSelectionMessageId,
      null,
      messageText,
      { reply_markup: replyMarkup }
    );
    } catch (editError) {
      const description = editError?.response?.description || editError?.message || '';
      if (description.includes('message is not modified')) {
        return; // Safe to ignore
      }
      throw editError;
    }
  } catch (error) {
    console.error('Error updating role selection message:', error);
    // Non-critical - continue execution
  }
}

module.exports = async (ctx) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // Handle different callback types
    if (callbackData === 'select_role_buyer' || callbackData === 'select_role_seller') {
      const isBuyer = callbackData === 'select_role_buyer';
      await ctx.answerCbQuery(isBuyer ? 'Buyer role selected' : 'Seller role selected');
      
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['draft', 'awaiting_details'] }
      });
      
      if (!escrow) {
        return ctx.reply('❌ No active escrow found.');
      }
      
      // Prevent same user from being both buyer and seller
      if (isBuyer && escrow.sellerId && escrow.sellerId === userId) {
        return ctx.answerCbQuery('❌ You cannot be both buyer and seller.');
      }
      if (!isBuyer && escrow.buyerId && escrow.buyerId === userId) {
        return ctx.answerCbQuery('❌ You cannot be both buyer and seller.');
      }
      
      // Assign role
      if (isBuyer) {
        if (escrow.buyerId && escrow.buyerId !== userId) {
          return ctx.answerCbQuery('❌ Buyer role already taken.');
        }
        escrow.buyerId = userId;
        escrow.buyerUsername = ctx.from.username;
      } else {
        if (escrow.sellerId && escrow.sellerId !== userId) {
          return ctx.answerCbQuery('❌ Seller role already taken.');
        }
        escrow.sellerId = userId;
        escrow.sellerUsername = ctx.from.username;
      }
      
      await escrow.save();
      
      // Update role selection message
      await updateRoleSelectionMessage(ctx, escrow);
      
      // If both roles are set, start step-by-step trade details process (if not already completed)
      if (escrow.buyerId && escrow.sellerId && escrow.roleSelectionMessageId) {
        // Note: Role selection message is kept permanently (not deleted)
        // Only Step 1-3 messages will be deleted after 5 minutes
        
        // Start step-by-step trade details process if not already completed
        if (!escrow.tradeDetailsStep || escrow.tradeDetailsStep !== 'completed') {
          escrow.tradeDetailsStep = 'step1_amount';
          const step1Msg = await ctx.telegram.sendPhoto(escrow.groupId, images.ENTER_QUANTITY, {
            caption: '💰 Step 1 - Enter USDT amount including fee → Example: 1000'
          });
          escrow.step1MessageId = step1Msg.message_id;
          await escrow.save();
          
        } else {
          // Trade details already set, show next instructions
          const buyerText = 'Now set /buyer address.\n\n📋 Example:\n• /buyer 0xabcdef1234567890abcdef1234567890abcdef12';
              await ctx.telegram.sendMessage(escrow.groupId, buyerText);
        }
      }
      
      return;
    } else if (callbackData === 'cancel_role_selection') {
      await ctx.answerCbQuery('Cancelled');
      return;
    } else if (callbackData === 'approve_deal_summary') {
      await ctx.answerCbQuery('Approving deal...');
      
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['draft', 'awaiting_details'] },
        dealSummaryMessageId: { $exists: true }
      });
      
      if (!escrow) {
        return ctx.reply('❌ No active deal summary found.');
      }
      
      const userId = ctx.from.id;
      const isBuyer = escrow.buyerId === userId;
      const isSeller = escrow.sellerId === userId;
      
      if (!isBuyer && !isSeller) {
        return ctx.answerCbQuery('❌ Only buyer or seller can approve.');
      }
      
      // Update approval status
      if (isBuyer) {
        escrow.buyerApproved = true;
      } else {
        escrow.sellerApproved = true;
      }
      await escrow.save();
      
      // Reload escrow to get latest state
      const updatedEscrow = await Escrow.findById(escrow._id);
      
      // Update deal summary message with approval status
      const buildDealSummary = async (escrow) => {
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
      };
      
      const summaryText = await buildDealSummary(updatedEscrow);
      const replyMarkup = (updatedEscrow.buyerApproved && updatedEscrow.sellerApproved) ? undefined : {
        inline_keyboard: [
          [{ text: 'Approve', callback_data: 'approve_deal_summary' }]
        ]
      };
      
      try {
        // Try editing as photo caption first (if it's a photo message)
        await ctx.telegram.editMessageCaption(
          updatedEscrow.groupId,
          updatedEscrow.dealSummaryMessageId,
          null,
          summaryText,
          { parse_mode: 'HTML', reply_markup: replyMarkup }
        );
      } catch (captionError) {
        // If that fails, try editing as text (if it's a text message)
      try {
        await ctx.telegram.editMessageText(
          updatedEscrow.groupId,
          updatedEscrow.dealSummaryMessageId,
          null,
          summaryText,
          { parse_mode: 'HTML', reply_markup: replyMarkup }
        );
        } catch (textError) {
          // If both fail, try sending new message with image
          try {
            await ctx.telegram.sendPhoto(updatedEscrow.groupId, images.CONFIRM_SUMMARY, {
              caption: summaryText,
              parse_mode: 'HTML',
              reply_markup: replyMarkup
            });
          } catch (sendErr) {
            console.error('Error updating deal summary:', textError);
          }
        }
      }
      
      // Check if both have approved
      if (updatedEscrow.buyerApproved && updatedEscrow.sellerApproved) {
        // Both approved - send DEAL CONFIRMED message
        const buyerTag = updatedEscrow.buyerUsername ? `@${updatedEscrow.buyerUsername}` : `[${updatedEscrow.buyerId}]`;
        const sellerTag = updatedEscrow.sellerUsername ? `@${updatedEscrow.sellerUsername}` : `[${updatedEscrow.sellerId}]`;
        const amount = updatedEscrow.quantity || 0;
        const rate = updatedEscrow.rate || 0;
        const paymentMethod = updatedEscrow.paymentMethod || 'N/A';
        const chain = updatedEscrow.chain || 'BSC';
        
        // Calculate fees
        const escrowFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
        const escrowFee = (amount * escrowFeePercent) / 100;
        const releaseAmount = amount - escrowFee;
        
        const confirmedText = `<b>P2P MM BOT 🤖</b>

<b>✅ DEAL CONFIRMED</b>

<b>Buyer:</b> ${buyerTag}
<b>Seller:</b> ${sellerTag}

<b>Deal Amount:</b> ${amount.toFixed(1)} ${updatedEscrow.token || 'USDT'}
<b> Fees:</b> ${escrowFee.toFixed(2)} ${updatedEscrow.token || 'USDT'}
<b>Release Amount:</b> ${releaseAmount.toFixed(2)} ${updatedEscrow.token || 'USDT'}
<b>Rate:</b> ₹${rate.toFixed(1)}
<b>Payment:</b> ${paymentMethod}
<b>Chain:</b> ${chain}

<b>Buyer Address:</b> <code>${updatedEscrow.buyerAddress}</code>
<b>Seller Address:</b> <code>${updatedEscrow.sellerAddress}</code>

🛑 <b>Do not send funds here</b> 🛑`;
        
        const confirmedMsg = await ctx.telegram.sendPhoto(updatedEscrow.groupId, images.DEAL_CONFIRMED, {
          caption: confirmedText,
          parse_mode: 'HTML'
        });
        
        // Pin the DEAL CONFIRMED message
        try {
          await ctx.telegram.pinChatMessage(updatedEscrow.groupId, confirmedMsg.message_id);
        } catch (pinErr) {
          console.error('Failed to pin message:', pinErr);
        }
        updatedEscrow.dealConfirmedMessageId = confirmedMsg.message_id;
        await updatedEscrow.save();
        
        // Generate deposit address and send deposit instructions
        try {
          const addressInfo = await AddressAssignmentService.assignDepositAddress(
            updatedEscrow.escrowId,
            updatedEscrow.token,
            updatedEscrow.chain,
            updatedEscrow.quantity,
            Number(config.ESCROW_FEE_PERCENT || 0)
          );
          
          updatedEscrow.depositAddress = addressInfo.address;
          updatedEscrow.uniqueDepositAddress = addressInfo.address;
          updatedEscrow.status = 'awaiting_deposit';
          await updatedEscrow.save();
          
          // Send deposit address message with SENT button
          // Use code tag to make address copyable (not clickable link)
          const tokenLabel = (updatedEscrow.token || 'USDT').toUpperCase();
          const chainLabel = (updatedEscrow.chain || 'BEP-20').toUpperCase();
          
          const depositAddressText = `💳 ${tokenLabel} ${chainLabel} Deposit

🏦 ${tokenLabel} ${chainLabel} Address: <code>${addressInfo.address}</code>

⚠️ Please Note:
• Double-check the address before sending.
• We are not responsible for any fake, incorrect, or unsupported tokens sent to this address.

Once you’ve sent the amount, tap the button below.`;

          await ctx.telegram.sendPhoto(updatedEscrow.groupId, images.DEPOSIT_ADDRESS, {
            caption: depositAddressText,
            parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
                [{ text: '✅ Payment Sent', callback_data: 'confirm_sent_deposit' }]
          ]
        }
      });
          
        } catch (depositErr) {
          console.error('Error generating deposit address:', depositErr);
          await ctx.telegram.sendMessage(updatedEscrow.groupId, '❌ Error generating deposit address. Please contact admin.');
        }
      }
      
      return;
    } else if (callbackData.startsWith('step4_select_chain_')) {
      // Step 4: Blockchain selection
      const chain = callbackData.replace('step4_select_chain_', '').toUpperCase();
      await ctx.answerCbQuery(`Selected ${chain}`);
      
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['draft', 'awaiting_details'] },
        tradeDetailsStep: 'step4_chain_coin'
      });
      
      if (!escrow) {
        return ctx.reply('❌ No active escrow found.');
      }
      
      // Only buyer or seller can select
      if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
        return ctx.answerCbQuery('❌ Only buyer or seller can select.');
      }
      
      escrow.chain = chain;
      await escrow.save();
      
      // Update blockchain selection message with tick mark
      if (escrow.step4ChainMessageId) {
        const chains = ['BSC'];
        const buttons = chains.map(c => ({ text: c === chain ? `✔ ${c}` : c, callback_data: `step4_select_chain_${c}` }));
        
        try {
          await ctx.telegram.editMessageReplyMarkup(
            escrow.groupId,
            escrow.step4ChainMessageId,
            null,
            {
              inline_keyboard: [buttons]
            }
          );
        } catch (err) {
          console.error('Error updating chain selection:', err);
        }
      }
      
      // Immediately show coin selection after chain is chosen
      const coins = ['USDT', 'USDC'];
      try {
        const coinMsg = await ctx.telegram.sendPhoto(escrow.groupId, images.SELECT_CRYPTO, {
          caption: '⚪ Select Coin',
          reply_markup: {
            inline_keyboard: [coins.map(c => ({ text: c, callback_data: `step4_select_coin_${c}` }))]
          }
        });
        escrow.step4CoinMessageId = coinMsg.message_id;
        await escrow.save();
        
      } catch (err) {
        console.error('Error sending coin selection:', err);
      }

      // Do not proceed to Step 5 until coin is selected
      
      return;
    } else if (callbackData.startsWith('step4_select_coin_')) {
      // Step 4: Coin selection
      const coin = callbackData.replace('step4_select_coin_', '').toUpperCase();
      await ctx.answerCbQuery(`Selected ${coin}`);
      
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['draft', 'awaiting_details'] },
        tradeDetailsStep: 'step4_chain_coin'
      });
      
      if (!escrow) {
        return ctx.reply('❌ No active escrow found.');
      }
      
      // Only buyer or seller can select
      if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
        return ctx.answerCbQuery('❌ Only buyer or seller can select.');
      }
      
      escrow.token = coin;
      await escrow.save();
      
      // Update coin selection message with tick mark
      if (escrow.step4CoinMessageId) {
        const coins = ['USDT', 'USDC'];
        const buttons = coins.map(c => {
          const text = c === coin ? `✔ ${c}` : c;
          return { text, callback_data: `step4_select_coin_${c}` };
        });
        
        try {
          await ctx.telegram.editMessageReplyMarkup(
            escrow.groupId,
            escrow.step4CoinMessageId,
            null,
            {
              inline_keyboard: [buttons]
            }
          );
        } catch (err) {
          console.error('Error updating coin selection:', err);
        }
      }
      
      // Check if both chain and coin are selected (only show Step 5 once)
      // Reload escrow to get latest state (in case chain was just selected)
      const updatedEscrow = await Escrow.findById(escrow._id);
      if (updatedEscrow.chain && updatedEscrow.token && updatedEscrow.tradeDetailsStep === 'step4_chain_coin') {
        updatedEscrow.tradeDetailsStep = 'step5_buyer_address';
        updatedEscrow.status = 'draft';
        await updatedEscrow.save();
        
        // Step 5: Ask buyer for their wallet address
        const buyerUsername = updatedEscrow.buyerUsername ? `@${updatedEscrow.buyerUsername}` : 'Buyer';
        const chainName = updatedEscrow.chain || 'BSC';
        const telegram = ctx.telegram;
        const groupId = updatedEscrow.groupId;
        
        const step5Msg = await telegram.sendPhoto(
          groupId,
          images.ENTER_ADDRESS,
          {
            caption: `💰 Step 5 - ${buyerUsername}, enter your ${chainName} wallet address starts with 0x and is 42 chars (0x + 40 hex).`
          }
        );
        updatedEscrow.step5BuyerAddressMessageId = step5Msg.message_id;
        await updatedEscrow.save();
      }
      
      return;
    } else if (callbackData.startsWith('close_trade_')) {
      await ctx.answerCbQuery('Closing trade...');
      const escrowId = callbackData.split('_')[2];
      const escrow = await Escrow.findOne({ escrowId });
      
      if (!escrow) {
        return ctx.answerCbQuery('❌ Escrow not found.');
      }

      // Check if user is buyer, seller, or admin
      const isBuyer = escrow.buyerId === userId;
      const isSeller = escrow.sellerId === userId;
      const isAdmin = config.getAllAdminUsernames().includes(ctx.from.username) ||
                      config.getAllAdminIds().includes(String(userId));
      
      if (!isBuyer && !isSeller && !isAdmin) {
        return ctx.answerCbQuery('❌ Only buyer, seller, or admin can close this trade.');
      }

      // Check if trade is completed or refunded
      if (escrow.status !== 'completed' && escrow.status !== 'refunded') {
        return ctx.answerCbQuery('❌ Trade must be completed or refunded before closing.');
      }

      // Unpin the deal confirmed message
      if (escrow.dealConfirmedMessageId) {
        try {
          await ctx.telegram.unpinChatMessage(escrow.groupId, escrow.dealConfirmedMessageId);
        } catch (_) {}
        escrow.dealConfirmedMessageId = undefined;
      await escrow.save();
      }
      
      // Immediately recycle the group (single click from anyone)
      await recycleGroupImmediately(escrow, ctx.telegram);
      
      try {
              await ctx.telegram.sendMessage(
          escrow.groupId,
          '✅ Trade closed successfully! Group has been recycled and is ready for the next deal.'
        );
      } catch (notifyError) {
        console.error('Error notifying group recycle completion:', notifyError);
      }
      
      return;
    } else if (callbackData === 'confirm_sent_deposit') {
      await ctx.answerCbQuery('Processing...');
      
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['awaiting_deposit', 'deposited'] }
      });
      
      if (!escrow || !escrow.depositAddress) {
        return ctx.answerCbQuery('❌ No active deposit address found.');
      }
      
      // Check if seller clicked the button
      const userId = ctx.from.id;
      if (escrow.sellerId !== userId) {
        return ctx.answerCbQuery('❌ Only the seller can click SENT button.');
      }
      
      // Ask seller to paste transaction hash or explorer link
      const sellerUsername = escrow.sellerUsername ? `@${escrow.sellerUsername}` : 'Seller';
      const askTxMsg = await ctx.telegram.sendMessage(
        escrow.groupId,
        `✉️ ${sellerUsername} kindly paste the transaction hash or explorer link.`
      );
      escrow.transactionHashMessageId = askTxMsg.message_id;
      await escrow.save();
      
      return;
    } else if (callbackData === 'check_deposit') {
      await ctx.answerCbQuery('Checking for your deposit...');
      const chatId = ctx.chat.id;
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['awaiting_deposit', 'deposited'] }
      });
      if (!escrow || !escrow.depositAddress) {
        return ctx.reply('❌ No active deposit address found.');
      }
      
        if (!escrow.depositAddress) {
        return ctx.reply('❌ Deposit address missing.');
      }
      
      const checkAddress = escrow.depositAddress;

      // On-chain first: query RPC logs, then fallback to explorer
      // Start from 0 if no previous check, or we can use escrow's last checked block field
      const lastCheckedBlock = escrow.lastCheckedBlock || 0;
      let txs = await BlockchainService.getTokenTransfersViaRPC(escrow.token, escrow.chain, checkAddress, lastCheckedBlock);
      if (!txs || txs.length === 0) {
        txs = await BlockchainService.getTokenTransactions(escrow.token, escrow.chain, checkAddress);
      }
      
      const sellerAddr = (escrow.sellerAddress || '').toLowerCase();
      const vaultAddr = checkAddress.toLowerCase();
      
      // Only count new deposits since the last check - filter for deposits TO the vault
      const newDeposits = (txs || []).filter(tx => {
        const from = (tx.from || '').toLowerCase();
        const to = (tx.to || '').toLowerCase();
        // Accept deposit if it's to the vault address
        // If seller address is set, optionally filter by sender (but allow any sender for now)
        return to === vaultAddr;
      });
      
      const newAmount = newDeposits.reduce((sum, tx) => sum + Number(tx.valueDecimal || 0), 0);
      const previousAmount = escrow.depositAmount || 0;
      const totalAmount = previousAmount + newAmount;

      if (newAmount > 0) {
        // Track last checked block from RPC
        try {
          const latest = await BlockchainService.getLatestBlockNumber(escrow.chain);
          if (latest) escrow.lastCheckedBlock = latest;
        } catch {}
        
        escrow.depositAmount = totalAmount;
        escrow.confirmedAmount = totalAmount;
        escrow.status = 'deposited';
        await escrow.save();
        
        
        await ctx.reply(`✅ Deposit confirmed: ${newAmount.toFixed(2)} ${escrow.token}`);

        // Begin fiat transfer handshake
        // Ask buyer to confirm they've sent the fiat payment
        if (escrow.buyerId) {
          await ctx.telegram.sendMessage(
            escrow.groupId,
            `💸 Buyer ${escrow.buyerUsername ? '@' + escrow.buyerUsername : '[' + escrow.buyerId + ']'}: Please send the agreed fiat amount to the seller via your agreed method and confirm below.`,
            {
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('✅ I have sent the money', `fiat_sent_buyer_${escrow.escrowId}`)]
              ]).reply_markup
            }
          );
        }
      } else {
        await ctx.reply('❌ No new deposit found yet. Please try again in a moment.');
      }
    } else if (callbackData.startsWith('fiat_sent_buyer_')) {
      try {
        // Extract escrowId - handle cases where escrowId might have underscores
        const escrowId = callbackData.replace('fiat_sent_buyer_', '');
        
      // Only buyer can click
      const escrow = await Escrow.findOne({
        escrowId: escrowId,
        status: { $in: ['deposited', 'in_fiat_transfer'] }
      });
        
        
        if (!escrow) {
          await ctx.answerCbQuery('❌ No active escrow found.');
          console.log('❌ Escrow not found for:', escrowId);
          return;
        }
        
        if (escrow.buyerId !== userId) {
          await ctx.answerCbQuery('❌ Only the buyer can confirm this.');
          return;
        }

      escrow.buyerSentFiat = true;
      escrow.status = 'in_fiat_transfer';
      await escrow.save();

      await ctx.answerCbQuery('✅ Noted.');
        
        // Ask seller to confirm receipt - send to the group using groupId
        const sellerPrompt = await ctx.telegram.sendMessage(
          escrow.groupId,
        `🏦 Seller ${escrow.sellerUsername ? '@' + escrow.sellerUsername : '[' + escrow.sellerId + ']'}: Did you receive the fiat payment?`,
        {
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Yes, I received', `fiat_received_seller_yes_${escrow.escrowId}`),
              Markup.button.callback('❌ No, not received', `fiat_received_seller_no_${escrow.escrowId}`)
            ],
            [
              Markup.button.callback('⚠️ Received less money', `fiat_received_seller_partial_${escrow.escrowId}`)
            ]
          ]).reply_markup
        }
      );
        
      } catch (error) {
        console.error('❌ Error in fiat_sent_buyer handler:', error);
        await ctx.answerCbQuery('❌ An error occurred. Please try again.');
      }

    } else if (callbackData.startsWith('fiat_received_seller_partial_')) {
      const escrowId = callbackData.replace('fiat_received_seller_partial_', '');
      await ctx.answerCbQuery('⚠️ Partial payment noted');
      
      const escrow = await Escrow.findOne({
        escrowId: escrowId,
        status: { $in: ['in_fiat_transfer', 'deposited'] }
      });
      
      if (escrow) {
        try {
          const admins = (config.getAllAdminUsernames?.() || []).filter(Boolean);
          const adminMentions = admins.length ? admins.map(u => `@${u}`).join(' ') : 'Admin';
          await ctx.telegram.sendMessage(
            escrow.groupId,
            `⚠️ Seller reported partial fiat payment for escrow ${escrowId}. ${adminMentions} please review and resolve.`
          );
        } catch (e) {
          console.error('Error sending admin notification:', e);
        }
      }
      return;

    } else if (callbackData.startsWith('buyer_received_tokens_yes_') || callbackData.startsWith('buyer_received_tokens_no_')) {
      // Buyer confirmation for token receipt
      const escrowId = callbackData.includes('_yes_') 
        ? callbackData.replace('buyer_received_tokens_yes_', '')
        : callbackData.replace('buyer_received_tokens_no_', '');
      
      const escrow = await Escrow.findOne({
        escrowId: escrowId,
        status: 'completed'
      });
      
      if (!escrow) {
        await ctx.answerCbQuery('❌ No active escrow found.');
        return;
      }
      
      if (escrow.buyerId !== userId) {
        await ctx.answerCbQuery('❌ Only the buyer can confirm this.');
        return;
      }
      
      const isYes = callbackData.includes('_yes_');
      
      if (isYes) {
        await ctx.answerCbQuery('✅ Confirmed receipt of tokens.');
        await announceAndScheduleRecycling(
          escrow,
          ctx,
          '✅ Buyer confirmed receipt of tokens. Trade completed successfully! Group will be recycled in 5 minutes.'
        );
      } else {
        await ctx.answerCbQuery('⚠️ Issue reported.');
        const admins = (config.getAllAdminUsernames?.() || []).filter(Boolean);
        const adminMentions = admins.length ? admins.map(u => `@${u}`).join(' ') : 'Admin';
        await ctx.telegram.sendMessage(
          escrow.groupId,
          `⚠️ Buyer reported not receiving tokens for escrow ${escrowId}. Transaction hash: ${escrow.releaseTransactionHash || 'N/A'}. ${adminMentions} please review.`
        );
      }
      return;

    } else if (callbackData.startsWith('fiat_received_seller_yes_') || callbackData.startsWith('fiat_received_seller_no_')) {
      // Extract escrowId - handle both yes and no cases
      const escrowId = callbackData.includes('_yes_') 
        ? callbackData.replace('fiat_received_seller_yes_', '')
        : callbackData.replace('fiat_received_seller_no_', '');
      // Only seller can click
      const escrow = await Escrow.findOne({
        escrowId: escrowId,
        status: { $in: ['in_fiat_transfer', 'deposited'] }
      });
      if (!escrow) {
        await ctx.answerCbQuery('❌ No active escrow found.');
        return;
      }
      
      if (escrow.sellerId !== userId) {
        await ctx.answerCbQuery('❌ Only the seller can confirm this.');
        return;
      }

      const isYes = callbackData.includes('_yes_');
      if (!isYes) {
        escrow.sellerReceivedFiat = false;
        await escrow.save();
        
        await ctx.answerCbQuery('❌ Marked as not received');
        
        // Notify admins
        try {
          const admins = (config.getAllAdminUsernames?.() || []).filter(Boolean);
          const adminMentions = admins.length ? admins.map(u => `@${u}`).join(' ') : 'Admin';
          await ctx.telegram.sendMessage(
            escrow.groupId,
            `🚨 Seller reported no fiat received for escrow ${escrowId}. ${adminMentions} please review and resolve.`
          );
        } catch (e) {
          console.error('Error sending admin notification:', e);
        }
        return;
      }

      // Step 1: seller selected full amount; ask for final confirmation in the same message
      escrow.sellerReceivedFiat = true;
      await escrow.save();
      await ctx.answerCbQuery('✅ Full amount selected');
      try {
        await ctx.editMessageText(
          '✅ Seller reported full amount received. Confirm to complete the trade and release funds to the buyer.',
          {
            reply_markup: Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Confirm release', `fiat_release_confirm_${escrow.escrowId}`),
                Markup.button.callback('❌ Cancel', `fiat_release_cancel_${escrow.escrowId}`)
              ]
            ]).reply_markup
          }
        );
      } catch (e) {
        const confirmMsg = await ctx.reply(
          '✅ Seller reported full amount received. Confirm to complete the trade and release funds to the buyer.',
          {
            reply_markup: Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Confirm release', `fiat_release_confirm_${escrow.escrowId}`),
                Markup.button.callback('❌ Cancel', `fiat_release_cancel_${escrow.escrowId}`)
              ]
            ]).reply_markup
          }
        );
      }

    } else if (callbackData.startsWith('release_confirm_no_')) {
      const escrowId = callbackData.replace('release_confirm_no_', '');
      const escrow = await Escrow.findOne({
        escrowId,
        status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
      });
      
      if (!escrow) {
        return ctx.answerCbQuery('❌ No active escrow found.');
      }
      
      const userId = ctx.from.id;
      const isBuyer = Number(escrow.buyerId) === Number(userId);
      const isSeller = Number(escrow.sellerId) === Number(userId);
      const isAdmin = config.getAllAdminUsernames().includes(ctx.from.username) ||
                      config.getAllAdminIds().includes(String(userId));
      
      if (!isBuyer && !isSeller && !isAdmin) {
        return ctx.answerCbQuery('❌ Only buyer, seller, or admin can decline.');
      }
      
      // Reset confirmations
      escrow.buyerConfirmedRelease = false;
      escrow.sellerConfirmedRelease = false;
      await escrow.save();
      
      await ctx.answerCbQuery('❎ Release cancelled');
      try {
        await ctx.editMessageCaption(
          escrow.groupId,
          escrow.releaseConfirmationMessageId,
          null,
          '❎ Release cancelled. No action taken.',
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        try {
          await ctx.editMessageText('❎ Release cancelled. No action taken.');
        } catch (e2) {}
      }
      return;
    } else if (callbackData.startsWith('release_confirm_yes_')) {
      const escrowId = callbackData.replace('release_confirm_yes_', '');
      const escrow = await Escrow.findOne({
        escrowId,
        status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
      });
      
      if (!escrow) {
        return ctx.answerCbQuery('❌ No active escrow found.');
      }
      
      const userId = ctx.from.id;
      const isBuyer = Number(escrow.buyerId) === Number(userId);
      const isSeller = Number(escrow.sellerId) === Number(userId);
      const isAdmin = config.getAllAdminUsernames().includes(ctx.from.username) ||
                      config.getAllAdminIds().includes(String(userId));
      
      if (!isBuyer && !isSeller && !isAdmin) {
        return ctx.answerCbQuery('❌ Only buyer, seller, or admin can approve release.');
      }
      
      // Update confirmation status
      if (isBuyer) {
        escrow.buyerConfirmedRelease = true;
      }
      if (isSeller) {
        escrow.sellerConfirmedRelease = true;
      }
      // If admin is neither buyer nor seller, they can approve on behalf of both
      if (isAdmin && !isBuyer && !isSeller) {
        escrow.buyerConfirmedRelease = true;
        escrow.sellerConfirmedRelease = true;
      }
      await escrow.save();

      // Reload to get latest state
      const updatedEscrow = await Escrow.findById(escrow._id);
      
      // Update message with current confirmation status
      const buyerLabel = updatedEscrow.buyerUsername
        ? `@${updatedEscrow.buyerUsername}`
        : updatedEscrow.buyerId
          ? `[${updatedEscrow.buyerId}]`
          : 'the buyer';
      const sellerLabel = updatedEscrow.sellerUsername
        ? `@${updatedEscrow.sellerUsername}`
        : updatedEscrow.sellerId
          ? `[${updatedEscrow.sellerId}]`
          : 'the seller';
      
      const buyerLine = updatedEscrow.buyerConfirmedRelease
        ? `✅ ${buyerLabel} - Confirmed`
        : `⌛️ ${buyerLabel} - Waiting...`;
      const sellerLine = updatedEscrow.sellerConfirmedRelease
        ? `✅ ${sellerLabel} - Confirmed`
        : `⌛️ ${sellerLabel} - Waiting...`;
      
      const releaseCaption = `<b>Release Confirmation</b>

${buyerLine}
${sellerLine}

Both users must approve to release payment.`;
      
      // Update the message
      if (updatedEscrow.releaseConfirmationMessageId) {
        try {
          await ctx.telegram.editMessageCaption(
            updatedEscrow.groupId,
            updatedEscrow.releaseConfirmationMessageId,
            null,
            releaseCaption,
            {
              parse_mode: 'HTML',
              reply_markup: (updatedEscrow.buyerConfirmedRelease && updatedEscrow.sellerConfirmedRelease) ? undefined : {
                inline_keyboard: [
                  [
                    Markup.button.callback('✅ Approve', `release_confirm_yes_${updatedEscrow.escrowId}`),
                    Markup.button.callback('❌ Decline', `release_confirm_no_${updatedEscrow.escrowId}`)
                  ]
                ]
              }
            }
          );
        } catch (e) {
          console.error('Error updating release confirmation message:', e);
        }
      }
      
      // Give feedback to user
      if (updatedEscrow.buyerConfirmedRelease && updatedEscrow.sellerConfirmedRelease) {
        await ctx.answerCbQuery('✅ Both parties approved. Processing release...');
      } else {
        await ctx.answerCbQuery('✅ Your approval has been recorded. Waiting for the other party...');
      }
      
      // Check if both have confirmed
      if (updatedEscrow.buyerConfirmedRelease && updatedEscrow.sellerConfirmedRelease) {
        const decimals = BlockchainService.getTokenDecimals(updatedEscrow.token, updatedEscrow.chain);
        const amountWeiOverride = updatedEscrow.accumulatedDepositAmountWei && updatedEscrow.accumulatedDepositAmountWei !== '0'
          ? updatedEscrow.accumulatedDepositAmountWei
          : null;
        let amount = Number(
          updatedEscrow.accumulatedDepositAmount ||
          updatedEscrow.depositAmount ||
          updatedEscrow.confirmedAmount ||
          0
        );
        if (amountWeiOverride) {
          amount = Number(ethers.formatUnits(BigInt(amountWeiOverride), decimals));
        }
        if (!updatedEscrow.buyerAddress || amount <= 0) {
          return ctx.answerCbQuery('❌ Cannot release funds: missing buyer address or zero amount.');
        }
        
        try {
          const releaseResult = await BlockchainService.releaseFunds(
            updatedEscrow.token,
            updatedEscrow.chain,
            updatedEscrow.buyerAddress,
            amount,
            amountWeiOverride
          );
          
          if (!releaseResult || !releaseResult.success) {
            throw new Error('Release transaction failed - no result returned');
          }
          
          if (releaseResult.transactionHash) {
            updatedEscrow.releaseTransactionHash = releaseResult.transactionHash;
          }
          updatedEscrow.status = 'completed';
          updatedEscrow.buyerClosedTrade = false;
          updatedEscrow.sellerClosedTrade = false;
          await updatedEscrow.save();
          
          const tradeStart = updatedEscrow.tradeStartTime || updatedEscrow.createdAt || new Date();
          const minutesTaken = Math.max(
            1,
            Math.round((Date.now() - new Date(tradeStart)) / (60 * 1000))
          );
          
          const chainUpper = (updatedEscrow.chain || '').toUpperCase();
          let explorerUrl = '';
          if (releaseResult.transactionHash) {
            if (chainUpper === 'BSC' || chainUpper === 'BNB') {
              explorerUrl = `https://bscscan.com/tx/${releaseResult.transactionHash}`;
            } else if (chainUpper === 'ETH' || chainUpper === 'ETHEREUM') {
              explorerUrl = `https://etherscan.io/tx/${releaseResult.transactionHash}`;
            } else if (chainUpper === 'POLYGON' || chainUpper === 'MATIC') {
              explorerUrl = `https://polygonscan.com/tx/${releaseResult.transactionHash}`;
            }
          }
          
          const linkLine = releaseResult?.transactionHash
            ? explorerUrl
              ? `<a href="${explorerUrl}">Click Here</a>`
              : `<code>${releaseResult.transactionHash}</code>`
            : 'Not available';
          
          const completionText = `🎉 <b>Deal Complete!</b> ✅

⏱️ <b>Time Taken:</b> ${minutesTaken} mins
🔗 <b>Release TX Link:</b> ${linkLine}

Thank you for using our safe escrow system.`;
          
          const closeTradeKeyboard = {
              inline_keyboard: [
                [
                  {
                  text: '❌ Close Deal',
                  callback_data: `close_trade_${updatedEscrow.escrowId}`
                }
              ]
            ]
          };
        
          let summaryMsg;
          try {
            summaryMsg = await ctx.telegram.sendPhoto(
              updatedEscrow.groupId,
              images.DEAL_COMPLETE,
            {
              caption: completionText,
              parse_mode: 'HTML',
              reply_markup: closeTradeKeyboard
            }
          );
          } catch (sendError) {
            console.error('Error sending completion summary:', sendError);
            summaryMsg = await ctx.replyWithPhoto(images.DEAL_COMPLETE, {
              caption: completionText,
              parse_mode: 'HTML',
              reply_markup: closeTradeKeyboard
            });
          }
          
          if (summaryMsg) {
            updatedEscrow.closeTradeMessageId = summaryMsg.message_id;
            await updatedEscrow.save();
          }
          
          try {
            await ctx.editMessageCaption(
              updatedEscrow.groupId,
              updatedEscrow.releaseConfirmationMessageId,
              null,
              '✅ Release completed.',
              { parse_mode: 'HTML' }
            );
          } catch (e) {
            try {
              await ctx.editMessageText('✅ Release completed.');
            } catch (e2) {}
          }
        } catch (error) {
          console.error('Error releasing funds via confirmation:', error);
          try {
            await ctx.editMessageText('❌ Release failed. Please try again or contact support.');
          } catch (e) {}
          await ctx.answerCbQuery('❌ Release failed');
          return;
        }
      }
      
      return;
    } else if (callbackData.startsWith('partial_continue_')) {
      const escrowId = callbackData.replace('partial_continue_', '');
      const escrow = await Escrow.findOne({
        escrowId,
        status: { $in: ['awaiting_deposit', 'deposited'] }
      });
      
      if (!escrow) {
        return ctx.answerCbQuery('❌ No active escrow found.');
      }
      
      // Only seller can click
      if (escrow.sellerId !== userId) {
        return ctx.answerCbQuery('❌ Only the seller can choose this option.');
      }
      
      await ctx.answerCbQuery('✅ Continuing with partial amount...');
      
      // Update escrow to proceed with partial amount
      const partialAmount = escrow.accumulatedDepositAmount || escrow.depositAmount || 0;
      escrow.confirmedAmount = partialAmount;
      escrow.depositAmount = partialAmount;
      escrow.status = 'deposited';
        await escrow.save();
      
      // Delete the transaction hash message if it exists
      try {
        if (escrow.transactionHashMessageId) {
          await ctx.telegram.deleteMessage(escrow.groupId, escrow.transactionHashMessageId);
        }
      } catch (e) {}
      
      // Update partial payment message
      try {
        if (escrow.partialPaymentMessageId) {
          await ctx.editMessageText('✅ Continuing with partial amount. Trade will proceed with the received amount.');
        }
      } catch (e) {}
      
      // Send deposit confirmation message
      const txHashShort = escrow.transactionHash ? escrow.transactionHash.substring(0, 10) + '...' : 'N/A';
      const totalTxCount = 1 + (escrow.partialTransactionHashes ? escrow.partialTransactionHashes.length : 0);
      const fromAddress = escrow.depositTransactionFromAddress || 'N/A';
      const depositAddress = escrow.depositAddress || 'N/A';
      
      let confirmedTxText = `<b>P2P MM Bot 🤖</b>

🟢 Partial ${escrow.token} accepted

<b>Total Amount:</b> ${partialAmount.toFixed(2)} ${escrow.token}
<b>Transactions:</b> ${totalTxCount} transaction(s)
<b>From:</b> <code>${fromAddress}</code>
<b>To:</b> <code>${depositAddress}</code>
<b>Main Tx:</b> <code>${txHashShort}</code>`;
      
      if (totalTxCount > 1) {
        confirmedTxText += `\n\n✅ Amount received through ${totalTxCount} transaction(s)`;
      }
      
      const txDetailsMsg = await ctx.telegram.sendPhoto(
        escrow.groupId,
        images.DEPOSIT_FOUND,
        {
          caption: confirmedTxText,
          parse_mode: 'HTML'
        }
      );
      
      escrow.transactionHashMessageId = txDetailsMsg.message_id;
      await escrow.save();
      
      // Send buyer instruction
      if (escrow.buyerId) {
        const buyerMention = escrow.buyerUsername
          ? `@${escrow.buyerUsername}`
          : escrow.buyerId
            ? `[${escrow.buyerId}]`
            : 'Buyer';

        const buyerInstruction = `✅ Payment Received!

Use /release After Fund Transfer to Seller

⚠️ Please note:
• Don't share payment details on private chat
• Please share all deals in group`;

        await ctx.telegram.sendMessage(escrow.groupId, buyerInstruction);
      }
      
      return;
    } else if (callbackData.startsWith('partial_pay_remaining_')) {
      const escrowId = callbackData.replace('partial_pay_remaining_', '');
      const escrow = await Escrow.findOne({
        escrowId,
        status: { $in: ['awaiting_deposit', 'deposited'] }
      });
      
      if (!escrow) {
        return ctx.answerCbQuery('❌ No active escrow found.');
      }
      
      // Only seller can click
      if (escrow.sellerId !== userId) {
        return ctx.answerCbQuery('❌ Only the seller can choose this option.');
      }
      
      await ctx.answerCbQuery('💰 Please send the remaining amount...');
      
      // Ensure status is 'awaiting_deposit' so next transaction hash can be processed
      escrow.status = 'awaiting_deposit';
      await escrow.save();
      
      // Calculate remaining amount
      const expectedAmount = escrow.quantity || 0;
      const currentAmount = escrow.accumulatedDepositAmount || escrow.depositAmount || 0;
      const remainingAmount = expectedAmount - currentAmount;
      const remainingFormatted = remainingAmount.toFixed(2);
      
      // Update message to show seller should send remaining amount
      try {
        if (escrow.partialPaymentMessageId) {
          await ctx.editMessageText(
            `✅ Partial deposit received: ${currentAmount.toFixed(2)} ${escrow.token}\n\n` +
            `📊 Total received so far: ${currentAmount.toFixed(2)} ${escrow.token}\n` +
            `💰 Remaining amount needed: ${remainingFormatted} ${escrow.token}\n\n` +
            `Please send the remaining ${remainingFormatted} ${escrow.token} to the same deposit address:\n` +
            `<code>${escrow.depositAddress}</code>\n\n` +
            `After sending, provide the new transaction hash.`,
            { parse_mode: 'HTML' }
          );
        }
      } catch (e) {
        // If editing fails, send a new message
        await ctx.reply(
          `💰 Please send the remaining ${remainingFormatted} ${escrow.token} to:\n` +
          `<code>${escrow.depositAddress}</code>\n\n` +
          `After sending, provide the new transaction hash.`,
          { parse_mode: 'HTML' }
        );
      }
      
      return;
    } else if (callbackData.startsWith('fiat_release_cancel_')) {
      await ctx.answerCbQuery('❎ Cancelled');
      try { await ctx.editMessageText('❎ Release cancelled. No action taken.'); } catch (e) {}
      return;
    } else if (callbackData.startsWith('fiat_release_confirm_')) {
      const escrowId = callbackData.replace('fiat_release_confirm_', '');
      const escrow = await Escrow.findOne({
        escrowId,
        status: { $in: ['in_fiat_transfer', 'deposited', 'ready_to_release'] }
      });
      if (!escrow) return ctx.answerCbQuery('❌ No active escrow found.');
      if (escrow.sellerId !== userId) return ctx.answerCbQuery('❌ Only the seller can confirm release.');
      const decimals = BlockchainService.getTokenDecimals(escrow.token, escrow.chain);
      const amountWeiOverride = escrow.accumulatedDepositAmountWei && escrow.accumulatedDepositAmountWei !== '0'
        ? escrow.accumulatedDepositAmountWei
        : null;
      let amount = Number(
        escrow.accumulatedDepositAmount ||
        escrow.depositAmount ||
        escrow.confirmedAmount ||
        0
      );
      if (amountWeiOverride) {
        amount = Number(ethers.formatUnits(BigInt(amountWeiOverride), decimals));
      }
      if (!escrow.buyerAddress || amount <= 0) {
        return ctx.reply('⚠️ Cannot proceed: missing buyer address or zero amount.');
      }
      await ctx.answerCbQuery('🚀 Releasing...');
      try { await ctx.editMessageText('🚀 Releasing funds to the buyer...'); } catch (e) {}
      try {
        const releaseResult = await BlockchainService.releaseFunds(
          escrow.token,
          escrow.chain,
          escrow.buyerAddress,
          amount,
          amountWeiOverride
        );
        escrow.status = 'completed';
        if (releaseResult && releaseResult.transactionHash) {
          escrow.releaseTransactionHash = releaseResult.transactionHash;
        }
        await escrow.save();

        // Send release confirmation message
        await ctx.replyWithPhoto(images.RELEASE_CONFIRMATION, {
          caption: `✅ ${(amount - 0).toFixed(5)} ${escrow.token} released to buyer's address. Trade completed.`
        });
        
        // Send transaction explorer link if available
        if (releaseResult && releaseResult.transactionHash) {
          const chain = escrow.chain || 'BSC';
          let explorerUrl = '';
          if (chain.toUpperCase() === 'BSC' || chain.toUpperCase() === 'BNB') {
            explorerUrl = `https://bscscan.com/tx/${releaseResult.transactionHash}`;
          } else if (chain.toUpperCase() === 'ETH' || chain.toUpperCase() === 'ETHEREUM') {
            explorerUrl = `https://etherscan.io/tx/${releaseResult.transactionHash}`;
          } else if (chain.toUpperCase() === 'POLYGON' || chain.toUpperCase() === 'MATIC') {
            explorerUrl = `https://polygonscan.com/tx/${releaseResult.transactionHash}`;
          }
          
          if (explorerUrl) {
            await ctx.reply(`🔗 Transaction: ${explorerUrl}`);
          }
        }
        
        // Ask buyer to confirm receipt of tokens
        const buyerConfirmationMsg = await ctx.telegram.sendMessage(
          escrow.groupId,
          `👤 Buyer ${escrow.buyerUsername ? '@' + escrow.buyerUsername : '[' + escrow.buyerId + ']'}: Did you receive the tokens?`,
          {
            reply_markup: Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Yes, I received', `buyer_received_tokens_yes_${escrow.escrowId}`),
                Markup.button.callback('❌ No, not received', `buyer_received_tokens_no_${escrow.escrowId}`)
              ]
            ]).reply_markup
          }
        );
        
        
        // Note: Group recycling will happen after buyer confirms receipt and both parties close the trade
        // This is handled in the close_trade callback with a 5-minute delay
      } catch (error) {
        console.error('Auto-release error:', error);
        await ctx.reply('❌ Error releasing funds. Please contact admin.');
        // Don't recycle group if release failed
        return;
      }
      return;
    } else if (callbackData.startsWith('confirm_')) {
      const [, action, role, amount] = callbackData.split('_');
      
      // Find active escrow
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
      });

      if (!escrow) {
        return ctx.answerCbQuery('❌ No active escrow found.');
      }

      // Check if user is authorized
      if (role === 'buyer' && escrow.buyerId !== userId) {
        return ctx.answerCbQuery('❌ Only the buyer can confirm this action.');
      }
      if (role === 'seller' && escrow.sellerId !== userId) {
        return ctx.answerCbQuery('❌ Only the seller can confirm this action.');
      }

      // Only release is supported (refunds require seller address which is no longer set)
      if (action === 'refund') {
        return ctx.answerCbQuery('❌ Refund functionality requires seller address. Please contact admin for refunds.');
      }

      // Update confirmation status (only for release)
      if (action === 'release') {
        if (role === 'buyer') {
          escrow.buyerConfirmedRelease = true;
        } else {
          escrow.sellerConfirmedRelease = true;
        }
      }

      await escrow.save();

      // Check if both parties confirmed (only for release)
      const bothConfirmed = action === 'release' && escrow.buyerConfirmedRelease && escrow.sellerConfirmedRelease;

      if (bothConfirmed) {
        // Execute the transaction
        const decimals = BlockchainService.getTokenDecimals(escrow.token, escrow.chain);
        const amountWeiOverride = escrow.accumulatedDepositAmountWei && escrow.accumulatedDepositAmountWei !== '0'
          ? escrow.accumulatedDepositAmountWei
          : null;
        const actualAmount = amountWeiOverride
          ? Number(ethers.formatUnits(BigInt(amountWeiOverride), decimals))
          : parseFloat(amount);
        const escrowFee = (actualAmount * config.ESCROW_FEE_PERCENT) / 100;
        const networkFee = 0.1;
        const netAmount = actualAmount - networkFee;

        // Action should be 'release' only (checked earlier)
        const targetAddress = escrow.buyerAddress;
        if (!targetAddress) {
          return ctx.reply('❌ Buyer address is not set. Cannot proceed with release.');
        }

        try {
          const releaseResult = await BlockchainService.releaseFunds(
            escrow.token,
            escrow.chain,
            targetAddress,
            actualAmount,
            amountWeiOverride
          );
          
          // Update escrow status to completed and save transaction hash
          escrow.status = 'completed';
          // Save the release transaction hash (if returned)
          if (releaseResult && releaseResult.transactionHash) {
            escrow.releaseTransactionHash = releaseResult.transactionHash;
          }
          await escrow.save();


          const successText = `
${netAmount.toFixed(5)} ${escrow.token} [$${netAmount.toFixed(2)}] 💸 + NETWORK FEE has been released to the Buyer's address! 🚀

Approved By: ${escrow.sellerUsername ? '@' + escrow.sellerUsername : '[' + escrow.sellerId + ']'}
          `;

          await ctx.reply(successText);
          
          // Send transaction explorer link if available
          if (releaseResult && releaseResult.transactionHash) {
            const chain = escrow.chain || 'BSC';
            let explorerUrl = '';
            if (chain.toUpperCase() === 'BSC' || chain.toUpperCase() === 'BNB') {
              explorerUrl = `https://bscscan.com/tx/${releaseResult.transactionHash}`;
            } else if (chain.toUpperCase() === 'ETH' || chain.toUpperCase() === 'ETHEREUM') {
              explorerUrl = `https://etherscan.io/tx/${releaseResult.transactionHash}`;
            } else if (chain.toUpperCase() === 'POLYGON' || chain.toUpperCase() === 'MATIC') {
              explorerUrl = `https://polygonscan.com/tx/${releaseResult.transactionHash}`;
            }
            
            if (explorerUrl) {
              await ctx.reply(`🔗 Transaction: ${explorerUrl}`);
            }
          }
          
          // Ask buyer to confirm receipt of tokens
          const buyerConfirmationMsg = await ctx.telegram.sendMessage(
            escrow.groupId,
            `👤 Buyer ${escrow.buyerUsername ? '@' + escrow.buyerUsername : '[' + escrow.buyerId + ']'}: Did you receive the tokens?`,
            {
              reply_markup: Markup.inlineKeyboard([
                [
                  Markup.button.callback('✅ Yes, I received', `buyer_received_tokens_yes_${escrow.escrowId}`),
                  Markup.button.callback('❌ No, not received', `buyer_received_tokens_no_${escrow.escrowId}`)
                ]
              ]).reply_markup
            }
          );
          

          // Send trade completion message with close trade button
          // Initialize close trade tracking
          escrow.buyerClosedTrade = false;
          escrow.sellerClosedTrade = false;
          await escrow.save();
          
          const buyerUsername = escrow.buyerUsername || 'Buyer';
          const sellerUsername = escrow.sellerUsername || 'Seller';
          
          const closeTradeText = `✅ The trade has been completed successfully!

⏳ Waiting for @${buyerUsername} to confirm.
⏳ Waiting for @${sellerUsername} to confirm.`;
          
          const closeMsg = await ctx.replyWithPhoto(images.DEAL_COMPLETE, {
            caption: closeTradeText,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '🔒 Close Trade',
                      callback_data: `close_trade_${escrow.escrowId}`
                    }
                  ]
                ]
              }
          });
          
          escrow.closeTradeMessageId = closeMsg.message_id;
          await escrow.save();
        } catch (error) {
          console.error('Error executing transaction:', error);
          await ctx.reply('❌ Error executing transaction. Please try again or contact support.');
        }
      } else {
        const waitingText = `Release confirmation received. Waiting for the other party to confirm.`;
        await ctx.reply(waitingText);
      }

      await ctx.answerCbQuery('✅ Confirmation recorded');
    } else if (callbackData.startsWith('reject_')) {
      const [, action] = callbackData.split('_');
      
      // Only release is supported, but handle both for safety
      if (action === 'refund') {
        return ctx.answerCbQuery('❌ Refund functionality requires seller address. Please contact admin for refunds.');
      }
      
      // Find active escrow and reset confirmations
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release'] }
      });
      
      if (escrow) {
        escrow.buyerConfirmedRelease = false;
        escrow.sellerConfirmedRelease = false;
        escrow.buyerConfirmedRefund = false;
        escrow.sellerConfirmedRefund = false;
        await escrow.save();
      }
      
      await ctx.answerCbQuery('❌ Transaction rejected');
      await ctx.reply('❌ Transaction has been rejected by one of the parties. Please restart the process if needed.');
      
      return;
    }

  } catch (error) {
    console.error('Error in callback handler:', error);
    try {
      await ctx.answerCbQuery('❌ An error occurred');
    } catch (answerError) {
      // Handle expired callback queries gracefully
      if (answerError.description?.includes('query is too old') || 
          answerError.description?.includes('query ID is invalid')) {
      } else {
        console.error('Error answering callback query:', answerError);
      }
    }
  }
};


