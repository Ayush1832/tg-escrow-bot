// scripts/ton/cancel-no-deposit.ts
import 'dotenv/config';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';

export default async function run(provider: NetworkProvider) {
  // Load environment variables
  const userMnemonic = process.env.SELLER_MNEMONIC || process.env.ADMIN_MNEMONIC!;
  const escrowAddress = Address.parse(process.env.ESCROW_ADDRESS!);
  
  // Determine if this is seller or admin
  const isAdmin = process.env.ADMIN_MNEMONIC && userMnemonic === process.env.ADMIN_MNEMONIC;
  const isSeller = process.env.SELLER_MNEMONIC && userMnemonic === process.env.SELLER_MNEMONIC;

  if (!isAdmin && !isSeller) {
    console.log('❌ Set either SELLER_MNEMONIC or ADMIN_MNEMONIC in .env');
    return;
  }

  // Open user wallet
  const user = await openWalletFromMnemonic(provider, userMnemonic);
  console.log(`${isAdmin ? 'Admin' : 'Seller'} wallet opened:`, user.address.toString());

  // Get escrow contract
  const escrow = provider.open(Escrow.fromAddress(escrowAddress));
  
  // Get escrow state
  const escrowData = await escrow.getData();
  console.log('Escrow status:', escrowData.status);
  console.log('Seller address:', escrowData.seller.toString());
  console.log('Admin address:', escrowData.admin.toString());
  console.log('Deposited amount:', escrowData.deposited.toString());
  console.log('Deadline:', escrowData.deadline.toString());

  // Verify permissions
  if (isSeller && escrowData.seller.toString() !== user.address.toString()) {
    console.log('❌ You are not the seller of this escrow');
    return;
  }

  if (isAdmin && escrowData.admin.toString() !== user.address.toString()) {
    console.log('❌ You are not the admin of this escrow');
    return;
  }

  // Check if escrow is in pending deposit status
  if (escrowData.status !== 0) {
    console.log('❌ Escrow is not in PendingDeposit status');
    return;
  }

  if (escrowData.deposited > 0) {
    console.log('❌ Cannot cancel - deposit already made');
    return;
  }

  // Check deadline restrictions for seller
  if (isSeller && escrowData.deadline > 0) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < escrowData.deadline) {
      console.log('❌ Seller must wait until deadline to cancel');
      console.log('Current time:', now.toString());
      console.log('Deadline:', escrowData.deadline.toString());
      return;
    }
  }

  console.log('✅ Escrow ready for cancellation');
  console.log('Cancelling trade (no deposit made)...');

  // Cancel trade
  try {
    await escrow.send(
      user,
      {
        value: toNano('0.1'), // Gas for the transaction
        body: beginCell()
          .storeUint(0x5, 32) // CancelIfNoDeposit opcode
          .endCell()
      }
    );
    
    console.log('✅ Trade cancelled successfully!');
    console.log('Transaction sent. Check escrow status.');
    
  } catch (error) {
    console.error('❌ Error cancelling trade:', error);
  }
}

// Run if called directly
if (require.main === module) {
  run(NetworkProvider.testnet()).catch(console.error);
}

