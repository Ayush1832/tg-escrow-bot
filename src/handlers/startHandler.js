const { Markup } = require('telegraf');

module.exports = (ctx) => {
  const welcomeText = `
💫 *@Easy_Escrow_Bot* 💫
Your Trustworthy Telegram Escrow Service

Welcome to @Easy_Escrow_Bot. This bot provides a reliable escrow service for your transactions on Telegram.
Avoid scams, your funds are safeguarded throughout your deals. If you run into any issues, simply type /dispute and an arbitrator will join the group chat within 24 hours.

🎟 *ESCROW FEE:*
1.0% Flat

🌐 (UPDATES) - (VOUCHES) ☑️

💬 Proceed with /escrow (to start with a new escrow)

⚠️ *IMPORTANT* - Make sure coin is same of Buyer and Seller else you may loose your coin.

💡 Type /menu to summon a menu with all bots features
  `;

  ctx.reply(welcomeText, { 
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Start New Escrow', 'start_escrow')],
      [Markup.button.callback('📋 Show Menu', 'show_menu')]
    ]).reply_markup
  });
};
