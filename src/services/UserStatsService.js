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
        totalBoughtVolume: { $gt: user.totalBoughtVolume },
      }),
      User.countDocuments({
        totalSoldVolume: { $gt: user.totalSoldVolume },
      }),
      User.countDocuments({
        totalTradedVolume: { $gt: user.totalTradedVolume },
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
      return amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    };

    const usernameDisplay = user.username
      ? `@${user.username}`
      : `User ${user.telegramId}`;

    const totalBought = formatCurrency(user.totalBoughtVolume);
    const totalBuyTrades = user.totalBoughtTrades;
    const buyRank = user.globalBuyRank || "N/A";

    const totalSold = formatCurrency(user.totalSoldVolume);
    const totalSellTrades = user.totalSoldTrades;
    const sellRank = user.globalSellRank || "N/A";

    const lifetimeVolume = formatCurrency(user.totalTradedVolume);
    const totalDeals = user.totalCompletedTrades;
    const totalParticipated = user.totalParticipatedTrades;

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

    // Global Stats
    const totalStats = await Escrow.aggregate([
      { $match: { status: "completed" } },
      {
        $group: {
          _id: null,
          totalDeals: { $sum: 1 },
          totalVolume: { $sum: "$quantity" },
        },
      },
    ]);
    const globalStats = totalStats[0] || { totalDeals: 0, totalVolume: 0 };

    // Common projection for deal stats
    const dealProjection = {
      duration: 1,
      quantity: 1,
      token: 1,
      buyerUsername: 1,
      sellerUsername: 1,
      buyerId: 1,
      sellerId: 1,
    };

    // Highest Deal
    const highestDeal = await Escrow.findOne({ status: "completed" })
      .sort({ quantity: -1 })
      .select("quantity token buyerUsername sellerUsername buyerId sellerId");

    // Lowest Deal
    const lowestDeal = await Escrow.findOne({ status: "completed" })
      .sort({ quantity: 1 })
      .select("quantity token buyerUsername sellerUsername buyerId sellerId");

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
      { $sort: { duration: 1 } },
      { $limit: 1 },
      { $project: dealProjection },
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
      { $sort: { duration: -1 } },
      { $limit: 1 },
      { $project: dealProjection },
    ]);

    return {
      topTraders,
      globalStats,
      highestDeal,
      lowestDeal,
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

  formatMainLeaderboard({
    topTraders,
    globalStats,
    highestDeal,
    lowestDeal,
    shortest,
    longest,
  }) {
    const formatCurrency = (val) =>
      Number(val).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    // Helper to format volume like "300K"
    const formatKVolume = (val) => {
      const v = Number(val);
      if (v >= 1000000) return (v / 1000000).toFixed(1) + "M";
      if (v >= 1000) return (v / 1000).toFixed(0) + "K";
      return v.toFixed(0);
    };

    const medals = ["🥇", "🥈", "🥉", "🏅", "🏅"];
    const formatUser = (u) =>
      u.username ? `@${u.username}` : `User ${u.telegramId}`;

    let msg = "<b>🌍 GLOBAL LEADERBOARD</b>\n\n";
    msg += "<b>🏆 TOP TRADERS — OVERALL VOLUME</b>\n\n";

    if (topTraders.length === 0) {
      msg += "<i>No trades yet.</i>\n";
    } else {
      topTraders.forEach((u, i) => {
        const icon = medals[i] || "🏅";
        const name = formatUser(u);
        msg += `${icon} #${i + 1} ${name} — ${formatCurrency(
          u.totalTradedVolume
        )} USDT\n`;
      });
    }

    msg += "\n<b>DEAL STATS</b>\n\n";

    // Global Stats
    msg += `<b>TOTAL:</b> ${globalStats.totalDeals}\n`;
    msg += `<b>VOLUME:</b> ${formatKVolume(globalStats.totalVolume)} Usdt\n\n`;

    // Helper for "Val ( @ & @ )" format
    const formatDealInfo = (deal, type) => {
      if (!deal) return "N/A";

      const bName = deal.buyerUsername
        ? `@${deal.buyerUsername}`
        : deal.buyerId
        ? `User ${deal.buyerId}`
        : "Unknown";
      const sName = deal.sellerUsername
        ? `@${deal.sellerUsername}`
        : deal.sellerId
        ? `User ${deal.sellerId}`
        : "Unknown";
      const participants = `${bName} & ${sName}`;

      let valDisplay = "";
      if (type === "time") {
        // Need custom cleaner format for time: "1 Min", "360 Mins"
        const ms = deal.duration;
        const minutes = Math.floor(ms / (1000 * 60));
        if (minutes < 60) {
          valDisplay = `${Math.max(1, minutes)} Min${minutes !== 1 ? "s" : ""}`;
        } else {
          valDisplay = `${minutes} Mins`;
        }
      } else {
        // Amount
        // User requested format: "10000 Usdt", "0.4 Usdt"
        // Remove trailing .00 if whole number? user example has "10000" and "0.4"
        const amt = Number(deal.quantity);
        valDisplay = `${Number.isInteger(amt) ? amt : amt.toFixed(2)} Usdt`;
      }

      return `${valDisplay} (${participants})`;
    };

    msg += `<b>SHORTEST:</b> ${formatDealInfo(shortest, "time")}\n`;
    msg += `<b>LONGEST:</b> ${formatDealInfo(longest, "time")}\n`;
    msg += `<b>BIGGEST:</b> ${formatDealInfo(highestDeal, "amount")}\n`;
    msg += `<b>LOWEST:</b> ${formatDealInfo(lowestDeal, "amount")}\n`;

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
      Number(val).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const medals = ["🥇", "🥈", "🥉", "🏅", "🏅"];
    const formatUser = (u) =>
      u.username ? `@${u.username}` : `User ${u.telegramId}`;

    let msg = "<b>🟢 TOP BUYERS — GLOBAL RANKING</b>\n";
    if (users.length === 0) {
      msg += "<i>No data yet.</i>";
    } else {
      users.forEach((u, i) => {
        const icon = i < 3 ? medals[i] : "🏅"; // Top 3 get specific medals, rest get generic
        const name = formatUser(u);
        msg += `${icon} #${i + 1} ${name} — ${formatCurrency(
          u.totalBoughtVolume
        )} USDT\n`;
      });
    }
    return msg;
  }

  formatTopSellers(users) {
    const formatCurrency = (val) =>
      Number(val).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const medals = ["🥇", "🥈", "🥉", "🏅", "🏅"];
    const formatUser = (u) =>
      u.username ? `@${u.username}` : `User ${u.telegramId}`;

    let msg = "<b>🔴 TOP SELLERS — GLOBAL RANKING</b>\n";
    if (users.length === 0) {
      msg += "<i>No data yet.</i>";
    } else {
      users.forEach((u, i) => {
        const icon = i < 3 ? medals[i] : "🏅";
        const name = formatUser(u);
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

    const amount = Number(quantity);
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

  /**
   * Record simple participation (called when role is selected)
   * @param {Object} params - { telegramId, username }
   */
  async recordParticipation({ telegramId, username }) {
    if (!telegramId) return;

    await User.findOneAndUpdate(
      { telegramId: Number(telegramId) },
      {
        $setOnInsert: {
          telegramId: Number(telegramId),
          username: username || `user_${telegramId}`,
          totalBoughtVolume: 0,
          totalSoldVolume: 0,
          totalTradedVolume: 0,
          totalBoughtTrades: 0,
          totalSoldTrades: 0,
          totalCompletedTrades: 0,
        },
        $inc: {
          totalParticipatedTrades: 1,
        },
        $set: {
          lastActive: new Date(),
        },
      },
      { upsert: true }
    );
  }
}

module.exports = new UserStatsService();
