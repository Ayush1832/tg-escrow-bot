require('dotenv').config();

module.exports = {
  // Telegram Bot Configuration
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_USER_ID: process.env.ADMIN_USER_ID,
  ADMIN_USERNAME2: process.env.ADMIN_USERNAME2,
  ADMIN_USER_ID2: process.env.ADMIN_USER_ID2,

  // MongoDB Configuration
  MONGODB_URI: process.env.MONGODB_URI,

  // Network Configuration
  BSC_RPC_URL: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
  ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY,
  // Token Contract Addresses
  USDT_SEPOLIA: process.env.USDT_SEPOLIA,
  USDT_BSC: process.env.USDT_BSC,
  USDT_SOL: process.env.USDT_SOL,
  USDT_TRON: process.env.USDT_TRON,
  USDC_BSC: process.env.USDC_BSC,
  USDC_SOL: process.env.USDC_SOL,
  BUSD_BSC: process.env.BUSD_BSC,
  ETH_ETH: process.env.ETH_ETH,
  BTC_BTC: process.env.BTC_BTC,
  BTC_BSC: process.env.BTC_BSC,
  TRX_TRON: process.env.TRX_TRON,
  SOL_SOL: process.env.SOL_SOL,
  LTC_LTC: process.env.LTC_LTC,
  BNB_BSC: process.env.BNB_BSC,
  DOGE_DOGE: process.env.DOGE_DOGE,
  DOGE_BSC: process.env.DOGE_BSC,
  
  // Network RPC URLs
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL,
  ETH_RPC_URL: process.env.ETH_RPC_URL,
  LTC_RPC_URL: process.env.LTC_RPC_URL,

  // Wallet Configuration
  HOT_WALLET_PRIVATE_KEY: process.env.HOT_WALLET_PRIVATE_KEY,

  // Escrow Configuration
  ESCROW_FEE_PERCENT: Number(process.env.ESCROW_FEE_PERCENT || 1.0),
  ESCROW_FEE_BPS: Number(process.env.ESCROW_FEE_BPS || 100),
  MIN_TRADE_AMOUNT: Number(process.env.MIN_TRADE_AMOUNT || 1),
  MAX_TRADE_AMOUNT: Number(process.env.MAX_TRADE_AMOUNT || 10000),
  DEPOSIT_ADDRESS_TTL_MINUTES: Number(process.env.DEPOSIT_ADDRESS_TTL_MINUTES || 20),

  // Fee wallets (Distribution: 70% - 22.5% - 7.5%)
  FEE_WALLET_1: process.env.FEE_WALLET_1, // 70% of total fees
  FEE_WALLET_2: process.env.FEE_WALLET_2, // 22.5% of total fees
  FEE_WALLET_3: process.env.FEE_WALLET_3, // 7.5% of total fees

  // Security
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Helper function to get all admin IDs
  getAllAdminIds() {
    const adminIds = [];
    if (this.ADMIN_USER_ID) adminIds.push(this.ADMIN_USER_ID);
    if (this.ADMIN_USER_ID2) adminIds.push(this.ADMIN_USER_ID2);
    return adminIds;
  },

  // Helper function to get all admin usernames
  getAllAdminUsernames() {
    const adminUsernames = [];
    if (this.ADMIN_USERNAME) adminUsernames.push(this.ADMIN_USERNAME);
    if (this.ADMIN_USERNAME2) adminUsernames.push(this.ADMIN_USERNAME2);
    return adminUsernames;
  }
};
