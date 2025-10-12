const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const User = require('../models/User');
const GroupPoolService = require('../services/GroupPoolService');

module.exports = async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    
    // If used in private chat, assign a managed group
    if (chatId > 0) {
      try {
        // Generate unique escrow ID
        const escrowId = `ESC${Date.now()}`;
        
        // Assign a group from the managed pool
        const assignedGroup = await GroupPoolService.assignGroup(escrowId);
        console.log('✅ Assigned group:', assignedGroup);
        
        // Generate invite link for the assigned group
        const inviteLink = await GroupPoolService.generateInviteLink(assignedGroup.groupId, ctx.telegram);
        console.log('✅ Generated invite link:', inviteLink);
        
        // Create new escrow with assigned group
        const newEscrow = new Escrow({
          escrowId,
          groupId: assignedGroup.groupId,
          status: 'draft'
        });
        await newEscrow.save();

        // Send DM to user with group invite
        const dmText = `🤖 *Escrow Group Assigned*

📋 Escrow ID: \`${escrowId}\`
👥 Group: Assigned from managed pool
🔗 Invite Link: [Join Escrow Group](${inviteLink})

⚠️ *Important Notes:*
• This invite link is limited to 2 members (buyer + seller)
• Link expires in 7 days
• Share this link with your trading partner
• Both parties must join before starting the escrow

✅ Once both parties join, use /dd command in the group to set deal details.`;

        await ctx.reply(dmText, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });

        // Send welcome message to the assigned group
        const groupText = `📍 *Hey there traders! Welcome to our escrow service.*

📋 Escrow ID: \`${escrowId}\`

⚠️ *IMPORTANT* - Make sure coin and network is same of Buyer and Seller else you may loose your coin.
⚠️ *IMPORTANT* - Make sure the /buyer address and /seller address are of same chain else you may loose your coin.

✅ Please start with /dd command and if you have any doubts please use /start command.`;

        await ctx.telegram.sendMessage(assignedGroup.groupId, groupText, { 
          parse_mode: 'Markdown' 
        });

        // Log event
        const Event = require('../models/Event');
        await new Event({
          escrowId,
          actorId: userId,
          action: 'escrow_created',
          payload: { 
            groupId: assignedGroup.groupId,
            assignedFromPool: true,
            inviteLink: inviteLink
          }
        }).save();

        console.log(`✅ Escrow ${escrowId} created with managed group ${assignedGroup.groupId}`);

      } catch (poolError) {
        console.error('Error with managed group pool:', poolError);
        
        // Fallback to manual instructions if pool is empty
        const botUsername = ctx.botInfo?.username || 'your_bot_username';
        const fallbackText = `❌ *No Available Groups*

Currently no groups available in the managed pool.

📋 *Manual Setup Required:*
1) Create a new Telegram group
2) Add this bot (@${botUsername}) to the group
3) Set the bot as admin
4) Both buyer and seller join the group
5) Run /escrow command in the group

⚠️ *Alternative:* Contact admin to add more groups to the pool.`;
        
        await ctx.reply(fallbackText, { parse_mode: 'Markdown' });
      }
      
      return;
    }

    // If used in a group, check for existing escrow and initialize if needed
    const existingEscrow = await Escrow.findOne({
      groupId: chatId.toString(),
      status: { $in: ['draft', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
    });

    if (existingEscrow) {
      return ctx.reply('⚠️ There is already an active escrow in this group. Please complete it first or use /dispute if there are issues.');
    }

    // Create new escrow for existing group
    const escrowId = `ESC${Date.now()}`;
    const newEscrow = new Escrow({
      escrowId,
      groupId: chatId.toString(),
      status: 'draft'
    });

    await newEscrow.save();

    const groupText = `
📍 *Hey there traders! Welcome to our escrow service.*

📋 Escrow ID: \`${escrowId}\`

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
      payload: { groupId: chatId.toString(), assignedFromPool: false }
    }).save();

  } catch (error) {
    console.error('Error in escrow handler:', error);
    ctx.reply('❌ An error occurred while creating escrow. Please try again.');
  }
};
