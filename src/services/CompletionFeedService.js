const config = require("../../config");
const Stats = require("../models/Stats");
const { formatParticipantById } = require("../utils/participant");
const UserStatsService = require("./UserStatsService");

class CompletionFeedService {
  constructor() {
    this.chatId = config.COMPLETION_FEED_CHAT_ID;
  }

  async handleCompletion({ escrow, amount, transactionHash, telegram }) {
    if (!this.chatId) {
      console.error(
        "CompletionFeedService: COMPLETION_FEED_CHAT_ID is not set in environment variables"
      );
      return;
    }

    if (!escrow) {
      console.error("CompletionFeedService: escrow object is missing");
      return;
    }

    if (!telegram) {
      console.error("CompletionFeedService: telegram object is missing");
      return;
    }

    const releaseAmount = Number(amount || 0);
    if (!Number.isFinite(releaseAmount) || releaseAmount <= 0) {
      console.error(`CompletionFeedService: Invalid release amount: ${amount}`);
      return;
    }

    const Escrow = require("../models/Escrow");
    const freshEscrow = await Escrow.findById(escrow._id || escrow.id);

    if (!freshEscrow) {
      console.error("CompletionFeedService: Escrow not found in database");
      return;
    }

    if (freshEscrow.completionLogSent) {
      console.log(
        `CompletionFeedService: Completion log already sent for escrow ${freshEscrow.escrowId}. Skipping duplicate.`
      );
      return;
    }

    if (transactionHash && freshEscrow.releaseTransactionHash) {
      if (
        freshEscrow.releaseTransactionHash.toLowerCase() ===
        transactionHash.toLowerCase()
      ) {
        if (freshEscrow.completionLogSent) {
          console.log(
            `CompletionFeedService: Completion log already sent for transaction ${transactionHash}. Skipping duplicate.`
          );
          return;
        }
      }
    }
    try {
      await telegram.getChat(this.chatId);
    } catch (chatError) {
      console.error(
        `CompletionFeedService: Cannot access chat ${this.chatId}. Error: ${chatError.message}`
      );
      console.error(`CompletionFeedService: Please ensure:`);
      console.error(
        `  1. The bot is added to the channel/group with ID: ${this.chatId}`
      );
      console.error(
        `  2. The bot has permission to send messages in that chat`
      );
      console.error(`  3. For channels, the bot must be an administrator`);
      console.error(
        `  4. The chat ID is correct (channels/groups use negative IDs like -1001234567890)`
      );
      return; // Don't attempt to send if we can't access the chat
    }

    const stats = await Stats.findOneAndUpdate(
      { key: "global" },
      {
        $setOnInsert: {
          key: "global",
        },
        $inc: {
          totalCompletedVolume: releaseAmount,
          totalCompletedTrades: 1,
        },
      },
      { upsert: true, new: true }
    );

    // Update user stats
    await UserStatsService.updateUserStats(freshEscrow);

    const newVolume = stats.totalCompletedVolume || 0;
    const newTrades = stats.totalCompletedTrades || 0;

    const buyerDisplay = formatParticipantById(
      freshEscrow,
      freshEscrow.buyerId,
      "Buyer",
      { html: true, mask: true }
    );
    const sellerDisplay = formatParticipantById(
      freshEscrow,
      freshEscrow.sellerId,
      "Seller",
      { html: true, mask: true }
    );

    const token = (freshEscrow.token || "USDT").toUpperCase();
    const network = (freshEscrow.chain || "BSC").toUpperCase();
    const explorerLink = this.getExplorerLink(
      network,
      transactionHash || freshEscrow.releaseTransactionHash
    );
    const amountDisplay = this.formatAmount(releaseAmount);
    const usdDisplay = this.formatAmount(
      this.estimateUsdValue(releaseAmount, freshEscrow)
    );
    const transactionLine = explorerLink
      ? `🔗 PROOF OF RELEASE: <a href="${explorerLink}">[Link]</a>`
      : "🔗 PROOF OF RELEASE: N/A";

    const message = `🚀 NEW DEAL LOCKED & RELEASED

PARTIES: ${buyerDisplay} & ${sellerDisplay}

🪙 Token: <code>${token}</code>
🌐 Chain: <code>${network}</code>
💰 Value: <code>${amountDisplay} ${token}</code>
📊 TVL Processed: <code>$${this.formatLargeNumber(newVolume)}</code>
🏆 Success Record: <code>${newTrades}</code>

${transactionLine}`;

    // Send DM to participants
    await this.sendDirectMessageNotification(
      freshEscrow,
      telegram,
      "completed",
      releaseAmount,
      transactionHash || freshEscrow.releaseTransactionHash
    );

    const withRetry = require("../utils/retry");
    try {
      await withRetry(() =>
        telegram.sendMessage(this.chatId, message, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        })
      );

      freshEscrow.completionLogSent = true;
      await freshEscrow.save();

      console.log(
        `CompletionFeedService: Successfully sent completion log for escrow ${freshEscrow.escrowId}`
      );
    } catch (error) {
      if (error.response && error.response.error_code === 400) {
        if (
          error.response.description &&
          error.response.description.includes("chat not found")
        ) {
          console.error(
            `CompletionFeedService: Chat ${this.chatId} not found. The bot may not be a member of this chat.`
          );
          console.error(
            `CompletionFeedService: Please add the bot to the channel/group or check the COMPLETION_FEED_CHAT_ID in your environment variables.`
          );
          console.error(
            `CompletionFeedService: For channels, ensure the bot is an administrator.`
          );
        } else if (
          error.response.description &&
          error.response.description.includes("not enough rights")
        ) {
          console.error(
            `CompletionFeedService: Bot doesn't have permission to send messages to chat ${this.chatId}`
          );
          console.error(
            `CompletionFeedService: Please grant the bot permission to send messages in the channel/group.`
          );
        } else {
          console.error(
            `CompletionFeedService: Bad Request (400): ${
              error.response.description || error.message
            }`
          );
        }
      } else {
        console.error(
          "CompletionFeedService: Failed to broadcast completion summary:",
          error
        );
        console.error("CompletionFeedService: Error details:", {
          message: error.message,
          code: error.code,
          response: error.response,
        });
      }
    }
  }

  formatAmount(value) {
    return Number(value || 0).toFixed(2);
  }

  estimateUsdValue(amount, escrow) {
    return Number(amount || 0);
  }

  formatLargeNumber(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) {
      return "0";
    }
    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(2)}B`;
    }
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(2)}K`;
    }
    return num.toFixed(2);
  }

  getExplorerLink(network, txHash) {
    if (!txHash) {
      return null;
    }
    const chain = (network || "").toUpperCase();
    if (chain === "BSC" || chain === "BNB") {
      return `https://bscscan.com/tx/${txHash}`;
    }
    if (chain === "ETH" || chain === "ETHEREUM") {
      return `https://etherscan.io/tx/${txHash}`;
    }
    if (chain === "POLYGON" || chain === "MATIC") {
      return `https://polygonscan.com/tx/${txHash}`;
    }
    if (chain === "TRON" || chain === "TRX") {
      return `https://tronscan.org/#/transaction/${txHash}`;
    }
    return `https://bscscan.com/tx/${txHash}`;
  }

  /**
   * Handle partial deposit logging
   * @param {Object} escrow - The escrow object
   * @param {number} partialAmount - The partial deposit amount
   * @param {string} transactionHash - The transaction hash
   * @param {Object} telegram - Telegram bot instance
   */
  async handlePartialDeposit({
    escrow,
    partialAmount,
    transactionHash,
    telegram,
  }) {
    if (!this.chatId) {
      return;
    }

    if (!escrow || !telegram) {
      return;
    }

    const amount = Number(partialAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const Escrow = require("../models/Escrow");
    const freshEscrow = await Escrow.findById(escrow._id || escrow.id);

    if (!freshEscrow) {
      return;
    }

    if (freshEscrow.partialDepositLogSent) {
      const existingHashes = [
        freshEscrow.transactionHash,
        ...(freshEscrow.partialTransactionHashes || []),
      ].filter(Boolean);

      if (
        transactionHash &&
        existingHashes.some(
          (h) => h.toLowerCase() === transactionHash.toLowerCase()
        )
      ) {
        return;
      }
    }

    const buyerDisplay = formatParticipantById(
      freshEscrow,
      freshEscrow.buyerId,
      "Buyer",
      { html: true, mask: true }
    );
    const sellerDisplay = formatParticipantById(
      freshEscrow,
      freshEscrow.sellerId,
      "Seller",
      { html: true, mask: true }
    );
    const token = (freshEscrow.token || "USDT").toUpperCase();
    const network = (freshEscrow.chain || "BSC").toUpperCase();
    const explorerLink = this.getExplorerLink(network, transactionHash);
    const amountDisplay = this.formatAmount(amount);
    const expectedAmount = freshEscrow.quantity || 0;
    const remainingAmount = Math.max(
      0,
      expectedAmount - (freshEscrow.accumulatedDepositAmount || 0)
    );

    const transactionLine = explorerLink
      ? `🔗 Transaction: <a href="${explorerLink}">Link</a>`
      : transactionHash
      ? `🔗 Transaction: <code>${transactionHash.substring(0, 10)}...</code>`
      : "";

    /* 
    // Partial deposit logging disabled by user request
    const message = `💰<b>PARTIAL DEPOSIT RECEIVED</b>

⚡️ Buyer: ${buyerDisplay}
⚡️ Seller: ${sellerDisplay}
✅ CRYPTO: ${token}
✅ NETWORK: ${network}
🪙 Partial Amount: ${amountDisplay} ${token}
📊 Expected: ${this.formatAmount(expectedAmount)} ${token}
📊 Remaining: ${this.formatAmount(remainingAmount)} ${token}
${transactionLine}`;

    const withRetry = require("../utils/retry");
    try {
      await withRetry(() =>
        telegram.sendMessage(this.chatId, message, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        })
      );

      freshEscrow.partialDepositLogSent = true;
      await freshEscrow.save();

      console.log(
        `CompletionFeedService: Successfully sent partial deposit log for escrow ${freshEscrow.escrowId}`
      );
    } catch (error) {
      console.error(
        "CompletionFeedService: Failed to send partial deposit log:",
        error.message
      );
    }
    */
  }

  /**
   * Handle refund logging
   * @param {Object} escrow - The escrow object
   * @param {number} refundAmount - The refund amount
   * @param {string} transactionHash - The transaction hash
   * @param {Object} telegram - Telegram bot instance
   */
  async handleRefund({ escrow, refundAmount, transactionHash, telegram }) {
    if (!this.chatId) {
      return;
    }

    if (!escrow || !telegram) {
      return;
    }

    const amount = Number(refundAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const Escrow = require("../models/Escrow");
    const freshEscrow = await Escrow.findById(escrow._id || escrow.id);

    if (!freshEscrow) {
      return;
    }

    if (freshEscrow.refundLogSent) {
      if (
        transactionHash &&
        freshEscrow.refundTransactionHash &&
        freshEscrow.refundTransactionHash.toLowerCase() ===
          transactionHash.toLowerCase()
      ) {
        return;
      }
    }

    const buyerDisplay = formatParticipantById(
      freshEscrow,
      freshEscrow.buyerId,
      "Buyer",
      { html: true, mask: true }
    );
    const sellerDisplay = formatParticipantById(
      freshEscrow,
      freshEscrow.sellerId,
      "Seller",
      { html: true, mask: true }
    );
    const token = (freshEscrow.token || "USDT").toUpperCase();
    const network = (freshEscrow.chain || "BSC").toUpperCase();
    const explorerLink = this.getExplorerLink(network, transactionHash);
    const amountDisplay = this.formatAmount(amount);

    // Determine if full or partial
    // If refund amount >= total confirmed amount, it's a full refund
    const totalDeposited =
      freshEscrow.accumulatedDepositAmount ||
      freshEscrow.depositAmount ||
      freshEscrow.confirmedAmount ||
      0;
    const isFullRefund = amount >= totalDeposited - 0.01;
    const typeText = isFullRefund ? "FULL REFUND" : "PARTIAL REFUND";
    const statusEmoji = isFullRefund ? "🔄" : "⚠️";

    const transactionLine = explorerLink
      ? `🔗 Transaction: <a href="${explorerLink}">Link</a>`
      : transactionHash
      ? `🔗 Transaction: <code>${transactionHash.substring(0, 10)}...</code>`
      : "";

    // Update global stats
    const stats = await Stats.findOneAndUpdate(
      { key: "global" },
      {
        $setOnInsert: {
          key: "global",
        },
        $inc: {
          totalRefundedVolume: amount,
          totalRefundedTrades: 1,
        },
      },
      { upsert: true, new: true }
    );

    const newRefundedVolume = stats.totalRefundedVolume || 0;

    const message = `${statusEmoji} <b>TRADE ${typeText}</b>

PARTIES: ${buyerDisplay} & ${sellerDisplay}

🪙 Token: <code>${token}</code>
🌐 Chain: <code>${network}</code>
💰 Refunded: <code>${amountDisplay} ${token}</code>
💸 Total Refunded: <code>$${this.formatLargeNumber(newRefundedVolume)}</code>
${transactionLine}`;

    // Send DM to participants
    await this.sendDirectMessageNotification(
      freshEscrow,
      telegram,
      isFullRefund ? "refunded" : "partial_refund",
      amount,
      transactionHash
    );

    const withRetry = require("../utils/retry");
    try {
      await withRetry(() =>
        telegram.sendMessage(this.chatId, message, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        })
      );

      freshEscrow.refundLogSent = true;
      if (transactionHash) {
        freshEscrow.refundTransactionHash = transactionHash;
      }
      await freshEscrow.save();

      console.log(
        `CompletionFeedService: Successfully sent refund log for escrow ${freshEscrow.escrowId}`
      );
    } catch (error) {
      console.error(
        "CompletionFeedService: Failed to send refund log:",
        error.message
      );
    }
  }

  async sendDirectMessageNotification(
    escrow,
    telegram,
    type, // "completed" | "refunded" | "partial_deposit" | "partial_refund"
    amount,
    transactionHash,
    extraData = {} // For additional context like remaining amount
  ) {
    if (!escrow || !telegram) return;

    // Use fresh escrow data
    const Escrow = require("../models/Escrow");
    const freshEscrow =
      (await Escrow.findById(escrow._id || escrow.id)) || escrow;

    const buyerId = freshEscrow.buyerId;
    const sellerId = freshEscrow.sellerId;
    const token = (freshEscrow.token || "USDT").toUpperCase();
    const network = (freshEscrow.chain || "BSC").toUpperCase();
    const amountDisplay = this.formatAmount(amount);

    let titleIcon = "ℹ️";
    let titleText = "Trade Update";
    let messageBody = "";

    // Determine specific message content based on type
    // Common details
    const rate = freshEscrow.rate || 0;
    const paymentMethod = freshEscrow.paymentMethod || "N/A";
    const dealAmount = freshEscrow.quantity || 0;

    if (type === "completed") {
      titleIcon = "✅";
      titleText = "TRADE COMPLETED SUCCESSFULLY";

      const networkFee = freshEscrow.networkFee || 0;
      const serviceFeePercent = freshEscrow.feeRate || 0;
      const serviceFee = (dealAmount * serviceFeePercent) / 100;

      messageBody = `
💰 <b>Released Amount:</b> ${amountDisplay} ${token}
💵 <b>Deal Amount:</b> ${this.formatAmount(dealAmount)} ${token}
📊 <b>Rate:</b> ₹${rate}
💳 <b>Payment Method:</b> ${paymentMethod}
🛡 <b>Network Fee:</b> ${networkFee} ${token}
🤝 <b>Service Fee:</b> ${this.formatAmount(
        serviceFee
      )} ${token} (${serviceFeePercent}%)
🌐 <b>Chain:</b> ${network}
🔗 <b>Transaction:</b> <code>${transactionHash || "N/A"}</code>

The funds have been released to the buyer. Thank you for using our escrow service!`;
    } else if (type === "refunded" || type === "partial_refund") {
      titleIcon = type === "refunded" ? "🔄" : "⚠️";
      titleText = type === "refunded" ? "TRADE REFUNDED" : "PARTIAL REFUND";
      messageBody = `
💰 <b>Refunded Amount:</b> ${amountDisplay} ${token}
💵 <b>Original Deal Amount:</b> ${this.formatAmount(dealAmount)} ${token}
📊 <b>Rate:</b> ₹${rate}
💳 <b>Payment Method:</b> ${paymentMethod}
🌐 <b>Chain:</b> ${network}
🔗 <b>Transaction:</b> <code>${transactionHash || "N/A"}</code>

The funds have been refunded to the seller.`;
    }

    const fullMessage = `${titleIcon} <b>${titleText}</b>

<b>Trade ID:</b> ${freshEscrow.escrowId}
${messageBody}`;

    const sendToUser = async (userId) => {
      if (!userId) return;
      try {
        await telegram.sendMessage(userId, fullMessage, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      } catch (error) {
        // Ignore if bot can't initiate convo with user or blocked
        console.log(
          `CompletionFeedService: Could not DM user ${userId}: ${error.message}`
        );
      }
    };

    // Send to both parties
    if (buyerId) await sendToUser(buyerId);
    if (sellerId) await sendToUser(sellerId);
  }

  escapeHtml(text = "") {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

module.exports = new CompletionFeedService();
