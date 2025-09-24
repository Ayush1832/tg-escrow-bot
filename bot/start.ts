// bot/start.ts
import 'dotenv/config';

// Check environment variables
const requiredEnvVars = [
  'BOT_TOKEN',
  'ADMIN_USER_ID'
];

// Set default values for optional variables
if (!process.env.NETWORK) {
  process.env.NETWORK = 'testnet';
  console.log('🔧 NETWORK not set, defaulting to testnet');
}

if (!process.env.DOMAIN) {
  process.env.DOMAIN = 'http://localhost:3000';
  console.log('🔧 DOMAIN not set, defaulting to localhost:3000');
}

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\n📝 Please create a .env file with the required variables.');
  console.error('📋 See env.example for reference.');
  process.exit(1);
}

// Start the bot
console.log('🔍 Environment check passed');
console.log('🚀 Starting TON Escrow Bot...');

// Import and start the main bot
import('./index')
  .then(() => {
    console.log('✅ Bot module loaded successfully');
  })
  .catch((error) => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  });
