require('dotenv').config();

module.exports = {
  // Telegram Bot Configuration
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_USER_ID: process.env.ADMIN_USER_ID,

  // MongoDB Configuration
  MONGODB_URI: process.env.MONGODB_URI,

  // BSC Configuration
  BSC_RPC_URL: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
  BSCSCAN_API_KEY: process.env.BSCSCAN_API_KEY,
  USDT_CONTRACT_ADDRESS: process.env.USDT_CONTRACT_ADDRESS || '0x55d398326f99059fF775485246999027B3197955',
  
  // Sepolia Configuration
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL,

  // Wallet Configuration
  HOT_WALLET_PRIVATE_KEY: process.env.HOT_WALLET_PRIVATE_KEY,

  // Escrow Configuration
  ESCROW_FEE_PERCENT: Number(process.env.ESCROW_FEE_PERCENT || 1.0),
  ESCROW_FEE_BPS: Number(process.env.ESCROW_FEE_BPS || 100),
  MIN_TRADE_AMOUNT: Number(process.env.MIN_TRADE_AMOUNT || 1),
  MAX_TRADE_AMOUNT: Number(process.env.MAX_TRADE_AMOUNT || 10000),
  DEPOSIT_ADDRESS_TTL_MINUTES: Number(process.env.DEPOSIT_ADDRESS_TTL_MINUTES || 20),

  // Fee wallets
  FEE_WALLET_1: process.env.FEE_WALLET_1,
  FEE_WALLET_2: process.env.FEE_WALLET_2,
  FEE_WALLET_3: process.env.FEE_WALLET_3,

  // Security
  NODE_ENV: process.env.NODE_ENV || 'development'
};
