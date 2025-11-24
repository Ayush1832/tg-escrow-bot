const config = require('../../config');
const Stats = require('../models/Stats');
const { formatParticipantById } = require('../utils/participant');

class CompletionFeedService {
  constructor() {
    this.chatId = config.COMPLETION_FEED_CHAT_ID;
  }

  async handleCompletion({ escrow, amount, transactionHash, telegram }) {
    if (!this.chatId) {
      console.error('CompletionFeedService: COMPLETION_FEED_CHAT_ID is not set in environment variables');
      return;
    }
    
    if (!escrow) {
      console.error('CompletionFeedService: escrow object is missing');
      return;
    }
    
    if (!telegram) {
      console.error('CompletionFeedService: telegram object is missing');
      return;
    }

    const releaseAmount = Number(amount || 0);
    if (!Number.isFinite(releaseAmount) || releaseAmount <= 0) {
      console.error(`CompletionFeedService: Invalid release amount: ${amount}`);
      return;
    }
    
    console.log(`CompletionFeedService: Attempting to send completion feed for escrow ${escrow.escrowId}, amount: ${releaseAmount}, chatId: ${this.chatId}`);
    
    // Validate chat access before attempting to send
    try {
      await telegram.getChat(this.chatId);
      console.log(`CompletionFeedService: Chat ${this.chatId} is accessible`);
    } catch (chatError) {
      console.error(`CompletionFeedService: Cannot access chat ${this.chatId}. Error: ${chatError.message}`);
      console.error(`CompletionFeedService: Please ensure:`);
      console.error(`  1. The bot is added to the channel/group with ID: ${this.chatId}`);
      console.error(`  2. The bot has permission to send messages in that chat`);
      console.error(`  3. For channels, the bot must be an administrator`);
      console.error(`  4. The chat ID is correct (channels/groups use negative IDs like -1001234567890)`);
      return; // Don't attempt to send if we can't access the chat
    }

    const stats = await Stats.findOneAndUpdate(
      { key: 'global' },
      {
        $setOnInsert: {
          key: 'global'
        },
        $inc: {
          totalCompletedVolume: releaseAmount,
          totalCompletedTrades: 1
        }
      },
      { upsert: true, new: true }
    );

    const newVolume = stats.totalCompletedVolume || 0;
    const newTrades = stats.totalCompletedTrades || 0;
    const previousVolume = Math.max(0, newVolume - releaseAmount);
    const previousTrades = Math.max(0, newTrades - 1);

    const buyerDisplay = formatParticipantById(escrow, escrow.buyerId, 'Buyer', { html: true, mask: true });
    const sellerDisplay = formatParticipantById(escrow, escrow.sellerId, 'Seller', { html: true, mask: true });

    const token = (escrow.token || 'USDT').toUpperCase();
    const network = (escrow.chain || 'BSC').toUpperCase();
    const explorerLink = this.getExplorerLink(network, transactionHash || escrow.releaseTransactionHash);
    const amountDisplay = this.formatAmount(releaseAmount);
    const usdDisplay = this.formatAmount(this.estimateUsdValue(releaseAmount, escrow));
    const totalWorthLine = `${this.formatLargeNumber(previousVolume)}$ >> ${this.formatLargeNumber(newVolume)}$`;
    const totalEscrowsLine = `${newTrades}`;

    const transactionLine = explorerLink
      ? `🔗 Transaction Link: <a href="${explorerLink}">Link</a>`
      : '🔗 Transaction Link: N/A';

    const message = `📍<b>NEW ESCROW DONE</b>

⚡️ Buyer: ${buyerDisplay}
⚡️ Seller: ${sellerDisplay}
✅ CRYPTO: ${token}
✅ NETWORK: ${network}
🪙 AMOUNT: ${amountDisplay}${token} [${usdDisplay}$]
📈 Total Worth: ${totalWorthLine}
📈 Total Escrows: ${totalEscrowsLine}
${transactionLine}`;

    try {
      console.log(`CompletionFeedService: Sending message to chat ${this.chatId}`);
      await telegram.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });
      console.log(`CompletionFeedService: Successfully sent completion feed message`);
    } catch (error) {
      // Handle specific Telegram errors
      if (error.response && error.response.error_code === 400) {
        if (error.response.description && error.response.description.includes('chat not found')) {
          console.error(`CompletionFeedService: Chat ${this.chatId} not found. The bot may not be a member of this chat.`);
          console.error(`CompletionFeedService: Please add the bot to the channel/group or check the COMPLETION_FEED_CHAT_ID in your environment variables.`);
          console.error(`CompletionFeedService: For channels, ensure the bot is an administrator.`);
        } else if (error.response.description && error.response.description.includes('not enough rights')) {
          console.error(`CompletionFeedService: Bot doesn't have permission to send messages to chat ${this.chatId}`);
          console.error(`CompletionFeedService: Please grant the bot permission to send messages in the channel/group.`);
        } else {
          console.error(`CompletionFeedService: Bad Request (400): ${error.response.description || error.message}`);
        }
      } else {
        console.error('CompletionFeedService: Failed to broadcast completion summary:', error);
        console.error('CompletionFeedService: Error details:', {
          message: error.message,
          code: error.code,
          response: error.response
        });
      }
      // Don't throw - we want the trade completion to succeed even if the feed fails
    }
  }

  formatAmount(value) {
    return Number(value || 0).toFixed(2);
  }

  estimateUsdValue(amount, escrow) {
    // If we have a USD rate in the future, calculate here. For stablecoins treat 1:1
    return Number(amount || 0);
  }

  formatLargeNumber(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) {
      return '0';
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
    const chain = (network || '').toUpperCase();
    if (chain === 'BSC' || chain === 'BNB') {
      return `https://bscscan.com/tx/${txHash}`;
    }
    if (chain === 'ETH' || chain === 'ETHEREUM') {
      return `https://etherscan.io/tx/${txHash}`;
    }
    if (chain === 'POLYGON' || chain === 'MATIC') {
      return `https://polygonscan.com/tx/${txHash}`;
    }
    return `https://bscscan.com/tx/${txHash}`;
  }

  escapeHtml(text = '') {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

module.exports = new CompletionFeedService();

