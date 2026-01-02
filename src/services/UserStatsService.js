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

    const totalBought = formatCurrency(user.totalBoughtVolume);
    const totalBuyTrades = user.totalBoughtTrades || 0;
    const buyRank = user.globalBuyRank || "N/A";

    const totalSold = formatCurrency(user.totalSoldVolume);
    const totalSellTrades = user.totalSoldTrades || 0;
    const sellRank = user.globalSellRank || "N/A";

    const lifetimeVolume = formatCurrency(user.totalTradedVolume);
    const totalDeals = user.totalCompletedTrades || 0;
    const totalParticipated = user.totalParticipatedTrades || 0;

    let completionRate = 0;
    if (totalParticipated > 0) {
      completionRate = (totalDeals / totalParticipated) * 100;
    }
    const completionRateStr = `${completionRate.toFixed(1)}%`;
    const overallRank = user.overallGlobalRank || "N/A";

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
        });
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
   * Get high level stats for main leaderboard
   */
  async getHighLevelStats() {
    const Escrow = require("../models/Escrow");

    // Top 5 Traders by Volume
    const topTraders = await User.find({ totalTradedVolume: { $gt: 0 } })
      .sort({ totalTradedVolume: -1 })
      .limit(5);

    // Highest Deal
    const highestDeal = await Escrow.findOne({ status: "completed" })
      .sort({ quantity: -1 })
      .select("quantity token buyerUsername sellerUsername");

    // Shortest Deal (Aggregation)
    const shortestDealAgg = await Escrow.aggregate([
      {
        $match: {
          status: "completed",
          tradeStartTime: { $exists: true, $ne: null },
        },
      },
      {
        $addFields: {
          duration: { $subtract: ["$updatedAt", "$tradeStartTime"] },
        },
      },
      { $match: { duration: { $gt: 0 } } },
      { $sort: { duration: 1 } }, // Ascending (shortest)
      { $limit: 1 },
      {
        $project: {
          duration: 1,
          quantity: 1,
          token: 1,
          buyerUsername: 1,
          sellerUsername: 1,
        },
      },
    ]);

    // Longest Deal (Aggregation)
    const longestDealAgg = await Escrow.aggregate([
      {
        $match: {
          status: "completed",
          tradeStartTime: { $exists: true, $ne: null },
        },
      },
      {
        $addFields: {
          duration: { $subtract: ["$updatedAt", "$tradeStartTime"] },
        },
      },
      { $sort: { duration: -1 } }, // Descending (longest)
      { $limit: 1 },
      {
        $project: {
          duration: 1,
          quantity: 1,
          token: 1,
          buyerUsername: 1,
          sellerUsername: 1,
        },
      },
    ]);

    return {
      topTraders,
      highestDeal,
      shortest: shortestDealAgg[0],
      longest: longestDealAgg[0],
    };
  }

  formatDuration(ms) {
    if (!ms) return "N/A";
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 && days === 0) parts.push(`${seconds}s`); // Only show seconds if duration is short

    return parts.join(" ") || "0s";
  }

  formatMainLeaderboard({ topTraders, highestDeal, shortest, longest }) {
    const formatCurrency = (val) =>
      Number(val || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const medals = ["🥇", "🥈", "🥉", "🏅", "🏅"];

    let msg = "🌍 <b>LEADERBOARDS</b>\n\n";
    msg += "🏆 <b>TOP TRADERS — OVERALL VOLUME</b>\n";

    if (topTraders.length === 0) {
      msg += "<i>No trades yet.</i>\n";
    } else {
      topTraders.forEach((u, i) => {
        const icon = medals[i] || "🏅";
        const name = u.username ? `@${u.username}` : `User ${u.telegramId}`;
        msg += `${icon} #${i + 1} ${name} — ${formatCurrency(
          u.totalTradedVolume
        )} USDT\n`;
      });
    }

    msg += "\n";

    const formatDealLine = (label, deal, isTime = false) => {
      if (!deal) return `${label} - N/A`;
      let val = "";
      if (isTime) {
        val = `${this.formatDuration(deal.duration)}`;
      } else {
        val = `${formatCurrency(deal.quantity)} ${deal.token}`;
      }
      return `${label}- ${val}`;
    };

    msg += formatDealLine("Shortest Deal", shortest, true) + "\n";
    msg += formatDealLine("Longest Deal ", longest, true) + "\n";
    msg += formatDealLine("Highest Deal", highestDeal, false);

    return msg;
  }

  /**
   * Get top buyers
   */
  async getTopBuyers(limit = 5) {
    return User.find({ totalBoughtVolume: { $gt: 0 } })
      .sort({ totalBoughtVolume: -1 })
      .limit(limit);
  }

  /**
   * Get top sellers
   */
  async getTopSellers(limit = 5) {
    return User.find({ totalSoldVolume: { $gt: 0 } })
      .sort({ totalSoldVolume: -1 })
      .limit(limit);
  }

  formatTopBuyers(users) {
    const formatCurrency = (val) =>
      Number(val || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const medals = ["🥇", "🥈", "🥉", "🏅", "🏅"];

    let msg = "🟢 <b>TOP BUYERS — GLOBAL RANKING</b>\n";
    if (users.length === 0) {
      msg += "<i>No data yet.</i>";
    } else {
      users.forEach((u, i) => {
        const icon = medals[i] || "🏅";
        const name = u.username ? `@${u.username}` : `User ${u.telegramId}`;
        msg += `${icon} #${i + 1} ${name} — ${formatCurrency(
          u.totalBoughtVolume
        )} USDT\n`;
      });
    }
    return msg;
  }

  formatTopSellers(users) {
    const formatCurrency = (val) =>
      Number(val || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const medals = ["🥇", "🥈", "🥉", "🏅", "🏅"];

    let msg = "🔴 <b>TOP SELLERS — GLOBAL RANKING</b>\n";
    if (users.length === 0) {
      msg += "<i>No data yet.</i>";
    } else {
      users.forEach((u, i) => {
        const icon = medals[i] || "🏅";
        const name = u.username ? `@${u.username}` : `User ${u.telegramId}`;
        msg += `${icon} #${i + 1} ${name} — ${formatCurrency(
          u.totalSoldVolume
        )} USDT\n`;
      });
    }
    return msg;
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
