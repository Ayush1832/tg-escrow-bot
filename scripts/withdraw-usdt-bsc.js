const hre = require("hardhat");
require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const { ethers } = require("ethers");
const config = require("../config");

const ContractModel = require(path.join(
  __dirname,
  "..",
  "src",
  "models",
  "Contract"
));

// EscrowVault ABI - minimal ABI for withdrawToken function
const ESCROW_VAULT_ABI = [
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function withdrawToken(address erc20Token, address to) external",
];

// ERC20 ABI for balance check
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

// Get all BSC token addresses from config
function getAllBSCTokens() {
  const tokens = [];
  const tokenConfigs = [
    { key: "USDT_BSC", name: "USDT" },
    { key: "USDC_BSC", name: "USDC" },
    { key: "BUSD_BSC", name: "BUSD" },
    { key: "BTC_BSC", name: "BTC" },
    { key: "BNB_BSC", name: "BNB" },
    { key: "DOGE_BSC", name: "DOGE" },
  ];

  for (const { key, name } of tokenConfigs) {
    const address = config[key];
    if (address && ethers.isAddress(address)) {
      tokens.push({ address, name, key });
    }
  }

  return tokens;
}

// Get custom token addresses from command line arguments
function getCustomTokens(args) {
  const tokens = [];

  // Skip first two args (node, script name, withdrawal address)
  // Remaining args should be token addresses
  for (let i = 3; i < args.length; i++) {
    const address = args[i];
    if (ethers.isAddress(address)) {
      tokens.push({ address, name: `Token_${i - 2}`, key: null });
    }
  }

  return tokens;
}

// Automatically detect all ERC20 tokens in a contract by checking Transfer events
async function detectTokensInContract(
  contractAddress,
  provider,
  fromBlock = null
) {
  const tokens = new Map();

  // ERC20 Transfer event signature
  const transferEventSignature = "Transfer(address,address,uint256)";
  const transferTopic = ethers.id(transferEventSignature);

  try {
    // Get current block
    const currentBlock = await provider.getBlockNumber();
    const scanBlocks = fromBlock ? currentBlock - fromBlock : 10000; // Scan last 10k blocks or specified range
    const startBlock = Math.max(0, currentBlock - scanBlocks);

    console.log(
      `   🔍 Scanning blocks ${startBlock} to ${currentBlock} for token transfers...`
    );

    // Get all Transfer events where the contract is the 'to' address
    const filter = {
      address: null, // We'll check multiple token addresses
      topics: [
        transferTopic,
        null, // from
        ethers.zeroPadValue(contractAddress, 32), // to (contract address)
      ],
      fromBlock: startBlock,
      toBlock: currentBlock,
    };

    // This is a simplified approach - we'll check known tokens instead
    // For a full scan, we'd need to use a service like BSCScan API
  } catch (error) {
    console.log(`   ⚠️  Error detecting tokens: ${error.message}`);
  }

  return Array.from(tokens.values());
}

async function main() {
  const { MONGODB_URI, BSC_RPC_URL, HOT_WALLET_PRIVATE_KEY } = process.env;

  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");
  if (!BSC_RPC_URL) throw new Error("BSC_RPC_URL missing");
  if (!HOT_WALLET_PRIVATE_KEY)
    throw new Error("HOT_WALLET_PRIVATE_KEY missing");

  // Get withdrawal address from command line argument, or use deployer wallet
  let withdrawTo = process.argv[2];

  // Check if first arg is a token address (no withdrawal address provided)
  const customTokens = getCustomTokens(process.argv);
  const hasCustomTokens = customTokens.length > 0;

  // If no withdrawal address provided and no custom tokens, use deployer wallet
  if (!withdrawTo || (hasCustomTokens && !ethers.isAddress(withdrawTo))) {
    // If withdrawTo is not a valid address, it might be a token address
    if (withdrawTo && !ethers.isAddress(withdrawTo)) {
      console.error("❌ Invalid withdrawal address:", withdrawTo);
      console.error(
        "   Usage: node withdraw-usdt-bsc.js [withdrawal_address] [token_address1] [token_address2] ..."
      );
      process.exit(1);
    }

    // Create wallet from private key to get the address
    const privateKey = HOT_WALLET_PRIVATE_KEY.startsWith("0x")
      ? HOT_WALLET_PRIVATE_KEY
      : "0x" + HOT_WALLET_PRIVATE_KEY;
    const deployerWallet = new ethers.Wallet(privateKey);
    withdrawTo = deployerWallet.address;
    console.log(
      "ℹ️  No withdrawal address provided, using deployer wallet address"
    );
  }

  if (!ethers.isAddress(withdrawTo)) {
    console.error("❌ Invalid withdrawal address:", withdrawTo);
    process.exit(1);
  }

  console.log("🔗 Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  // Get all BSC EscrowVault contracts from database
  const contracts = await ContractModel.find({
    name: "EscrowVault",
    network: "BSC",
    status: "deployed",
  });

  if (!contracts || contracts.length === 0) {
    console.error("❌ No BSC EscrowVault contracts found in database");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\n📋 Found ${contracts.length} BSC EscrowVault contract(s)`);

  // Get token addresses - use custom tokens if provided, otherwise use all from config
  let allTokens;
  if (hasCustomTokens) {
    allTokens = customTokens;
    console.log(
      `💰 Using ${allTokens.length} custom token(s) from command line`
    );
    for (const token of allTokens) {
      console.log(`   • ${token.address}`);
    }
  } else {
    allTokens = getAllBSCTokens();
    console.log(
      `💰 Checking ${allTokens.length} tokens: ${allTokens
        .map((t) => t.name)
        .join(", ")}`
    );
    console.log(
      `\n💡 Tip: To check specific tokens, provide addresses as arguments:`
    );
    console.log(
      `   node scripts/withdraw-usdt-bsc.js [withdrawal_address] [token1] [token2] ...`
    );
  }

  // Connect to BSC network
  const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  const privateKey = HOT_WALLET_PRIVATE_KEY.startsWith("0x")
    ? HOT_WALLET_PRIVATE_KEY
    : "0x" + HOT_WALLET_PRIVATE_KEY;
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`👤 Wallet Address: ${wallet.address}`);
  console.log(`📍 Withdrawal Address: ${withdrawTo}\n`);

  // Process each contract
  const allWithdrawals = [];

  for (const contract of contracts) {
    const contractAddress = contract.address;
    console.log(`\n${"=".repeat(60)}`);
    console.log(
      `📋 Contract: ${contract.token} on ${contract.network} (Fee: ${contract.feePercent}%)`
    );
    console.log(`   Address: ${contractAddress}`);

    // Check if wallet is the owner
    const vaultContract = new ethers.Contract(
      contractAddress,
      ESCROW_VAULT_ABI,
      provider
    );
    let owner;
    try {
      owner = await vaultContract.owner();
    } catch (error) {
      console.error(`   ❌ Error checking owner: ${error.message}`);
      continue;
    }

    console.log(`   👑 Owner: ${owner}`);

    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.log(`   ⚠️  Skipping: Wallet is not the contract owner`);
      continue;
    }

    // Check balances for all tokens
    const tokenBalances = [];

    for (const token of allTokens) {
      try {
        const tokenContract = new ethers.Contract(
          token.address,
          ERC20_ABI,
          provider
        );
        const balance = await tokenContract.balanceOf(contractAddress);

        if (balance > 0n) {
          const decimals = await tokenContract.decimals();
          let symbol, tokenName;
          try {
            symbol = await tokenContract.symbol();
            tokenName = await tokenContract.name();
          } catch (e) {
            // If name/symbol call fails, use fallback
            symbol = token.symbol || token.name || "UNKNOWN";
            tokenName = token.name || token.address.substring(0, 10) + "...";
          }

          const balanceFormatted = ethers.formatUnits(balance, decimals);

          tokenBalances.push({
            tokenAddress: token.address,
            tokenName: tokenName || token.name,
            symbol: symbol || token.name,
            balance,
            balanceFormatted,
            decimals,
            contractAddress,
          });

          console.log(
            `   💰 ${tokenName || token.name} (${symbol}): ${balanceFormatted}`
          );
        }
      } catch (error) {
        // Token might not be deployed or contract might not support it
        console.log(`   ⚠️  Error checking ${token.address}: ${error.message}`);
      }
    }

    if (tokenBalances.length === 0) {
      console.log(`   ℹ️  No tokens to withdraw from this contract`);
      continue;
    }

    // Add to withdrawal list
    allWithdrawals.push({
      contractAddress,
      vaultContract: new ethers.Contract(
        contractAddress,
        ESCROW_VAULT_ABI,
        wallet
      ),
      tokenBalances,
      contractInfo: contract,
    });
  }

  if (allWithdrawals.length === 0) {
    console.log("\nℹ️  No tokens to withdraw from any contract");
    await mongoose.disconnect();
    return;
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 WITHDRAWAL SUMMARY");
  console.log(`${"=".repeat(60)}`);

  let totalTokens = 0;
  for (const withdrawal of allWithdrawals) {
    console.log(
      `\nContract: ${withdrawal.contractInfo.token} (${withdrawal.contractAddress})`
    );
    for (const tokenBalance of withdrawal.tokenBalances) {
      console.log(
        `  • ${tokenBalance.tokenName} (${tokenBalance.symbol}): ${tokenBalance.balanceFormatted}`
      );
      totalTokens++;
    }
  }

  console.log(
    `\n⚠️  WARNING: You are about to withdraw ${totalTokens} token(s) to ${withdrawTo}`
  );
  console.log("   This will withdraw ALL tokens from ALL contracts!");
  if (hasCustomTokens) {
    console.log("   Note: Only specified custom tokens will be checked.");
  }
  console.log("   Press Ctrl+C to cancel, or wait 10 seconds to continue...");

  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Execute withdrawals
  console.log(`\n${"=".repeat(60)}`);
  console.log("🚀 Starting withdrawals...");
  console.log(`${"=".repeat(60)}\n`);

  const results = [];

  for (const withdrawal of allWithdrawals) {
    console.log(
      `\n📋 Processing: ${withdrawal.contractInfo.token} (${withdrawal.contractAddress})`
    );

    for (const tokenBalance of withdrawal.tokenBalances) {
      try {
        console.log(
          `   💸 Withdrawing ${tokenBalance.balanceFormatted} ${tokenBalance.symbol}...`
        );

        const tx = await withdrawal.vaultContract.withdrawToken(
          tokenBalance.tokenAddress,
          withdrawTo
        );

        console.log(`   📝 TX Hash: ${tx.hash}`);
        console.log(`   ⏳ Waiting for confirmation...`);

        const receipt = await tx.wait();

        results.push({
          success: true,
          contract: withdrawal.contractInfo.token,
          contractAddress: withdrawal.contractAddress,
          token: tokenBalance.tokenName,
          symbol: tokenBalance.symbol,
          amount: tokenBalance.balanceFormatted,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
        });

        console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
        console.log(`   🔗 https://bscscan.com/tx/${tx.hash}`);

        // Small delay between transactions
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        if (error.reason) {
          console.error(`      Reason: ${error.reason}`);
        }

        results.push({
          success: false,
          contract: withdrawal.contractInfo.token,
          contractAddress: withdrawal.contractAddress,
          token: tokenBalance.tokenName,
          symbol: tokenBalance.symbol,
          amount: tokenBalance.balanceFormatted,
          error: error.message,
        });
      }
    }
  }

  // Final summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 FINAL SUMMARY");
  console.log(`${"=".repeat(60)}`);

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\n✅ Successful: ${successful.length}`);
  for (const result of successful) {
    console.log(
      `   • ${result.token} (${result.symbol}): ${result.amount} - ${result.txHash}`
    );
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`);
    for (const result of failed) {
      console.log(`   • ${result.token} (${result.symbol}): ${result.error}`);
    }
  }

  await mongoose.disconnect();
  console.log("\n✅ Disconnected from MongoDB");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
