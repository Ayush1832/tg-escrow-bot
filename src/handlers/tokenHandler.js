const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const Contract = require('../models/Contract');
const config = require('../../config');

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    
    // Check if user is in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a group chat.');
    }

    // Find active escrow in this group
    const escrow = await Escrow.findOne({
      groupId: chatId.toString(),
      status: { $in: ['draft', 'awaiting_details', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
    });

    if (!escrow) {
      return ctx.reply('❌ No active escrow found in this group. Please use /escrow to create one first.');
    }

    if (!escrow.buyerAddress) {
      return ctx.reply('❌ Please set buyer address first using /buyer command.');
    }

    // Get available tokens from database based on current fee percentage
    const desiredFeePercent = Number(config.ESCROW_FEE_PERCENT || 0);
    const availableContracts = await Contract.find({
      name: 'EscrowVault',
      feePercent: desiredFeePercent
    });
    
    if (availableContracts.length === 0) {
      return ctx.reply(`❌ No escrow contracts available with ${desiredFeePercent}% fee. Please contact admin to deploy contracts.`);
    }
    
    // Get unique tokens from available contracts
    const availableTokens = [...new Set(availableContracts.map(contract => contract.token))];
    
    if (availableTokens.length === 0) {
      return ctx.reply('❌ No tokens available. Please contact admin to deploy contracts.');
    }
    
    // Show token selection keyboard
    const tokenButtons = [];
    
    // Create 3x3 grid for tokens (except USDT which goes on bottom row)
    const gridTokens = availableTokens.filter(t => t !== 'USDT');
    for (let i = 0; i < gridTokens.length; i += 3) {
      const row = gridTokens.slice(i, i + 3);
      tokenButtons.push(row.map(token => Markup.button.callback(token, `select_token_${token}`)));
    }
    
    // Add USDT on separate row at bottom if available
    if (availableTokens.includes('USDT')) {
      tokenButtons.push([Markup.button.callback('USDT', 'select_token_USDT')]);
    }

    const tokenSelectionText = `
choose token from the list below
    `;

    await ctx.reply(tokenSelectionText, {
      reply_markup: Markup.inlineKeyboard(tokenButtons).reply_markup
    });


  } catch (error) {
    console.error('Error in token handler:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
};
