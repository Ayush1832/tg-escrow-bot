const User = require("../models/User");

class UserStatsService {
  normalizeUsername(username) {
    if (!username) {
      return null;
    }
    return username.replace(/^@/, "").trim();
  }

  formatUserLabel(username, telegramId, options = {}) {
    // Show username if available, otherwise show user ID, otherwise unknown
    const normalized = this.normalizeUsername(username);
    if (normalized) {
      return `@${normalized}`;
    }

    if (telegramId) {
      return `User ${telegramId}`;
    }

    return "Unknown User";
  }

  escapeRegex(value = "") {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  formatAmount(amount = 0) {
    return Number(amount || 0).toFixed(2);
  }

  formatDate(date) {
    if (!date) {
      return "N/A";
    }
    return new Date(date).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  async ensureUserRecord(telegramId, username = null) {
    if (!telegramId) {
      return null;
    }

    const normalizedUsername = this.normalizeUsername(username);
    const now = new Date();
    const update = {
      $setOnInsert: {
        telegramId,
        createdAt: now,
      },
      $set: {
        lastActive: now,
      },
    };

    if (normalizedUsername) {
      update.$set.username = normalizedUsername;
    }

    return User.findOneAndUpdate({ telegramId }, update, {
      upsert: true,
      new: true,
    });
  }

  buildCounterpartyLabel(username, telegramId) {
    const normalized = this.normalizeUsername(username);
    if (normalized) {
      return `@${normalized}`;
    }
    if (telegramId) {
      return `ID ${telegramId}`;
    }
    return "N/A";
  }

  async applyTradeUpdate({
    telegramId,
    username,
    role,
    amount,
    token,
    escrowId,
    counterpartyUsername,
    counterpartyId,
  }) {
    if (!telegramId || !amount || amount <= 0) {
      return null;
    }

    const normalizedUsername = this.normalizeUsername(username);
    const counterpartyLabel = this.buildCounterpartyLabel(
      counterpartyUsername,
      counterpartyId
    );
    const now = new Date();

    const inc = {
      totalTradedVolume: amount,
      totalCompletedTrades: 1,
    };

    if (role === "buyer") {
      inc.totalBoughtVolume = amount;
      inc.totalBoughtTrades = 1;
    } else if (role === "seller") {
      inc.totalSoldVolume = amount;
      inc.totalSoldTrades = 1;
    }

    const update = {
      $inc: inc,
      $set: {
        lastActive: now,
        lastTradeAt: now,
        lastTradeRole: role,
        lastTradeAmount: amount,
        lastTradeToken: token,
        lastTradeEscrowId: escrowId,
        lastTradeCounterparty: counterpartyLabel,
      },
      $setOnInsert: {
        telegramId,
        createdAt: now,
      },
    };

    if (normalizedUsername) {
      update.$set.username = normalizedUsername;
    }

    return User.findOneAndUpdate({ telegramId }, update, {
      upsert: true,
      new: true,
    });
  }

  async recordTrade({
    buyerId,
    buyerUsername,
    sellerId,
    sellerUsername,
    amount,
    token = "USDT",
    escrowId,
  }) {
    if (!amount || amount <= 0) {
      return;
    }

    const updates = [];

    if (buyerId) {
      updates.push(
        this.applyTradeUpdate({
          telegramId: buyerId,
          username: buyerUsername,
          role: "buyer",
          amount,
          token,
          escrowId,
          counterpartyUsername: sellerUsername,
          counterpartyId: sellerId,
        })
      );
    }

    if (sellerId) {
      updates.push(
        this.applyTradeUpdate({
          telegramId: sellerId,
          username: sellerUsername,
          role: "seller",
          amount,
          token,
          escrowId,
          counterpartyUsername: buyerUsername,
          counterpartyId: buyerId,
        })
      );
    }

    if (updates.length > 0) {
      await Promise.all(updates);
    }
  }

  async recordParticipation({ telegramId, username }) {
    if (!telegramId) {
      return null;
    }

    const normalizedUsername = this.normalizeUsername(username);
    const now = new Date();

    const update = {
      $inc: {
        totalParticipatedTrades: 1,
      },
      $set: {
        lastActive: now,
      },
      $setOnInsert: {
        telegramId,
        createdAt: now,
      },
    };

    if (normalizedUsername) {
      update.$set.username = normalizedUsername;
    }

    return User.findOneAndUpdate({ telegramId }, update, {
      upsert: true,
      new: true,
    });
  }

  async getUserStats({ telegramId = null, username = null }) {
    const query = {};

    if (telegramId) {
      query.telegramId = telegramId;
    } else if (username) {
      const normalized = this.normalizeUsername(username);
      if (!normalized) {
        return null;
      }
      query.username = {
        $regex: new RegExp(`^${this.escapeRegex(normalized)}$`, "i"),
      };
    } else {
      return null;
    }

    return User.findOne(query);
  }

  formatStatsMessage(userDoc) {
    if (!userDoc) {
      // Return default stats with 0 trades
      return `📊 <b>Trading Stats – Unknown User</b>

• <b>Total Bought:</b> 0.00 USDT (0 trades)
• <b>Total Sold:</b> 0.00 USDT (0 trades)
• <b>Lifetime Volume:</b> 0.00 USDT (0 deals)
• <b>Completion Rate:</b> N/A

<b>Last Deal:</b> No completed trades yet.`;
    }

    // Show username if available, otherwise show userId
    const usernameLabel = this.formatUserLabel(userDoc.username, userDoc.telegramId);
    const totalBought = this.formatAmount(userDoc.totalBoughtVolume || 0);
    const totalSold = this.formatAmount(userDoc.totalSoldVolume || 0);
    const totalVolume = this.formatAmount(userDoc.totalTradedVolume || 0);
    const boughtTrades = userDoc.totalBoughtTrades || 0;
    const soldTrades = userDoc.totalSoldTrades || 0;
    const totalTrades = boughtTrades + soldTrades;
    const participatedTrades = userDoc.totalParticipatedTrades || 0;
    const completedTrades = userDoc.totalCompletedTrades || totalTrades || 0;
    const completionRate =
      participatedTrades > 0
        ? ((completedTrades / participatedTrades) * 100).toFixed(1)
        : null;

    let lastTradeSummary = "<b>Last Deal:</b> No completed trades yet.";

    if (userDoc.lastTradeAt && userDoc.lastTradeAmount) {
      const roleLabel = userDoc.lastTradeRole === "seller" ? "Sold" : "Bought";
      const amountLabel = this.formatAmount(userDoc.lastTradeAmount);
      const tokenLabel = userDoc.lastTradeToken || "USDT";
      const dateLabel = this.formatDate(userDoc.lastTradeAt);
      const counterpartyLabel = userDoc.lastTradeCounterparty || "N/A";
      const escrowLabel = userDoc.lastTradeEscrowId || "N/A";
      lastTradeSummary = `<b>Last Deal:</b> ${roleLabel} ${amountLabel} ${tokenLabel} with ${counterpartyLabel} on ${dateLabel} (Escrow ${escrowLabel})`;
    }

    return `📊 <b>Trading Stats – ${usernameLabel}</b>

• <b>Total Bought:</b> ${totalBought} USDT (${boughtTrades} trades)
• <b>Total Sold:</b> ${totalSold} USDT (${soldTrades} trades)
• <b>Lifetime Volume:</b> ${totalVolume} USDT (${totalTrades} deals)
• <b>Completion Rate:</b> ${
      completionRate !== null
        ? `${completionRate}% (${completedTrades}/${participatedTrades})`
        : "N/A"
    }

${lastTradeSummary}`;
  }

  async getLeaderboard(limit = 5) {
    return User.find({ totalTradedVolume: { $gt: 0 } })
      .sort({ totalTradedVolume: -1 })
      .limit(limit)
      .lean();
  }

  formatLeaderboard(users) {
    if (!users || users.length === 0) {
      return "🏆 <b>Leaderboard</b>\n\nNo completed trades yet.";
    }

    const lines = users.map((user, index) => {
      const label = this.formatUserLabel(user.username, user.telegramId);
      const totalVolume = this.formatAmount(user.totalTradedVolume);
      const bought = this.formatAmount(user.totalBoughtVolume);
      const sold = this.formatAmount(user.totalSoldVolume);
      return `${
        index + 1
      }. ${label} – ${totalVolume} USDT (Bought ${bought} / Sold ${sold})`;
    });

    return `🏆 <b>Top Traders</b>\n\n${lines.join("\n")}`;
  }
}

module.exports = new UserStatsService();
