// scripts/ton/deploy-escrow.ts
import 'dotenv/config';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow'; // auto-generated path after tact build
import { computeUSDTJettonWallet } from './compute-jetton-wallet';

export default async function run(provider: NetworkProvider) {
  // load env
  const sellerMnemonic = process.env.SELLER_MNEMONIC!;
  const buyerAddr = Address.parse(process.env.BUYER_ADDRESS!);
  const adminAddr = Address.parse(process.env.ADMIN_ADDRESS!);
  const feeW1 = Address.parse(process.env.FEE_W1!);
  const feeW2 = Address.parse(process.env.FEE_W2!);
  const feeW3 = Address.parse(process.env.FEE_W3!);

  // Jetton config - replace placeholders in .env
  const JETTON_MASTER = Address.parse(process.env.JETTON_MASTER!); // set this before deploy
  const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || '6', 10);
  // amount must be in smallest units (eg. USDT 6 decimals -> multiply by 1e6)
  const amountUnits = BigInt(process.env.AMOUNT_JETTON_UNITS!); // pass smallest unit amount (e.g., "1000000" for 1 USDT)

  const commissionBps = BigInt(parseInt(process.env.COMMISSION_BPS || '250', 10));

  // open seller wallet
  const seller = await openWalletFromMnemonic(provider, sellerMnemonic);

  // First, create escrow instance to get its address
  const tempEscrow = await Escrow.fromInit(
    seller.address,
    buyerAddr,
    adminAddr,
    amountUnits,
    commissionBps,
    feeW1,
    feeW2,
    feeW3,
    BigInt(Date.now() + 24 * 60 * 60 * 1000), // 24h deadline
    null // Will be computed below
  );

  console.log('Escrow address (will be):', tempEscrow.address.toString());
  
  // PRODUCTION SECURITY: Pre-compute the escrow's USDT jetton wallet
  // This is the wallet that will receive deposits and send the notification
  console.log('Computing escrow USDT jetton wallet...');
  const escrowUSDTWallet = await computeUSDTJettonWallet(tempEscrow.address);
  console.log('Escrow USDT jetton wallet:', escrowUSDTWallet.toString());

  // Create final contract instance with escrow's USDT wallet
  const escrow = provider.open(
    await Escrow.fromInit(
      seller.address,
      buyerAddr,
      adminAddr,
      amountUnits,
      commissionBps,
      feeW1,
      feeW2,
      feeW3,
      BigInt(Date.now() + 24 * 60 * 60 * 1000), // 24h deadline
      escrowUSDTWallet // SECURITY: Escrow's USDT jetton wallet
    )
  );

  // Deploy (seller pays gas)
  const deployGas = toNano(process.env.DEPLOY_GAS_TON || '0.05'); // default 0.05 TON
  console.log('Deploying - seller will pay', deployGas.toString(), 'nanotons');
  await escrow.sendDeploy(seller, { value: deployGas });

  console.log('Deployed escrow at:', escrow.address.toString());
  console.log('Save this address as TRADE_CONTRACT in .env (or pass to bot).');
  console.log('');
  console.log('🚨 PRODUCTION SECURITY CHECKLIST:');
  console.log('1. Bot MUST call confirmDeposit() after verifying jetton wallet balance');
  console.log('2. Monitor all transfer events for failures');
  console.log('3. Use retryPayout() if any transfers fail');
  console.log('4. Keep admin keys secure (multi-sig recommended)');
  console.log('5. Test all flows on testnet before mainnet');
}
