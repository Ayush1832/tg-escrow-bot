const hre = require('hardhat');
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const { ethers } = require('ethers');

const ContractModel = require(path.join(__dirname, '..', 'src', 'models', 'Contract'));

// EscrowVault ABI - minimal ABI for withdrawToken function
const ESCROW_VAULT_ABI = [
  'function owner() view returns (address)',
  'function token() view returns (address)',
  'function withdrawToken(address erc20Token, address to) external'
];

// ERC20 ABI for balance check
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

async function main() {
  const {
    MONGODB_URI,
    USDT_BSC,
    BSC_RPC_URL,
    HOT_WALLET_PRIVATE_KEY
  } = process.env;

  if (!MONGODB_URI) throw new Error('MONGODB_URI missing');
  if (!USDT_BSC) throw new Error('USDT_BSC missing');
  if (!BSC_RPC_URL) throw new Error('BSC_RPC_URL missing');
  if (!HOT_WALLET_PRIVATE_KEY) throw new Error('HOT_WALLET_PRIVATE_KEY missing');

  // Get withdrawal address from command line argument, or use deployer wallet
  let withdrawTo = process.argv[2];
  
  // If no address provided, use the deployer wallet address
  if (!withdrawTo) {
    // Create wallet from private key to get the address
    const privateKey = HOT_WALLET_PRIVATE_KEY.startsWith('0x') 
      ? HOT_WALLET_PRIVATE_KEY 
      : '0x' + HOT_WALLET_PRIVATE_KEY;
    const deployerWallet = new ethers.Wallet(privateKey);
    withdrawTo = deployerWallet.address;
    console.log('ℹ️  No withdrawal address provided, using deployer wallet address');
  }
  
  if (!ethers.isAddress(withdrawTo)) {
    console.error('❌ Invalid withdrawal address:', withdrawTo);
    process.exit(1);
  }

  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Get the USDT BSC contract from database
  const contract = await ContractModel.findOne({
    name: 'EscrowVault',
    token: 'USDT',
    network: 'BSC',
    feePercent: 0
  });

  if (!contract) {
    console.error('❌ USDT BSC contract not found in database');
    await mongoose.disconnect();
    process.exit(1);
  }

  const contractAddress = contract.address;
  console.log(`📋 Contract Address: ${contractAddress}`);
  console.log(`💰 Token Address: ${USDT_BSC}`);
  console.log(`📍 Withdrawal Address: ${withdrawTo}`);

  // Connect to BSC network
  const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  const privateKey = HOT_WALLET_PRIVATE_KEY.startsWith('0x') 
    ? HOT_WALLET_PRIVATE_KEY 
    : '0x' + HOT_WALLET_PRIVATE_KEY;
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`👤 Wallet Address: ${wallet.address}`);

  // Check if wallet is the owner
  const vaultContract = new ethers.Contract(contractAddress, ESCROW_VAULT_ABI, wallet);
  const owner = await vaultContract.owner();
  console.log(`👑 Contract Owner: ${owner}`);

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`❌ Error: Wallet ${wallet.address} is not the contract owner!`);
    console.error(`   Contract owner is: ${owner}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Check USDT balance in the contract
  const usdtContract = new ethers.Contract(USDT_BSC, ERC20_ABI, provider);
  const balance = await usdtContract.balanceOf(contractAddress);
  const decimals = await usdtContract.decimals();
  const symbol = await usdtContract.symbol();
  const balanceFormatted = ethers.formatUnits(balance, decimals);

  console.log(`\n📊 Contract Balance: ${balanceFormatted} ${symbol}`);
  
  if (balance === 0n) {
    console.log('ℹ️  No tokens to withdraw');
    await mongoose.disconnect();
    return;
  }

  // Confirm withdrawal
  console.log(`\n⚠️  WARNING: You are about to withdraw ${balanceFormatted} ${symbol} to ${withdrawTo}`);
  console.log('   This will withdraw ALL tokens from the contract!');
  console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
  
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    console.log('\n🚀 Withdrawing tokens...');
    const tx = await vaultContract.withdrawToken(USDT_BSC, withdrawTo);
    console.log(`📝 Transaction Hash: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
    console.log(`✅ Successfully withdrew ${balanceFormatted} ${symbol} to ${withdrawTo}`);
    console.log(`🔗 View on BSCScan: https://bscscan.com/tx/${tx.hash}`);
  } catch (error) {
    console.error('❌ Error withdrawing tokens:', error.message);
    if (error.reason) {
      console.error('   Reason:', error.reason);
    }
  }

  await mongoose.disconnect();
  console.log('✅ Disconnected from MongoDB');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

