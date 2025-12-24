const User = require("../models/User");

class UserStatsService {
  /**
   * Get user stats with global ranks
   * @param {Object} params - { telegramId, username }
   */
  async getUserStats({ telegramId, username }) {
    let user = null;

    if (telegramId) {
      user = await User.findOne({ telegramId: Number(telegramId) });
    } else if (username) {
      // Case-insensitive username search
      const users = await User.find({
        username: { $regex: new RegExp(`^${username}$`, "i") },
      })
        .sort({ lastActive: -1 })
        .limit(1);
      user = users[0];
    }

    if (!user) {
      return null;
    }

    // Calculate ranks
    // Rank is (number of users with higher value) + 1
    // We handle null/undefined values as 0
    const [buyRank, sellRank, overallRank] = await Promise.all([
      User.countDocuments({
        totalBoughtVolume: { $gt: user.totalBoughtVolume || 0 },
      }),
      User.countDocuments({
        totalSoldVolume: { $gt: user.totalSoldVolume || 0 },
      }),
      User.countDocuments({
        totalTradedVolume: { $gt: user.totalTradedVolume || 0 },
      }),
    ]);

    // Convert to object to attach ranks
    const userObj = user.toObject();
    userObj.globalBuyRank = buyRank + 1;
    userObj.globalSellRank = sellRank + 1;
    userObj.overallGlobalRank = overallRank + 1;

    return userObj;
  }

  /**
   * Format stats message
   * @param {Object} user - User stats object
   */
  formatStatsMessage(user) {
    if (!user) {
      return "❌ User stats not found.";
    }

    const formatCurrency = (amount) => {
      return (amount || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    };

    const usernameDisplay = user.username
      ? `@${user.username}`
      : `User ${user.telegramId}`;

    // Buying Stats
    const totalBought = formatCurrency(user.totalBoughtVolume);
    const totalBuyTrades = user.totalBoughtTrades || 0;
    const buyRank = user.globalBuyRank || "N/A";

    // Selling Stats
    const totalSold = formatCurrency(user.totalSoldVolume);
    const totalSellTrades = user.totalSoldTrades || 0;
    const sellRank = user.globalSellRank || "N/A";

    // Overall Performance
    const lifetimeVolume = formatCurrency(user.totalTradedVolume);
    const totalDeals = user.totalCompletedTrades || 0;
    const totalParticipated = user.totalParticipatedTrades || 0;

    // Calculate completion rate
    // If participated is 0, rate is 0%. If completed > participated (shouldn't happen), cap at 100%?
    // Let's assume data is correct.
    let completionRate = 0;
    if (totalParticipated > 0) {
      completionRate = (totalDeals / totalParticipated) * 100;
    }
    const completionRateStr = `${completionRate.toFixed(1)}%`;
    const overallRank = user.overallGlobalRank || "N/A";

    // Last Trade
    let lastTradeSection = "";
    if (user.lastTradeAmount && user.lastTradeRole) {
      const isBuy = user.lastTradeRole === "buyer";
      const roleIcon = isBuy ? "🟢" : "🔻";
      const roleName = isBuy ? "Bought" : "Sold";
      const amount = formatCurrency(user.lastTradeAmount);
      const token = user.lastTradeToken || "USDT";

      const counterparty = user.lastTradeCounterparty
        ? user.lastTradeCounterparty.startsWith("@")
          ? user.lastTradeCounterparty
          : `@${user.lastTradeCounterparty}`
        : "N/A";

      let dateStr = "N/A";
      if (user.lastTradeAt) {
        const d = new Date(user.lastTradeAt);
        const day = d.getDate();
        const month = d.toLocaleString("en-US", { month: "short" });
        const time = d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }); // 17:16
        dateStr = `${day} ${month}, ${time}`;
      }

      lastTradeSection = `
⏱ LAST TRADE
${roleIcon} ${roleName} <code>${amount} ${token}</code>
👤 With: ${counterparty}
📅 <code>${dateStr}</code>`;
    }

    return `📊 PERSONAL TRADING STATS — ${usernameDisplay}

🟢 BUYING STATS
• Total Bought: <code>${totalBought} USDT</code>
• Total Buy Trades: <code>${totalBuyTrades}</code>
🏅 Global Buy Rank: <code>#${buyRank} Buyer</code>

🔴 SELLING STATS
• Total Sold: <code>${totalSold} USDT</code>
• Total Sell Trades: <code>${totalSellTrades}</code>
🥇 Global Sell Rank: <code>#${sellRank} Seller</code>

📈 OVERALL PERFORMANCE
• Lifetime Volume: <code>${lifetimeVolume} USDT</code>
• Total Deals: <code>${totalDeals}</code>
• Completion Rate: <code>${completionRateStr} (${totalDeals} / ${totalParticipated})</code>
🏆 Overall Global Rank: <code>#${overallRank} Trader</code>${lastTradeSection}`;
  }

  /**
   * Get leaderboard (top traders by volume)
   */
  async getLeaderboard(limit = 10) {
    return User.find({ totalTradedVolume: { $gt: 0 } })
      .sort({ totalTradedVolume: -1 })
      .limit(limit);
  }

  /**
   * Get top buyers and sellers
   */
  async getTopBuyersAndSellers(limit = 3) {
    const topBuyers = await User.find({ totalBoughtVolume: { $gt: 0 } })
      .sort({ totalBoughtVolume: -1 })
      .limit(limit);

    const topSellers = await User.find({ totalSoldVolume: { $gt: 0 } })
      .sort({ totalSoldVolume: -1 })
      .limit(limit);

    return { topBuyers, topSellers };
  }

  /**
   * Format leaderboard message
   */
  formatLeaderboard(topUsers, { topBuyers, topSellers }) {
    // Basic implementation to prevent crash
    const formatCurrency = (val) =>
      Number(val || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    let message = "🏆 <b>TRADING LEADERBOARD</b>\n\n";

    message += "📈 <b>Top Traders (Volume)</b>\n";
    topUsers.forEach((u, i) => {
      const name = u.username ? `@${u.username}` : `ID:${u.telegramId}`;
      message += `${i + 1}. ${name} - $${formatCurrency(
        u.totalTradedVolume
      )}\n`;
    });

    return message;
  }

  /**
   * Update user stats after a completed trade
   * @param {Object} escrow - The completed escrow object
   */
  async updateUserStats(escrow) {
    if (!escrow || !escrow.buyerId || !escrow.sellerId) {
      return;
    }

    const {
      buyerId,
      sellerId,
      buyerUsername,
      sellerUsername,
      quantity,
      token,
      escrowId,
    } = escrow;

    const amount = Number(quantity || 0);
    const tradeDate = new Date();

    await User.findOneAndUpdate(
      { telegramId: Number(buyerId) },
      {
        $setOnInsert: {
          telegramId: Number(buyerId),
          username: buyerUsername || `user_${buyerId}`,
        },
        $inc: {
          totalBoughtVolume: amount,
          totalTradedVolume: amount,
          totalBoughtTrades: 1,
          totalParticipatedTrades: 1,
          totalCompletedTrades: 1,
        },
        $set: {
          lastActive: tradeDate,
          lastTradeAt: tradeDate,
          lastTradeRole: "buyer",
          lastTradeAmount: amount,
          lastTradeToken: token,
          lastTradeEscrowId: escrowId,
          lastTradeCounterparty: sellerUsername
            ? `@${sellerUsername}`
            : `User ${sellerId}`,
        },
      },
      { upsert: true }
    );

    await User.findOneAndUpdate(
      { telegramId: Number(sellerId) },
      {
        $setOnInsert: {
          telegramId: Number(sellerId),
          username: sellerUsername || `user_${sellerId}`,
        },
        $inc: {
          totalSoldVolume: amount,
          totalTradedVolume: amount,
          totalSoldTrades: 1,
          totalParticipatedTrades: 1,
          totalCompletedTrades: 1,
        },
        $set: {
          lastActive: tradeDate,
          lastTradeAt: tradeDate,
          lastTradeRole: "seller",
          lastTradeAmount: amount,
          lastTradeToken: token,
          lastTradeEscrowId: escrowId,
          lastTradeCounterparty: buyerUsername
            ? `@${buyerUsername}`
            : `User ${buyerId}`,
        },
      },
      { upsert: true }
    );
  }

  async recordTrade(escrow) {
    return this.updateUserStats(escrow);
  }
}

module.exports = new UserStatsService();
