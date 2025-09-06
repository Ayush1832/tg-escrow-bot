// scripts/ton/raise-dispute.ts
import 'dotenv/config';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';

export default async function run(provider: NetworkProvider) {
  // Load environment variables
  const buyerMnemonic = process.env.BUYER_MNEMONIC!;
  const escrowAddress = Address.parse(process.env.ESCROW_ADDRESS!);

  // Open buyer wallet
  const buyer = await openWalletFromMnemonic(provider, buyerMnemonic);
  console.log('Buyer wallet opened:', buyer.address.toString());

  // Get escrow contract
  const escrow = provider.open(Escrow.fromAddress(escrowAddress));
  
  // Get escrow state
  const escrowData = await escrow.getData();
  console.log('Escrow status:', escrowData.status);
  console.log('Buyer address:', escrowData.buyer.toString());
  console.log('Seller address:', escrowData.seller.toString());
  console.log('Deposit verified:', escrowData.depositVerified);
  console.log('Amount deposited:', escrowData.deposited.toString());

  // Verify this is the correct buyer
  if (escrowData.buyer.toString() !== buyer.address.toString()) {
    console.log('❌ This escrow does not belong to you');
    return;
  }

  // Check if escrow is in dispute state
  if (escrowData.status === 2) {
    console.log('❌ Dispute already raised');
    return;
  }

  // Check if escrow is active and ready for dispute
  if (escrowData.status !== 1) {
    console.log('❌ Escrow is not in Active status');
    return;
  }

  if (!escrowData.depositVerified) {
    console.log('❌ Deposit not yet verified - cannot raise dispute');
    return;
  }

  console.log('✅ Escrow ready for dispute');
  console.log('Amount in escrow:', escrowData.deposited.toString(), 'units');
  console.log('Raising dispute...');

  // Raise dispute
  try {
    await escrow.send(
      buyer,
      {
        value: toNano('0.1'), // Gas for the transaction
        body: beginCell()
          .storeUint(0x2, 32) // RaiseDispute opcode
          .endCell()
      }
    );
    
    console.log('✅ Dispute raised successfully!');
    console.log('Admin will review and resolve the dispute.');
    console.log('Transaction sent. Check escrow status.');
    
  } catch (error) {
    console.error('❌ Error raising dispute:', error);
  }
}

// Run if called directly
if (require.main === module) {
  run(NetworkProvider.testnet()).catch(console.error);
}

