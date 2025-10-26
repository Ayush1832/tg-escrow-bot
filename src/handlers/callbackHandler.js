const { Markup } = require('telegraf');
const { ethers } = require('ethers');
const Escrow = require('../models/Escrow');
const BlockchainService = require('../services/BlockchainService');
const config = require('../../config');
const escrowHandler = require('./escrowHandler');
const DepositAddress = require('../models/DepositAddress');

module.exports = async (ctx) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // Handle different callback types
    if (callbackData === 'start_escrow') {
      await ctx.answerCbQuery('Starting a new escrow...');
      // Trigger escrow creation flow
      return escrowHandler(ctx);
    } else if (callbackData === 'show_menu') {
      await ctx.answerCbQuery('Showing menu...');
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
      return ctx.reply(menuText);
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
      const activeAddr = await DepositAddress.findOne({ escrowId: escrow.escrowId, address: escrow.depositAddress, status: { $in: ['active', 'used'] } });
      if (!activeAddr) return ctx.reply('❌ Deposit address expired or missing.');

      // On-chain first: query RPC logs, then fallback to explorer
      let txs = await BlockchainService.getTokenTransfersViaRPC(escrow.token, escrow.chain, activeAddr.address, activeAddr.lastCheckedBlock || 0);
      if (!txs || txs.length === 0) {
        txs = await BlockchainService.getTokenTransactions(escrow.token, escrow.chain, activeAddr.address);
      }
      const sellerAddr = (escrow.sellerAddress || '').toLowerCase();
      const vaultAddr = activeAddr.address.toLowerCase();
      // Only count new deposits since the last check
      const newDeposits = (txs || []).filter(tx => {
        const from = (tx.from || '').toLowerCase();
        const to = (tx.to || '').toLowerCase();
        return to === vaultAddr && (!sellerAddr || from === sellerAddr);
      });
      
      const newAmount = newDeposits.reduce((sum, tx) => sum + Number(tx.valueDecimal || 0), 0);
      const totalAmount = (activeAddr.observedAmount || 0) + newAmount;

      if (newAmount > 0) {
        activeAddr.observedAmount = totalAmount;
        // Track last checked block from RPC
        try {
          const latest = await BlockchainService.getLatestBlockNumber(escrow.chain);
          if (latest) activeAddr.lastCheckedBlock = latest;
        } catch {}
        activeAddr.status = 'used';
        await activeAddr.save();
        escrow.depositAmount = totalAmount;
        escrow.confirmedAmount = totalAmount;
        escrow.status = 'deposited';
        await escrow.save();
        
        // Activity tracking removed
        
        await ctx.reply(`✅ Deposit confirmed: ${newAmount.toFixed(2)} ${escrow.token}`);

        // Begin fiat transfer handshake
        // Ask buyer to confirm they've sent the fiat payment
        if (escrow.buyerId) {
          await ctx.reply(
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
      const escrowId = callbackData.split('_')[3];
      // Only buyer can click
      const escrow = await Escrow.findOne({
        escrowId: escrowId,
        status: { $in: ['deposited', 'in_fiat_transfer'] }
      });
      if (!escrow) return ctx.answerCbQuery('❌ No active escrow found.');
      if (escrow.buyerId !== userId) return ctx.answerCbQuery('❌ Only the buyer can confirm this.');

      escrow.buyerSentFiat = true;
      escrow.status = 'in_fiat_transfer';
      await escrow.save();
      
      // Activity tracking removed

      await ctx.answerCbQuery('✅ Noted.');
      // Ask seller to confirm receipt
      await ctx.reply(
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

    } else if (callbackData.startsWith('fiat_received_seller_partial_')) {
      const escrowId = callbackData.split('_')[4];
      // Only seller can click
      const escrow = await Escrow.findOne({
        escrowId: escrowId,
        status: { $in: ['in_fiat_transfer', 'deposited'] }
      });
      if (!escrow) return ctx.answerCbQuery('❌ No active escrow found.');
      if (escrow.sellerId !== userId) return ctx.answerCbQuery('❌ Only the seller can confirm this.');

      // Mark as partial payment dispute
      escrow.sellerReceivedFiat = false;
      escrow.isDisputed = true;
      escrow.status = 'disputed';
      escrow.disputeReason = 'Seller reported receiving less money than expected';
      escrow.disputeRaisedAt = new Date();
      escrow.disputeRaisedBy = userId;
      escrow.disputeResolution = 'pending';
      await escrow.save();

      await ctx.answerCbQuery('⚠️ Marked as partial payment dispute');

      // Transfer all funds to admin wallet
      try {
        const BlockchainService = require('../services/BlockchainService');
        const config = require('../config');
        
        // Get the contract address for this escrow
        const contractAddress = await BlockchainService.getEscrowContractAddress(escrow.token, escrow.chain);
        if (!contractAddress) {
          throw new Error('Contract not found for this token/network');
        }

        // Transfer all funds to admin wallet
        const adminAddress = config.ADMIN_DEPOSIT_ADDRESS;
        if (!adminAddress) {
          throw new Error('Admin deposit address not configured');
        }

        // Get the current balance in the contract
        const balance = await BlockchainService.getTokenBalance(contractAddress, escrow.token, escrow.chain);
        
        if (balance > 0) {
          // Transfer all funds to admin
          const txHash = await BlockchainService.withdrawToAdmin(contractAddress, adminAddress, escrow.token, escrow.chain, balance);
          
          console.log(`💰 Transferred ${balance} ${escrow.token} to admin wallet: ${adminAddress}`);
          console.log(`📝 Transaction hash: ${txHash}`);
        }

        // Send admin notification for partial payment dispute
        await sendAdminPartialPaymentNotification(ctx, escrow, balance);

      } catch (error) {
        console.error('Error transferring funds to admin:', error);
        await ctx.reply('❌ Error transferring funds to admin. Please contact support.');
      }

    } else if (callbackData.startsWith('fiat_received_seller_yes_') || callbackData.startsWith('fiat_received_seller_no_')) {
      const escrowId = callbackData.split('_')[4];
      // Only seller can click
      const escrow = await Escrow.findOne({
        escrowId: escrowId,
        status: { $in: ['in_fiat_transfer', 'deposited'] }
      });
      if (!escrow) return ctx.answerCbQuery('❌ No active escrow found.');
      if (escrow.sellerId !== userId) return ctx.answerCbQuery('❌ Only the seller can confirm this.');

      const isYes = callbackData.includes('_yes_');
      if (!isYes) {
        escrow.sellerReceivedFiat = false;
        escrow.isDisputed = true;
        escrow.status = 'disputed';
        escrow.disputeReason = 'Seller reported fiat not received';
        escrow.disputeRaisedAt = new Date();
        escrow.disputeRaisedBy = userId;
        escrow.disputeResolution = 'pending';
        await escrow.save();
        
        // Activity tracking removed
        
        await ctx.answerCbQuery('❌ Marked as not received');
        
        // Send admin notification
        const disputeHandler = require('./disputeHandler');
        await disputeHandler.sendAdminDisputeNotification(ctx, escrow);
        
        return ctx.reply('❗ Seller reported fiat not received. Dispute raised. Admin will join within 24 hours.');
      }

      escrow.sellerReceivedFiat = true;
      await escrow.save();
      await ctx.answerCbQuery('✅ Confirmed received');

      // Auto-initiate release to buyer for full confirmed amount
      const amount = Number(escrow.confirmedAmount || 0);
      if (!escrow.buyerAddress || amount <= 0) {
        return ctx.reply('⚠️ Cannot proceed with release: missing buyer address or zero amount.');
      }
      try {
        await ctx.reply('🚀 Release of payment is in progress...');
        await BlockchainService.release(escrow.buyerAddress, amount, escrow.token, escrow.chain);
        escrow.status = 'completed';
        await escrow.save();

      // Activity tracking removed

        // Recycle group after completion - remove users and return to pool
        try {
          const GroupPoolService = require('../services/GroupPoolService');
          await GroupPoolService.recycleGroupAfterCompletion(escrow, ctx.telegram);
        } catch (groupError) {
          console.error('Error recycling group after completion:', groupError);
          // Fallback to regular release if recycling fails
          try {
            await GroupPoolService.releaseGroup(escrow.escrowId);
          } catch (fallbackError) {
            console.error('Error in fallback group release:', fallbackError);
          }
        }
        await ctx.reply(
          `${(amount - 0).toFixed(2)} ${escrow.token} has been released to the Buyer's address! 🚀\nApproved By: ${escrow.sellerUsername ? '@' + escrow.sellerUsername : '[' + escrow.sellerId + ']'}`
        );
      } catch (error) {
        console.error('Auto-release error:', error);
        await ctx.reply('❌ Error releasing funds. Please try /release or contact support.');
      }

    } else if (callbackData.startsWith('confirm_')) {
      const [, action, role, amount] = callbackData.split('_');
      
      // Find active escrow
      const escrow = await Escrow.findOne({
        groupId: chatId.toString(),
        status: { $in: ['deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
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

      // Update confirmation status
      if (action === 'release') {
        if (role === 'buyer') {
          escrow.buyerConfirmedRelease = true;
        } else {
          escrow.sellerConfirmedRelease = true;
        }
      } else if (action === 'refund') {
        if (role === 'buyer') {
          escrow.buyerConfirmedRefund = true;
        } else {
          escrow.sellerConfirmedRefund = true;
        }
      }

      await escrow.save();

      // Check if both parties confirmed
      const bothConfirmed = (action === 'release' && escrow.buyerConfirmedRelease && escrow.sellerConfirmedRelease) ||
                           (action === 'refund' && escrow.buyerConfirmedRefund && escrow.sellerConfirmedRefund);

      if (bothConfirmed) {
        // Execute the transaction
        const amount = parseFloat(amount);
        const escrowFee = (amount * config.ESCROW_FEE_PERCENT) / 100;
        const networkFee = 0.1;
        const netAmount = amount - networkFee;

        const targetAddress = action === 'release' ? escrow.buyerAddress : escrow.sellerAddress;
        try {
          if (action === 'release') {
            await BlockchainService.release(targetAddress, amount);
          } else {
            await BlockchainService.refund(targetAddress, amount);
          }
          
          // Update escrow status
          escrow.status = action === 'release' ? 'completed' : 'refunded';
          await escrow.save();

          // Activity tracking removed

          // Recycle group after completion - remove users and return to pool
          try {
            const GroupPoolService = require('../services/GroupPoolService');
            await GroupPoolService.recycleGroupAfterCompletion(escrow, ctx.telegram);
          } catch (groupError) {
            console.error('Error recycling group after completion:', groupError);
            // Fallback to regular release if recycling fails
            try {
              await GroupPoolService.releaseGroup(escrow.escrowId);
            } catch (fallbackError) {
              console.error('Error in fallback group release:', fallbackError);
            }
          }

          const successText = `
${netAmount.toFixed(2)} ${escrow.token} [$${netAmount.toFixed(2)}] 💸 + NETWORK FEE has been ${action === 'release' ? 'released' : 'refunded'} to the ${action === 'release' ? 'Buyer' : 'Seller'}'s address! 🚀

Approved By: @${ctx.from.username} | [${userId}]
Thank you for using @mm_escrow_bot 🙌

@${ctx.from.username}, if you liked the bot please leave a good review about the bot and use command /vouch in reply to the review, and please also mention @mm_escrow_bot in your vouch.
          `;

          await ctx.reply(successText);
        } catch (error) {
          console.error('Error executing transaction:', error);
          await ctx.reply('❌ Error executing transaction. Please try again or contact support.');
        }
      } else {
        const waitingText = `${action === 'release' ? 'Release' : 'Refund'} confirmation received. Waiting for the other party to confirm.`;
        await ctx.reply(waitingText);
      }

      await ctx.answerCbQuery('✅ Confirmation recorded');
    } else if (callbackData.startsWith('reject_')) {
      await ctx.answerCbQuery('❌ Transaction rejected');
      await ctx.reply('❌ Transaction has been rejected by one of the parties.');
    } else if (callbackData === 'my_escrows') {
      await ctx.answerCbQuery('Loading your escrows...');
      await handleMyEscrows(ctx);
    } else if (callbackData === 'help') {
      await ctx.answerCbQuery('Showing help...');
      await handleHelp(ctx);
    } else if (callbackData === 'terms') {
      await ctx.answerCbQuery('Showing terms...');
      await handleTerms(ctx);
    } else if (callbackData === 'how_escrow_works') {
      await ctx.answerCbQuery('Showing guide...');
      await handleHowEscrowWorks(ctx);
    } else if (callbackData.startsWith('filter_')) {
      await ctx.answerCbQuery('Filtering escrows...');
      const filter = callbackData.split('_')[1];
      await handleMyEscrows(ctx, filter);
    } else if (callbackData === 'back_to_start') {
      await ctx.answerCbQuery('Returning to main menu...');
      // Send the start message directly to avoid circular require
      const welcomeText = `
💫 *@mm_escrow_bot* 💫
Your Trustworthy Telegram Escrow Service

Welcome to MM escrow. This bot provides a reliable escrow service for your transactions on Telegram.
Avoid scams, your funds are safeguarded throughout your deals.

🔐 Proceed with confidence — your trust, security, and satisfaction are our top priorities.  

🎟 *ESCROW FEE:*
${config.ESCROW_FEE_PERCENT}% Flat

⚠️ *IMPORTANT* - Make sure coin is same of Buyer and Seller else you may loose your coin.

🌐 Please choose how you'd like to proceed below: 👇
      `;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Start Escrow', 'start_escrow'),
          Markup.button.callback('👤 My Escrows', 'my_escrows')
        ],
        [
          Markup.button.callback('🤖 Help', 'help'),
          Markup.button.callback('📜 Terms', 'terms')
        ],
        [
          Markup.button.callback('❓ How Escrow Works', 'how_escrow_works')
        ],
        [
          Markup.button.url('📢 Updates & Vouches ↗️', 'https://t.me/oftenly')
        ]
      ]).reply_markup;

      await ctx.replyWithPhoto(
        { source: 'public/images/logo.jpg' },
        {
          caption: welcomeText,
          reply_markup: keyboard
        }
      );
    } else if (callbackData.startsWith('select_token_')) {
      const token = callbackData.split('_')[2];
      await ctx.answerCbQuery(`Selected ${token}`);
      
      // Get available networks for this token from database
      const Contract = require('../models/Contract');
      const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      
      const availableContracts = await Contract.find({
        name: 'EscrowVault',
        token: token,
        feePercent: desiredFeePercent
      });
      
      if (availableContracts.length === 0) {
        return ctx.reply(`❌ No escrow contracts available for ${token} with ${desiredFeePercent}% fee. Please contact admin to deploy the contract.`);
      }
      
      // Get unique networks from available contracts
      const networks = [...new Set(availableContracts.map(contract => contract.network))];
      
      if (networks.length === 0) {
        return ctx.reply(`❌ No networks available for ${token}. Please contact admin to deploy contracts.`);
      }
      
      const networkButtons = [];
      for (let i = 0; i < networks.length; i += 2) {
        const row = networks.slice(i, i + 2);
        networkButtons.push(row.map(network => Markup.button.callback(network, `select_network_${token}_${network.replace(/[\[\]]/g, '').replace('BEP20', '').replace('TRC20', 'TRON')}`)));
      }
      
      // Add back button
      networkButtons.push([Markup.button.callback('Back ⬅️', 'back_to_tokens')]);
      
      const networkSelectionText = `
📌 *ESCROW-CRYPTO DECLARATION*

✅ *CRYPTO*
${token}

choose network from the list below for ${token} 
      `;
      
      await ctx.reply(networkSelectionText, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(networkButtons).reply_markup
      });
      
    } else if (callbackData.startsWith('select_network_')) {
      const parts = callbackData.split('_');
      const token = parts[2];
      const network = parts.slice(3).join('_'); // Handle networks with underscores
      
      await ctx.answerCbQuery(`Selected ${token} on ${network}`);
      
      // Find escrow and update with selected token/network
      const escrow = await Escrow.findOne({
        groupId: ctx.chat.id.toString(),
        status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit'] }
      });
      
      if (!escrow) {
        return ctx.reply('❌ No active escrow found.');
      }
      
      // Check if escrow contract exists for this token-network pair with correct fee percentage
      const Contract = require('../models/Contract');
      const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
      const contract = await Contract.findOne({
        name: 'EscrowVault',
        token: token,
        network: network.toUpperCase(),
        feePercent: desiredFeePercent
      });
      
      if (!contract) {
        return ctx.reply(`❌ Escrow contract not deployed for ${token} on ${network} with ${desiredFeePercent}% fee. Please contact admin to deploy the contract first.`);
      }
      
      // Update escrow with selected token and network
      escrow.token = token;
      escrow.chain = network;
      escrow.status = 'awaiting_deposit';
      await escrow.save();
      
      const buyerTag = escrow.buyerUsername ? `@${escrow.buyerUsername}` : `[${escrow.buyerId}]`;
      const sellerTag = escrow.sellerUsername ? `@${escrow.sellerUsername}` : `[${escrow.sellerId}]`;
      
      const declarationText = `
📍 *ESCROW DECLARATION*

⚡️ Buyer ${buyerTag} | Userid: [${escrow.buyerId}]
⚡️ Seller ${sellerTag} | Userid: [${escrow.sellerId}]

✅ ${token} CRYPTO
✅ ${network} NETWORK
      `;
      
      await ctx.reply(declarationText);
      
      // Get transaction information
      const transactionText = `
📍 *TRANSACTION INFORMATION [${escrow.escrowId.slice(-8)}]*

⚡️ *SELLER*
${sellerTag} | [${escrow.sellerId}]
${escrow.sellerAddress}

⚡️ *BUYER*
${buyerTag} | [${escrow.buyerId}]
${escrow.buyerAddress}

⏰ Trade Start Time: ${new Date().toLocaleString('en-GB', { 
        day: '2-digit', 
        month: '2-digit', 
        year: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      })}

⚠️ *IMPORTANT:* Make sure to finalise and agree each-others terms before depositing.

🗒 Please use /deposit command to generate a deposit address for your trade.
      `;
      
      await ctx.reply(transactionText);
      
      
    } else if (callbackData === 'back_to_tokens') {
      await ctx.answerCbQuery('Back to tokens');
      // Re-trigger token selection
      const tokenHandler = require('./tokenHandler');
      return tokenHandler(ctx);
    }

  } catch (error) {
    console.error('Error in callback handler:', error);
    try {
      await ctx.answerCbQuery('❌ An error occurred');
    } catch (answerError) {
      // Handle expired callback queries gracefully
      if (answerError.description?.includes('query is too old') || 
          answerError.description?.includes('query ID is invalid')) {
        console.log('Callback query expired, ignoring...');
      } else {
        console.error('Error answering callback query:', answerError);
      }
    }
  }
};

// Helper function to handle My Escrows
async function handleMyEscrows(ctx, filter = 'all') {
  try {
    const userId = ctx.from.id;
    
    // Get all escrows where user is involved (as buyer or seller)
    const userEscrows = await Escrow.find({
      $or: [
        { buyerId: userId },
        { sellerId: userId },
        { creatorId: userId }
      ]
    }).sort({ createdAt: -1 });

    // Apply filter
    let filteredEscrows = userEscrows;
    let filterTitle = 'All Escrows';

    if (filter === 'active') {
      filteredEscrows = userEscrows.filter(e => ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'].includes(e.status));
      filterTitle = 'Active Escrows';
    } else if (filter === 'completed') {
      filteredEscrows = userEscrows.filter(e => e.status === 'completed');
      filterTitle = 'Completed Escrows';
    } else if (filter === 'pending') {
      filteredEscrows = userEscrows.filter(e => ['draft', 'awaiting_details'].includes(e.status));
      filterTitle = 'Pending Escrows';
    } else if (filter === 'disputed') {
      filteredEscrows = userEscrows.filter(e => e.status === 'disputed');
      filterTitle = 'Disputed Escrows';
    }

    // Calculate statistics
    const totalEscrows = userEscrows.length;
    const totalWorth = userEscrows.reduce((sum, escrow) => {
      // Use confirmedAmount if available, otherwise depositAmount, otherwise 0
      const amount = escrow.confirmedAmount || escrow.depositAmount || 0;
      return sum + (parseFloat(amount) || 0);
    }, 0);

    // Count by status
    const activeCount = userEscrows.filter(e => ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'].includes(e.status)).length;
    const completedCount = userEscrows.filter(e => e.status === 'completed').length;
    const pendingCount = userEscrows.filter(e => e.status === 'draft' || e.status === 'awaiting_details').length;
    const disputedCount = userEscrows.filter(e => e.status === 'disputed').length;

    let myEscrowsText = `${filterTitle}\n\n`;
    myEscrowsText += `Statistics:\n`;
    myEscrowsText += `- Total Escrows: ${totalEscrows}\n`;
    myEscrowsText += `- Total Worth: ${totalWorth.toFixed(2)} USDT\n`;
    myEscrowsText += `- Active: ${activeCount}\n`;
    myEscrowsText += `- Completed: ${completedCount}\n`;
    myEscrowsText += `- Pending: ${pendingCount}\n`;
    myEscrowsText += `- Disputed: ${disputedCount}\n\n`;

    if (filteredEscrows.length > 0) {
      myEscrowsText += `Your Escrows (${filteredEscrows.length}):\n`;
      filteredEscrows.slice(0, 5).forEach((escrow, index) => {
        const role = escrow.buyerId === userId ? 'Buyer' : (escrow.sellerId === userId ? 'Seller' : 'Creator');
        myEscrowsText += `\n${index + 1}. ID: ${escrow._id.toString().substring(0, 8)}\n`;
        myEscrowsText += `   Status: ${escrow.status.replace(/_/g, ' ').toUpperCase()}\n`;
        myEscrowsText += `   Role: ${role}\n`;
        myEscrowsText += `   Token: ${escrow.token} on ${escrow.chain}\n`;
        myEscrowsText += `   Amount: ${escrow.confirmedAmount || escrow.depositAmount || 'N/A'} ${escrow.token}\n`;
      });
      if (filteredEscrows.length > 5) {
        myEscrowsText += `\n...and ${filteredEscrows.length - 5} more.`;
      }
    } else {
      myEscrowsText += `No ${filterTitle.toLowerCase()} found.`;
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`🟢 Active (${activeCount})`, 'filter_active'),
        Markup.button.callback(`✅ Completed (${completedCount})`, 'filter_completed')
      ],
      [
        Markup.button.callback(`⏳ Pending (${pendingCount})`, 'filter_pending'),
        Markup.button.callback(`⚖️ Disputed (${disputedCount})`, 'filter_disputed')
      ],
      [
        Markup.button.callback('⬅️ Back', 'back_to_start')
      ]
    ]).reply_markup;

    // Use different image based on filter
    const imagePath = (filter === 'all') 
      ? 'public/images/my escrow.jpg' 
      : 'public/images/escrow.jpg';

    await ctx.replyWithPhoto(
      { source: imagePath },
      {
        caption: myEscrowsText,
        reply_markup: keyboard
      }
    );
  } catch (error) {
    console.error('Error in handleMyEscrows:', error);
    await ctx.reply('❌ Error loading your escrows. Please try again.');
  }
}

// Helper function to handle Help
async function handleHelp(ctx) {
  const helpText = `BOT COMMANDS HELP

Available Commands:

In Private Chat:
- /start - Show main menu and options
- /escrow - Create new escrow (assigns managed group)
- /my_escrows - View your escrow history

In Group Chat:
- /dd - Set deal details (Quantity - Rate)
- /buyer address - Set buyer wallet address
- /token - Select token and network
- /deposit - Generate deposit address

Tips:
- Always verify addresses before depositing
- Make sure both parties confirm their roles
- Use /dd to set deal details first
- Contact admin if you need help`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Back to Menu', 'back_to_start')]
  ]).reply_markup;

    await ctx.replyWithPhoto(
      { source: 'public/images/help.jpg' },
      {
        caption: helpText,
        reply_markup: keyboard
      }
    );
}

// Helper function to handle Terms
async function handleTerms(ctx) {
  const termsText = `TERMS OF USAGE

Fees: ${config.ESCROW_FEE_PERCENT}% for P2P / OTC
Transactions fee applies. Consider this when depositing.

1. Record/screenshot testing of logins, data, or opening items. Delete if satisfied.
Failure to provide evidence = loss of funds.

2. Learn what you are buying. Sellers not required to explain, but guidance helps.

3. Buyer releases funds ONLY after receiving what was paid.
No responsibility for early release.

4. Use trusted wallets (Electrum, Exodus).
Online wallets may block accounts.

5. Fees are deducted from wallet balance (${config.ESCROW_FEE_PERCENT}%). Keep this in mind.

6. Ensure coin & network match for Buyer & Seller to avoid losses.

Important: Always verify addresses and terms before proceeding with any transaction.`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Back to Menu', 'back_to_start')]
  ]).reply_markup;

    await ctx.replyWithPhoto(
      { source: 'public/images/terms.jpg' },
      {
        caption: termsText,
        reply_markup: keyboard
      }
    );
}

// Helper function to handle How Escrow Works
async function handleHowEscrowWorks(ctx) {
  const guideText = `HOW ESCROW WORKS - STEP BY STEP GUIDE

Smart Contract Protection:
Your funds are secured by blockchain smart contracts, ensuring automatic and transparent transactions.

Step-by-Step Process:

Step 1: Create Escrow
- Use /escrow command to create new escrow
- Bot assigns a secure group for your transaction
- Get invite link to share with trading partner

Step 2: Set Deal Details
- Use /dd command to set quantity and rate
- Example: "100 USDT at $1.00 per unit"
- Both parties must agree on terms

Step 3: Set Roles & Addresses
- Buyer: Use /buyer your_wallet_address
- Ensure addresses are correct for selected token/network

Step 4: Select Token & Network
- Use /token command to choose cryptocurrency
- Select network (BSC, ETH, etc.)
- Bot only shows available options

Step 5: Generate Deposit Address
- Use /deposit command to get escrow address
- Buyer sends agreed amount to this address
- Funds are locked in smart contract

Step 6: Complete Transaction
- Buyer confirms payment received
- Seller confirms item/service delivered
- Smart contract automatically releases funds

Security Features:
- Smart contracts prevent fraud
- Funds locked until both parties confirm
- Dispute resolution available
- Transparent blockchain records

Important Notes:
- Always verify addresses before sending
- Use correct token and network
- Keep transaction records
- Contact admin for disputes`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Back to Menu', 'back_to_start')]
  ]).reply_markup;

  await ctx.reply(guideText, {
    reply_markup: keyboard
  });
}

/**
 * Send admin notification for partial payment dispute
 */
async function sendAdminPartialPaymentNotification(ctx, escrow, transferredAmount) {
  try {
    const adminUserIds = [config.ADMIN_USER_ID];
    
    // Generate invite link for the group
    let inviteLink = '';
    if (escrow.groupId) {
      try {
        const invite = await ctx.telegram.createChatInviteLink(escrow.groupId, {
          member_limit: 1,
          expire_date: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
        });
        inviteLink = invite.invite_link;
      } catch (error) {
        console.error('Error creating invite link:', error);
        inviteLink = `Group ID: ${escrow.groupId}`;
      }
    }

    const message = `🚨 **PARTIAL PAYMENT DISPUTE** 🚨

⚠️ **Dispute Type:** Seller received less money than expected
💰 **Amount Transferred to Admin:** ${transferredAmount} ${escrow.token}
🆔 **Escrow ID:** \`${escrow.escrowId}\`
👤 **Seller:** ${escrow.sellerUsername ? '@' + escrow.sellerUsername : '[' + escrow.sellerId + ']'}
🛒 **Buyer:** ${escrow.buyerUsername ? '@' + escrow.buyerUsername : '[' + escrow.buyerId + ']'}
🌐 **Network:** ${escrow.chain}
🪙 **Token:** ${escrow.token}
📅 **Dispute Raised:** ${new Date().toLocaleString()}

🔗 **Group Access:** ${inviteLink ? `[Click here to join the disputed group](${inviteLink})` : 'Group invite link unavailable'}

**Action Required:**
1. Join the group to investigate
2. Communicate with both parties
3. Decide on fair resolution
4. Click the command below to copy and paste in the group:

\`/admin_settle_partial ${escrow.escrowId}\`

**Note:** All funds have been transferred to admin wallet for manual distribution.`;

    // Send to all admins
    for (const adminId of adminUserIds) {
      try {
        await ctx.telegram.sendMessage(adminId, message, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
      } catch (error) {
        console.error(`Error sending partial payment notification to admin ${adminId}:`, error);
      }
    }

    console.log(`📢 Partial payment dispute notification sent to ${adminUserIds.length} admin(s)`);

  } catch (error) {
    console.error('Error sending partial payment notification:', error);
  }
}
