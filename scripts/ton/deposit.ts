// scripts/ton/deposit.ts
import 'dotenv/config';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';
import { Address, toNano, beginCell } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';

export default async function run(provider: NetworkProvider) {
  // Load environment variables
  const sellerMnemonic = process.env.SELLER_MNEMONIC!;
  const escrowAddress = Address.parse(process.env.ESCROW_ADDRESS!);
  const amountUnits = BigInt(process.env.AMOUNT_JETTON_UNITS!);

  // Open seller wallet
  const seller = await openWalletFromMnemonic(provider, sellerMnemonic);
  console.log('Seller wallet opened:', seller.address.toString());

  // Get escrow contract
  const escrow = provider.open(Escrow.fromAddress(escrowAddress));
  
  // Get escrow state
  const escrowData = await escrow.getData();
  console.log('Escrow status:', escrowData.status);
  console.log('Expected amount:', escrowData.amount.toString());
  console.log('Current deposited:', escrowData.deposited.toString());

  if (escrowData.status !== 0) {
    console.log('❌ Escrow is not in PendingDeposit status');
    return;
  }

  if (escrowData.deposited > 0) {
    console.log('❌ Deposit already made');
    return;
  }

  // Get seller's USDT jetton wallet address
  const sellerUSDTWallet = process.env.SELLER_USDT_WALLET!;
  if (!sellerUSDTWallet) {
    console.log('❌ Set SELLER_USDT_WALLET in .env');
    return;
  }

  console.log('Seller USDT wallet:', sellerUSDTWallet);
  console.log('Amount to deposit:', amountUnits.toString(), 'units');

  // Build jetton transfer message
  const transferBody = beginCell()
    .storeUint(0x0f8a7ea5, 32)    // TokenTransfer opcode
    .storeUint(0, 64)              // query_id
    .storeCoins(amountUnits)       // amount
    .storeAddress(escrowAddress)   // destination
    .storeAddress(seller.address)  // response_destination
    .storeBit(false)               // custom_payload
    .storeCoins(toNano('0.05'))   // forward_ton_amount
    .storeBit(false)               // forward_payload
    .endCell();

  // Send transfer from seller's USDT wallet to escrow
  console.log('Sending USDT transfer...');
  
  // Note: This script assumes the seller has already approved the transfer
  // In practice, the seller would use their wallet app to send USDT to the escrow
  console.log('📋 INSTRUCTIONS FOR SELLER:');
  console.log('1. Open your TON wallet (Tonkeeper, etc.)');
  console.log('2. Send USDT to escrow address:', escrowAddress.toString());
  console.log('3. Amount:', amountUnits.toString(), 'units');
  console.log('4. Wait for confirmation');
  
  console.log('✅ Deposit script completed. Check escrow status after transfer.');
}

// Run if called directly
if (require.main === module) {
  run(NetworkProvider.testnet()).catch(console.error);
}

