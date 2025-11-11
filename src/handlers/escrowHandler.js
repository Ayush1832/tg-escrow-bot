const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const User = require('../models/User');
const GroupPoolService = require('../services/GroupPoolService');
const fs = require('fs');
const path = require('path');

module.exports = async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    
    // If used in private chat, assign a managed group
    if (chatId > 0) {
      try {
        // Simple in-memory anti-double-click lock (5 seconds)
        if (!global.__escrowClickLocks) global.__escrowClickLocks = new Map();
        const lastClickAt = global.__escrowClickLocks.get(userId) || 0;
        if (Date.now() - lastClickAt < 5000) {
          return ctx.reply('⏳ Please wait a few seconds before trying again.');
        }
        global.__escrowClickLocks.set(userId, Date.now());

        // Allow users to create multiple escrows - no restriction

        // Clean up abandoned escrows (draft status for more than 24 hours)
        try {
          const abandonedEscrows = await Escrow.find({
            status: 'draft',
            assignedFromPool: true,
            createdAt: { $lt: new Date(Date.now() - (24 * 60 * 60 * 1000)) }
          });
          
          for (const abandoned of abandonedEscrows) {
            try {
              await GroupPoolService.releaseGroup(abandoned.escrowId);
              abandoned.status = 'completed';
              await abandoned.save();
            } catch (cleanupError) {
              console.error('Error cleaning up abandoned escrow:', cleanupError);
            }
          }
        } catch (cleanupError) {
          console.error('Error during cleanup:', cleanupError);
        }

        // Generate unique escrow ID
        const escrowId = `ESC${Date.now()}`;
        
        // Assign a group from the managed pool with retry logic
        let assignedGroup;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            assignedGroup = await GroupPoolService.assignGroup(escrowId, ctx.telegram);
            break;
          } catch (assignError) {
            retryCount++;
            if (retryCount >= maxRetries) {
              throw assignError;
            }
            // Wait 1 second before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        // Generate invite link for the assigned group
        const inviteLink = await GroupPoolService.generateInviteLink(assignedGroup.groupId, ctx.telegram);
        
        // Create new escrow with assigned group
        const newEscrow = new Escrow({
          escrowId,
          creatorId: userId,
          creatorUsername: ctx.from.username,
          groupId: assignedGroup.groupId,
          assignedFromPool: true,
          status: 'draft',
          inviteLink,
          tradeStartTime: new Date()
        });
        await newEscrow.save();

        // Send welcome message to the assigned group
        const groupText = `📍 <b>Hey there traders! Welcome to our escrow service.</b>

📋 Escrow ID: <code>${escrowId}</code>

⚠️ <b>IMPORTANT</b> - Make sure coin and network matches your deposit address else you may loose your coin.
⚠️ <b>IMPORTANT</b> - Make sure the /buyer address is of the same chain as the selected token else you may loose your coin.

✅ Please start with /dd command and if you have any doubts please use /start command.`;

        const createEscrowImage = path.join(process.cwd(), 'public', 'images', 'create escrow.png');
        try {
          if (fs.existsSync(createEscrowImage)) {
            await ctx.telegram.sendPhoto(assignedGroup.groupId, { source: fs.createReadStream(createEscrowImage) }, {
              caption: groupText,
              parse_mode: 'HTML'
            });
          } else {
            await ctx.telegram.sendMessage(assignedGroup.groupId, groupText, { 
              parse_mode: 'HTML' 
            });
          }
        } catch (err) {
          await ctx.telegram.sendMessage(assignedGroup.groupId, groupText, { 
            parse_mode: 'HTML' 
          });
        }

        // Log event

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
- Use /buyer command to set buyer address
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
- Use /buyer command to set buyer address
- Use /deposit to generate deposit address`;
          
          await ctx.reply(fallbackText, { parse_mode: 'HTML' });
        }
      }
      
      return;
    }

    // If used in a group, check for existing escrow and initialize if needed
    const existingEscrow = await Escrow.findOne({
      groupId: chatId.toString(),
      status: { $in: ['draft', 'awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release'] }
    });

    if (existingEscrow) {
      return ctx.reply('⚠️ There is already an active escrow in this group. Please complete it first.');
    }

    // Create new escrow for existing group
    const escrowId = `ESC${Date.now()}`;
    const newEscrow = new Escrow({
      escrowId,
      groupId: chatId.toString(),
      status: 'draft',
      tradeStartTime: new Date()
    });

    await newEscrow.save();

    const groupText = `📍 <b>Hey there traders! Welcome to our escrow service.</b>

📋 Escrow ID: <code>${escrowId}</code>

⚠️ <b>IMPORTANT</b> - Make sure coin and network matches your deposit address else you may loose your coin.
⚠️ <b>IMPORTANT</b> - Make sure the /buyer address is of the same chain as the selected token else you may loose your coin.

✅ Please start with /dd command and if you have any doubts please use /start command.`;

    const createEscrowImage = path.join(process.cwd(), 'public', 'images', 'create escrow.png');
    try {
      if (fs.existsSync(createEscrowImage)) {
        await ctx.replyWithPhoto({ source: fs.createReadStream(createEscrowImage) }, {
          caption: groupText,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(groupText, { parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply(groupText, { parse_mode: 'HTML' });
    }


  } catch (error) {
    console.error('Error in escrow handler:', error);
    ctx.reply('❌ An error occurred while creating escrow. Please try again.');
  }
};
