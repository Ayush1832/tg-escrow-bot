const Escrow = require('../models/Escrow');
const Contract = require('../models/Contract');

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();
    
    // Must be in a group
    if (chatId > 0) {
      return ctx.reply('❌ This command can only be used in a group chat.');
    }

    // Check if this is a trade group (has an escrow with this groupId)
    const tradeGroupEscrow = await Escrow.findOne({
      groupId: chatId.toString()
    });

    if (tradeGroupEscrow) {
      // This is a trade group, command should not work here
      return ctx.reply('❌ This command can only be used in the main group, not in trade groups.');
    }

    // Parse address from command: /verify 0x...
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('❌ Usage: /verify <address>\n\nExample: /verify 0x4dd9c84aD4201d4aDF67eE20508BF622125C515c');
    }

    let address = parts[1].trim();
    
    // Extract address from explorer links if provided
    const urlPatterns = [
      /bscscan\.com\/address\/(0x[a-fA-F0-9]{40})/i,
      /etherscan\.io\/address\/(0x[a-fA-F0-9]{40})/i,
      /polygonscan\.com\/address\/(0x[a-fA-F0-9]{40})/i
    ];
    
    for (const pattern of urlPatterns) {
      const match = address.match(pattern);
      if (match) {
        address = match[1];
        break;
      }
    }

    // Validate address format
    if (!address.startsWith('0x') || address.length !== 42 || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return ctx.reply('❌ Invalid address format. Please provide a valid Ethereum/BSC address (0x followed by 40 hexadecimal characters).');
    }

    // Normalize address to lowercase for comparison
    const normalizedAddress = address.toLowerCase();

    // Find escrow(s) with this deposit address
    const escrows = await Escrow.find({
      $or: [
        { depositAddress: { $regex: new RegExp(`^${normalizedAddress}$`, 'i') } },
        { uniqueDepositAddress: { $regex: new RegExp(`^${normalizedAddress}$`, 'i') } }
      ]
    }).sort({ createdAt: -1 }); // Most recent first

    if (!escrows || escrows.length === 0) {
      // Check if it's a contract address
      const contract = await Contract.findOne({
        address: { $regex: new RegExp(`^${normalizedAddress}$`, 'i') },
        status: 'deployed'
      });

      if (contract) {
        const replyMsg = await ctx.reply(
          `✅ Address verified\n\n` +
          `Token: ${contract.token}\n` +
          `Chain: ${contract.network}`,
          { parse_mode: 'HTML' }
        );
        
        // Delete user's command message and bot's response after 5 minutes
        const telegram = ctx.telegram;
        const commandMsgId = ctx.message.message_id;
        
        setTimeout(async () => {
          try {
            await telegram.deleteMessage(chatId, commandMsgId);
          } catch (e) {}
          try {
            await telegram.deleteMessage(chatId, replyMsg.message_id);
          } catch (e) {}
        }, 5 * 60 * 1000); // 5 minutes
        
        return;
      }

      const notFoundMsg = await ctx.reply(
        `⚠️ <b>WARNING: Address Not Verified</b>\n\n` +
        `❌ This address does <b>NOT</b> belong to this bot.\n\n` +
        `🚫 <b>DO NOT send funds to this address!</b>\n\n`,
        { parse_mode: 'HTML' }
      );
      
      // Delete user's command message and bot's response after 5 minutes
      const telegram = ctx.telegram;
      const commandMsgId = ctx.message.message_id;
      
      setTimeout(async () => {
        try {
          await telegram.deleteMessage(chatId, commandMsgId);
        } catch (e) {}
        try {
          await telegram.deleteMessage(chatId, notFoundMsg.message_id);
        } catch (e) {}
      }, 5 * 60 * 1000); // 5 minutes
      
      return;
    }

    // Get the most recent escrow
    const escrow = escrows[0];
    const token = escrow.token || 'USDT';
    const chain = escrow.chain || 'BSC';

    const replyMsg = await ctx.reply(
      `✅ Address verified\n\n` +
      `Token: ${token}\n` +
      `Chain: ${chain}`,
      { parse_mode: 'HTML' }
    );
    
    // Delete user's command message and bot's response after 5 minutes
    const telegram = ctx.telegram;
    const commandMsgId = ctx.message.message_id;
    
    setTimeout(async () => {
      try {
        await telegram.deleteMessage(chatId, commandMsgId);
      } catch (e) {}
      try {
        await telegram.deleteMessage(chatId, replyMsg.message_id);
      } catch (e) {}
    }, 5 * 60 * 1000); // 5 minutes

  } catch (error) {
    console.error('Error in verify handler:', error);
    ctx.reply('❌ An error occurred while verifying the address. Please try again.');
  }
};

