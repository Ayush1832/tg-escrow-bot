const { Markup } = require('telegraf');
const config = require('../../config');
const fs = require('fs');
const path = require('path');

module.exports = async (ctx) => {
  const welcomeText = `
💫 *@mm_escrow_bot* 💫
Your Trustworthy Telegram Escrow Service

Welcome to MM escrow. This bot provides a reliable escrow service for your transactions on Telegram.
Avoid scams, your funds are safeguarded throughout your deals.

🔐 Proceed with confidence — your trust, security, and satisfaction are our top priorities.  

🎟 *ESCROW FEE:*
${config.ESCROW_FEE_PERCENT}% Flat

⚠️ *IMPORTANT* - Make sure coin is same of Buyer and Seller else you may loose your coin.

🌐 Please choose how you'd like to proceed below: 👇
  `;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Start Escrow', 'start_escrow'),
      Markup.button.callback('👤 My Escrows', 'my_escrows')
    ],
    [
      Markup.button.callback('🤖 Help', 'help'),
      Markup.button.callback('📜 Terms', 'terms')
    ],
    [
      Markup.button.callback('❓ How Escrow Works', 'how_escrow_works')
    ],
    [
      Markup.button.url('📢 Updates & Vouches ↗️', 'https://t.me/oftenly')
    ]
  ]).reply_markup;

  const localBannerPath = path.join(process.cwd(), 'public', 'images', 'logo.jpg');

  try {
    if (fs.existsSync(localBannerPath)) {
      await ctx.replyWithPhoto({ source: fs.createReadStream(localBannerPath) }, {
        caption: welcomeText,
        reply_markup: keyboard
      });
    } else {
      // Fallback to text-only message
      await ctx.reply(welcomeText, {
        reply_markup: keyboard
      });
    }
  } catch (err) {
    // If sending photo fails for any reason, fallback to text message
    await ctx.reply(welcomeText, {
      reply_markup: keyboard
    });
  }
};
