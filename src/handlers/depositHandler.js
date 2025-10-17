const { Markup } = require('telegraf');
const Escrow = require('../models/Escrow');
const DepositAddress = require('../models/DepositAddress');
const WalletService = require('../services/WalletService');
const Event = require('../models/Event');
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
      status: { $in: ['awaiting_deposit', 'deposited', 'in_fiat_transfer', 'ready_to_release', 'disputed'] }
    });

    if (!escrow) {
      return ctx.reply('❌ No active escrow found in this group. Please complete the setup first.');
    }

    if (escrow.status !== 'awaiting_deposit') {
      return ctx.reply('⚠️ Deposit address has already been generated for this escrow.');
    }

    await ctx.reply('Requesting a deposit address for you, please wait...');

    // Generate deposit address
    // Use on-chain vault address as deposit address for the selected token-network pair
    const Contract = require('../models/Contract');
    const vault = await Contract.findOne({ 
      name: 'EscrowVault',
      token: escrow.token,
      network: escrow.chain.toUpperCase()
    });
    if (!vault) {
      return ctx.reply(`❌ Escrow vault not deployed for ${escrow.token} on ${escrow.chain}. Please contact admin to deploy the contract first.`);
    }
    const address = vault.address;
    const derivationPath = 'vault';
    
    // Calculate expiry time
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + config.DEPOSIT_ADDRESS_TTL_MINUTES);

    // Save or update deposit address (vault address can be reused)
    // First, try to remove any existing unique index on address
    try {
      await DepositAddress.collection.dropIndex('address_1');
    } catch (e) {
      // Index might not exist, ignore error
    }
    
    await DepositAddress.updateOne(
      { escrowId: escrow.escrowId },
      {
        escrowId: escrow.escrowId,
        address,
        derivationPath,
        expiresAt,
        status: 'active',
        observedAmount: 0
      },
      { upsert: true }
    );

    // Update escrow
    escrow.depositAddress = address;
    escrow.status = 'awaiting_deposit';
    await escrow.save();

    const feeText = `
Note: The default fee is ${config.ESCROW_FEE_PERCENT}%, which is applied when funds are released.
    `;

    await ctx.reply(feeText);

    const sellerTag = escrow.sellerUsername ? `@${escrow.sellerUsername}` : (escrow.sellerId ? `[${escrow.sellerId}]` : 'N/A');
    const buyerTag = escrow.buyerUsername ? `@${escrow.buyerUsername}` : (escrow.buyerId ? `[${escrow.buyerId}]` : 'N/A');

    const amountDisplay = typeof escrow.quantity === 'number' && isFinite(escrow.quantity)
      ? escrow.quantity.toFixed(2)
      : 'N/A';

    const depositText = `
📍 *TRANSACTION INFORMATION [${escrow.escrowId.slice(-8)}]*

⚡️ *SELLER*
${sellerTag} | [${escrow.sellerId || 'N/A'}]
${escrow.sellerAddress ? `${escrow.sellerAddress} [${escrow.token}] [${escrow.chain}]` : ''}

⚡️ *BUYER*
${buyerTag} | [${escrow.buyerId || 'N/A'}]
${escrow.buyerAddress ? `${escrow.buyerAddress} [${escrow.token}] [${escrow.chain}]` : ''}

🟢 *ESCROW ADDRESS*
${address} [${escrow.token}] [${escrow.chain}]

Seller ${sellerTag} Will Pay on the Escrow Address, And Click On Check Payment.

Amount to be Received: [$${amountDisplay}]

⏰ Trade Start Time: ${new Date().toLocaleString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    })}
⏰ Address Reset In: ${config.DEPOSIT_ADDRESS_TTL_MINUTES}.00 Min

📄 Note: Address will reset after the given time, so make sure to deposit in the bot before the address expires.
⚠️ *CRITICAL TOKEN/NETWORK WARNING*
• Send ONLY *${escrow.token}* on *${escrow.chain}* to this address.
• ❌ Do NOT send any other token (e.g., USDC/BNB/ETH) or from another network.
• Wrong token deposits will NOT be credited to this trade.
• If a wrong token is sent, contact admin. Funds may require a manual sweep.
⚠️ *IMPORTANT:* Make sure to finalise and agree each-others terms before depositing.

*Useful commands:*
🗒 /release = Always pays the buyer.
🗒 /refund = Always pays the seller.

Remember, once commands are used payment will be released, there is no revert!
    `;

    await ctx.reply(depositText, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ I have deposited to escrow address', callback_data: 'check_deposit' }
          ],
          [
            { text: '📋 Copy Address', copy_text: { text: address } }
          ]
        ]
      }
    });

    // Log event
    await new Event({
      escrowId: escrow.escrowId,
      actorId: userId,
      action: 'deposit_address_generated',
      payload: { address, expiresAt }
    }).save();

  } catch (error) {
    console.error('Error in deposit handler:', error);
    ctx.reply('❌ An error occurred while generating deposit address. Please try again.');
  }
};
