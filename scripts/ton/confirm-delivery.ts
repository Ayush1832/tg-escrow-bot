// scripts/ton/confirm-delivery.ts
import 'dotenv/config';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';

export default async function run(provider: NetworkProvider) {
  // Load environment variables
  const sellerMnemonic = process.env.SELLER_MNEMONIC!;
  const escrowAddress = Address.parse(process.env.ESCROW_ADDRESS!);

  // Open seller wallet
  const seller = await openWalletFromMnemonic(provider, sellerMnemonic);
  console.log('Seller wallet opened:', seller.address.toString());

  // Get escrow contract
  const escrow = provider.open(Escrow.fromAddress(escrowAddress));
  
  // Get escrow state
  const escrowData = await escrow.getData();
  console.log('Escrow status:', escrowData.status);
  console.log('Deposited amount:', escrowData.deposited.toString());
  console.log('Deposit verified:', escrowData.depositVerified);
  console.log('Payout attempted:', escrowData.payoutAttempted);

  // Check if escrow is ready for confirmation
  if (escrowData.status !== 1) {
    console.log('❌ Escrow is not in Active status');
    return;
  }

  if (!escrowData.depositVerified) {
    console.log('❌ Deposit not yet verified');
    return;
  }

  if (escrowData.payoutAttempted) {
    console.log('❌ Payout already attempted');
    return;
  }

  console.log('✅ Escrow ready for confirmation');
  console.log('Buyer address:', escrowData.buyer.toString());
  console.log('Amount to release:', escrowData.deposited.toString(), 'units');

  // Calculate fees
  const fee = (BigInt(escrowData.deposited) * BigInt(escrowData.commissionBps)) / BigInt(10000);
  const toBuyer = BigInt(escrowData.deposited) - fee;
  
  console.log('Platform fee:', fee.toString(), 'units');
  console.log('To buyer:', toBuyer.toString(), 'units');

  // Confirm delivery (this will release USDT to buyer)
  console.log('Confirming delivery and releasing USDT...');
  
  try {
    await escrow.send(
      seller,
      {
        value: toNano('0.1'), // Gas for the transaction
        body: beginCell()
          .storeUint(0x1, 32) // ConfirmDelivery opcode
          .endCell()
      }
    );
    
    console.log('✅ Delivery confirmed! USDT released to buyer');
    console.log('Transaction sent. Check escrow status.');
    
  } catch (error) {
    console.error('❌ Error confirming delivery:', error);
  }
}

// Run if called directly
if (require.main === module) {
  run(NetworkProvider.testnet()).catch(console.error);
}

