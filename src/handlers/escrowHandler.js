const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const User = require('../models/User');

module.exports = async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    
    // Check if user is in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a group chat. Please create a group and add the bot as admin.');
    }

    // Check if there's already an active escrow in this group
    const existingEscrow = await Escrow.findOne({
      groupId: chatId.toString(),
      status: { $in: ['draft', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
    });

    if (existingEscrow) {
      return ctx.reply('⚠️ There is already an active escrow in this group. Please complete it first or use /dispute if there are issues.');
    }

    // Create new escrow
    const escrowId = `ESC${Date.now()}`;
    const newEscrow = new Escrow({
      escrowId,
      groupId: chatId.toString(),
      status: 'draft'
    });

    await newEscrow.save();

    const groupText = `
📍 Hey there traders! Welcome to our escrow service.

⚠️ *IMPORTANT* - Make sure coin and network is same of Buyer and Seller else you may loose your coin.
⚠️ *IMPORTANT* - Make sure the /buyer address and /seller address are of same chain else you may loose your coin.

✅ Please start with /dd command and if you have any doubts please use /start command.
    `;

    await ctx.reply(groupText, { parse_mode: 'Markdown' });

    // Log event
    const Event = require('../models/Event');
    await new Event({
      escrowId,
      actorId: userId,
      action: 'escrow_created',
      payload: { groupId: chatId.toString() }
    }).save();

  } catch (error) {
    console.error('Error in escrow handler:', error);
    ctx.reply('❌ An error occurred while creating escrow. Please try again.');
  }
};
