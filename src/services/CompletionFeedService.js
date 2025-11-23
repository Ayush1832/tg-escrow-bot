const config = require('../../config');
const Stats = require('../models/Stats');
const { formatParticipantById } = require('../utils/participant');

class CompletionFeedService {
  constructor() {
    this.chatId = config.COMPLETION_FEED_CHAT_ID;
  }

  async handleCompletion({ escrow, amount, transactionHash, telegram }) {
    if (!this.chatId || !escrow || !telegram) {
      return;
    }

    const releaseAmount = Number(amount || 0);
    if (!Number.isFinite(releaseAmount) || releaseAmount <= 0) {
      return;
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
      ? `🔗 Transaction Link: <a href="${explorerLink}">Link</a> (${this.escapeHtml(explorerLink)})`
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
      await telegram.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });
    } catch (error) {
      console.error('Failed to broadcast completion summary:', error);
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

