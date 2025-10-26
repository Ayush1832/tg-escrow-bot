const { Markup } = require("telegraf");
const Escrow = require("../models/Escrow");
const DepositAddress = require("../models/DepositAddress");
const WalletService = require("../services/WalletService");
const AddressAssignmentService = require("../services/AddressAssignmentService");
const TradeTimeoutService = require("../services/TradeTimeoutService");
const config = require("../../config");

module.exports = async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;

    // Check if user is in a group
    if (chatId > 0) {
      return ctx.reply("❌ This command can only be used in a group chat.");
    }

    // Find active escrow in this group
    const escrow = await Escrow.findOne({
      groupId: chatId.toString(),
      status: {
        $in: [
          "awaiting_deposit",
          "deposited",
          "in_fiat_transfer",
          "ready_to_release",
          "disputed",
        ],
      },
    });

    if (!escrow) {
      return ctx.reply(
        "❌ No active escrow found in this group. Please complete the setup first."
      );
    }

    if (escrow.status !== "awaiting_deposit") {
      return ctx.reply(
        "⚠️ Deposit address has already been generated for this escrow."
      );
    }

    await ctx.reply("Requesting a deposit address for you, please wait...");

    // Use new address assignment system
    try {
      const addressInfo = await AddressAssignmentService.assignDepositAddress(
        escrow.escrowId,
        escrow.token,
        escrow.chain.toUpperCase(),
        escrow.quantity,
        Number(config.ESCROW_FEE_PERCENT || 0)
      );

      const address = addressInfo.address;
      const contractAddress = addressInfo.contractAddress;
      const sharedWithAmount = addressInfo.sharedWithAmount;

      // Update escrow with unique deposit address
      escrow.uniqueDepositAddress = address;
      escrow.depositAddress = address; // Keep for backward compatibility
      escrow.status = "awaiting_deposit";
      await escrow.save();

      // Set trade timeout (1 hour) AFTER escrow is updated
      await TradeTimeoutService.setTradeTimeout(escrow.escrowId, ctx.telegram);

      // Show sharing information if applicable
      if (sharedWithAmount) {
        await ctx.reply(
          `ℹ️ This address is shared with another trade (${sharedWithAmount} ${escrow.token}). Different amounts can share the same address.`
        );
      }

    } catch (addressError) {
      // Handle address assignment errors
      if (addressError.message.includes('already exists')) {
        return ctx.reply(
          `❌ ${addressError.message}\n\nPlease try with a different amount.`
        );
      }
      
      if (addressError.message.includes('No available addresses')) {
        return ctx.reply(
          `❌ ${addressError.message}\n\nPlease try again later or contact admin.`
        );
      }
      
      console.error('Address assignment error:', addressError);
      return ctx.reply(
        `❌ Error assigning deposit address: ${addressError.message}`
      );
    }

    const feeText = `
Note: The default fee is ${config.ESCROW_FEE_PERCENT}%, which is applied when funds are released.
    `;

    await ctx.reply(feeText);

    const buyerTag = escrow.buyerUsername
      ? `@${escrow.buyerUsername}`
      : escrow.buyerId
      ? `[${escrow.buyerId}]`
      : "N/A";

    const amountDisplay =
      typeof escrow.quantity === "number" && isFinite(escrow.quantity)
        ? escrow.quantity.toFixed(2)
        : "N/A";

    const depositText = `
📍 *TRANSACTION INFORMATION [${escrow.escrowId.slice(-8)}]*

⚡️ *BUYER*
${buyerTag} | [${escrow.buyerId || "N/A"}]
${escrow.buyerAddress || ""}

🟢 *ESCROW ADDRESS*
 ${address}

Deposit the required amount to the Escrow Address, And Click On Check Payment.

Amount to be Received: [$${amountDisplay}]

⏰ Trade Start Time: ${new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}
⏰ Trade Timeout: 1 hour (automatic group recycling if abandoned)

📄 Note: Trade will timeout in 1 hour if not completed. Deposit address will be released after timeout.
⚠️ *CRITICAL TOKEN/NETWORK WARNING*
• Send ONLY *${escrow.token}* on *${escrow.chain}* to this address.
• ❌ Do NOT send any other token (e.g., USDC/BNB/ETH) or from another network.
• Wrong token deposits will NOT be credited to this trade.
• If a wrong token is sent, contact admin. Funds may require a manual sweep.
⚠️ *IMPORTANT:* Make sure to finalise and agree each-others terms before depositing.

Remember, once commands are used payment will be released, there is no revert!
    `;

    await ctx.reply(depositText, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ I have deposited to escrow address",
              callback_data: "check_deposit",
            },
          ],
          [{ text: `📋 ${address}`, copy_text: { text: address } }],
        ],
      },
    });

  } catch (error) {
    console.error("Error in deposit handler:", error);
    ctx.reply(
      "❌ An error occurred while generating deposit address. Please try again."
    );
  }
};
