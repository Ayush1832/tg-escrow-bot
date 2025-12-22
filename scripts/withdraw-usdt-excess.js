const path = require("path");
require("dotenv").config();
const mongoose = require("mongoose");
const { ethers } = require("ethers");

const ContractModel = require(path.join(
  __dirname,
  "..",
  "src",
  "models",
  "Contract"
));
const config = require("../config");

const ESCROW_VAULT_ABI = [
  "function owner() view returns (address)",
  "function withdrawToken(address erc20Token, address to) external",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

async function main() {
  const {
    MONGODB_URI,
    BSC_RPC_URL,
    HOT_WALLET_PRIVATE_KEY,
    CONTRACT_USDT_RESERVE,
  } = process.env;

  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");
  if (!BSC_RPC_URL) throw new Error("BSC_RPC_URL missing");
  if (!HOT_WALLET_PRIVATE_KEY)
    throw new Error("HOT_WALLET_PRIVATE_KEY missing");

  const reserveArg = process.argv[2];
  const reserveAmount = reserveArg
    ? Number(reserveArg)
    : Number(CONTRACT_USDT_RESERVE || 0.1);
  if (!Number.isFinite(reserveAmount) || reserveAmount < 0) {
    throw new Error("Invalid reserve amount");
  }

  const tokenAddress = config.USDT_BSC;
  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    throw new Error("USDT_BSC address missing/invalid in config");
  }

  const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  const privateKey = HOT_WALLET_PRIVATE_KEY.startsWith("0x")
    ? HOT_WALLET_PRIVATE_KEY
    : `0x${HOT_WALLET_PRIVATE_KEY}`;
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`👤 Hot wallet: ${wallet.address}`);
  console.log(`🔄 Target reserve per contract: ${reserveAmount} USDT\n`);

  console.log("🔗 Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  const contracts = await ContractModel.find({
    name: "EscrowVault",
    token: "USDT",
    network: "BSC",
    status: "deployed",
  }).sort({ createdAt: 1 });

  if (!contracts.length) {
    console.log("❌ No USDT EscrowVault contracts found");
    await mongoose.disconnect();
    return;
  }

  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const tokenWithSigner = tokenContract.connect(wallet);
  const decimals = await tokenContract.decimals();
  const decimalsNum = Number(decimals);
  const reserveWei = ethers.parseUnits(reserveAmount.toString(), decimals);
  const epsilon = Number(1 / 10 ** Math.min(decimalsNum, 8));

  let processed = 0;
  let skipped = 0;

  for (const contract of contracts) {
    const contractAddress = contract.address;
    console.log(`\n${"-".repeat(80)}`);
    console.log(`📄 Contract: ${contractAddress}`);

    const vaultContract = new ethers.Contract(
      contractAddress,
      ESCROW_VAULT_ABI,
      wallet
    );
    const owner = await vaultContract.owner();
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.log("⚠️  Skipping: wallet is not the owner");
      skipped += 1;
      continue;
    }

    const balanceRaw = await tokenContract.balanceOf(contractAddress);
    const balance = Number(ethers.formatUnits(balanceRaw, decimals));
    console.log(`   💰 Balance: ${balance.toFixed(6)} USDT`);

    if (balance <= reserveAmount + epsilon) {
      console.log("   ℹ️  Balance within reserve threshold, skipping");
      skipped += 1;
      continue;
    }

    console.log("   🚀 Withdrawing full balance to hot wallet...");
    const withdrawTx = await vaultContract.withdrawToken(
      tokenAddress,
      wallet.address
    );
    console.log(`   ⏳ Waiting for withdrawal tx ${withdrawTx.hash}...`);
    await withdrawTx.wait();
    console.log("   ✅ Withdrawal confirmed");

    console.log(
      `   🔄 Re-depositing ${reserveAmount} USDT back to contract...`
    );
    const depositTx = await tokenWithSigner.transfer(
      contractAddress,
      reserveWei
    );
    console.log(`   ⏳ Waiting for deposit tx ${depositTx.hash}...`);
    await depositTx.wait();
    console.log("   ✅ Deposit confirmed");

    processed += 1;

    // Small delay to avoid nonce contention
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 SUMMARY");
  console.log("=".repeat(80));
  console.log(`✅ Contracts cleaned: ${processed}`);
  console.log(`⏭️  Skipped (already at reserve / not owner): ${skipped}`);

  await mongoose.disconnect();
  console.log("\n✅ Disconnected from MongoDB");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
