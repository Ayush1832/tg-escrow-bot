const { Markup } = require('telegraf');
const { ethers } = require('ethers');
const Escrow = require('../models/Escrow');
const BlockchainService = require('../services/BlockchainService');
const Event = require('../models/Event');
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
🤖 *Easy Escrow Bot Menu*

📋 *Available Commands:*
/start - Start the bot
/escrow - Create new escrow
/dd - Set deal details
/seller [address] - Set seller address
/buyer [address] - Set buyer address
/token - Select token and network
/deposit - Get deposit address

💡 *Tips:*
- Use /dd to set deal details first
- Make sure both parties confirm their roles
- Always verify addresses before depositing
      `;
      return ctx.reply(menuText, { parse_mode: 'Markdown' });
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
        
        await ctx.reply(`✅ Deposit confirmed: ${newAmount.toFixed(6)} ${escrow.token} (Total: ${totalAmount.toFixed(6)} ${escrow.token})`);

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
            ]
          ]).reply_markup
        }
      );

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

        // Release group back to pool
        try {
          const GroupPoolService = require('../services/GroupPoolService');
          await GroupPoolService.releaseGroup(escrow.escrowId);
        } catch (groupError) {
          console.error('Error releasing group back to pool:', groupError);
        }
        await ctx.reply(
          `${(amount - 0).toFixed(5)} ${escrow.token} has been released to the Buyer's address! 🚀\nApproved By: ${escrow.sellerUsername ? '@' + escrow.sellerUsername : '[' + escrow.sellerId + ']'}`
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

          // Release group back to pool
          try {
            const GroupPoolService = require('../services/GroupPoolService');
            await GroupPoolService.releaseGroup(escrow.escrowId);
          } catch (groupError) {
            console.error('Error releasing group back to pool:', groupError);
          }

          const successText = `
${netAmount.toFixed(5)} ${escrow.token} [$${netAmount.toFixed(2)}] 💸 + NETWORK FEE has been ${action === 'release' ? 'released' : 'refunded'} to the ${action === 'release' ? 'Buyer' : 'Seller'}'s address! 🚀

Approved By: @${ctx.from.username} | [${userId}]
Thank you for using @Easy_Escrow_Bot 🙌

@${ctx.from.username}, if you liked the bot please leave a good review about the bot and use command /vouch in reply to the review, and please also mention @Easy_Escrow_Bot in your vouch.
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
      
      await ctx.reply(declarationText, { parse_mode: 'Markdown' });
      
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
      
      await ctx.reply(transactionText, { parse_mode: 'Markdown' });
      
      // Log event
      await new Event({
        escrowId: escrow.escrowId,
        actorId: ctx.from.id,
        action: 'token_network_selected',
        payload: { token, network }
      }).save();
      
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
