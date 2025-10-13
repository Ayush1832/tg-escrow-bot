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
        
        // Generate invite link for the assigned group
        const inviteLink = await GroupPoolService.generateInviteLink(assignedGroup.groupId, ctx.telegram);
        
        // Create new escrow with assigned group
        const newEscrow = new Escrow({
          escrowId,
          groupId: assignedGroup.groupId,
          status: 'draft'
        });
        await newEscrow.save();

        // Activity tracking removed

        // Send DM to user with group invite
        const dmText = `🤖 <b>Escrow Group Assigned</b>

📋 Escrow ID: <code>${escrowId}</code>
👥 Group: Assigned from managed pool
🔗 Invite Link: <a href="${inviteLink}">Join Escrow Group</a>

⚠️ <b>Important Notes:</b>
- This invite link is limited to 2 members (buyer + seller)
- Link expires in 7 days
- Share this link with your trading partner
- Both parties must join before starting the escrow

✅ Once both parties join, use /dd command in the group to set deal details.`;

        await ctx.reply(dmText, { 
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });

        // Send welcome message to the assigned group
        const groupText = `📍 <b>Hey there traders! Welcome to our escrow service.</b>

📋 Escrow ID: <code>${escrowId}</code>

⚠️ <b>IMPORTANT</b> - Make sure coin and network is same of Buyer and Seller else you may loose your coin.
⚠️ <b>IMPORTANT</b> - Make sure the /buyer address and /seller address are of same chain else you may loose your coin.

✅ Please start with /dd command and if you have any doubts please use /start command.`;

        await ctx.telegram.sendMessage(assignedGroup.groupId, groupText, { 
          parse_mode: 'HTML' 
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

      } catch (poolError) {
        // Check if it's a "no available groups" error
        if (poolError.message && (poolError.message.includes('No available groups') || poolError.message.includes('All groups are currently occupied'))) {
          // User-friendly message for no available groups
          const botUsername = ctx.botInfo?.username || 'your_bot_username';
          const fallbackText = `🚫 <b>All Groups Currently Occupied</b>

All managed groups are currently being used for active escrows.

📋 <b>Manual Setup Instructions:</b>
1) Create a new Telegram group
2) Add this bot (@${botUsername}) to the group
3) Set the bot as admin with all permissions
4) Both buyer and seller join the group
5) Run /escrow command in the group to start

✅ <b>Once Setup Complete:</b>
- Use /dd command to set deal details
- Use /seller and /buyer commands to set addresses
- Use /deposit to generate deposit address

⚠️ <b>Note:</b> Manual groups work exactly the same as managed groups.`;
          
          await ctx.reply(fallbackText, { parse_mode: 'HTML' });
        } else {
          // Log other errors but don't show them to user
          console.error('Error with managed group pool:', poolError.message);
          
          // Generic fallback message
          const botUsername = ctx.botInfo?.username || 'your_bot_username';
          const fallbackText = `🚫 <b>Group Assignment Temporarily Unavailable</b>

Please create a group manually for now:

📋 <b>Manual Setup Instructions:</b>
1) Create a new Telegram group
2) Add this bot (@${botUsername}) to the group
3) Set the bot as admin with all permissions
4) Both buyer and seller join the group
5) Run /escrow command in the group to start

✅ <b>Once Setup Complete:</b>
- Use /dd command to set deal details
- Use /seller and /buyer commands to set addresses
- Use /deposit to generate deposit address`;
          
          await ctx.reply(fallbackText, { parse_mode: 'HTML' });
        }
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

    // Activity tracking removed

    const groupText = `📍 <b>Hey there traders! Welcome to our escrow service.</b>

📋 Escrow ID: <code>${escrowId}</code>

⚠️ <b>IMPORTANT</b> - Make sure coin and network is same of Buyer and Seller else you may loose your coin.
⚠️ <b>IMPORTANT</b> - Make sure the /buyer address and /seller address are of same chain else you may loose your coin.

✅ Please start with /dd command and if you have any doubts please use /start command.`;

    await ctx.reply(groupText, { parse_mode: 'HTML' });

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
