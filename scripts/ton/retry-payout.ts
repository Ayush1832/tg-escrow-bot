// scripts/ton/retry-payout.ts
import 'dotenv/config';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';

export default async function run(provider: NetworkProvider) {
  // Load environment variables
  const adminMnemonic = process.env.ADMIN_MNEMONIC!;
  const escrowAddress = Address.parse(process.env.ESCROW_ADDRESS!);

  // Open admin wallet
  const admin = await openWalletFromMnemonic(provider, adminMnemonic);
  console.log('Admin wallet opened:', admin.address.toString());

  // Get escrow contract
  const escrow = provider.open(Escrow.fromAddress(escrowAddress));
  
  // Get escrow state
  const escrowData = await escrow.getData();
  console.log('Escrow status:', escrowData.status);
  console.log('Admin address:', escrowData.admin.toString());
  console.log('Deposit verified:', escrowData.depositVerified);
  console.log('Payout attempted:', escrowData.payoutAttempted);
  console.log('Amount deposited:', escrowData.deposited.toString());

  // Verify this is the correct admin
  if (escrowData.admin.toString() !== admin.address.toString()) {
    console.log('❌ You are not the admin of this escrow');
    return;
  }

  // Check if escrow is in a state where retry is possible
  if (escrowData.status !== 1 && escrowData.status !== 3 && escrowData.status !== 4) {
    console.log('❌ Escrow status does not allow retry');
    return;
  }

  if (!escrowData.depositVerified) {
    console.log('❌ Deposit not yet verified');
    return;
  }

  console.log('✅ Escrow ready for payout retry');
  console.log('Current status:', escrowData.status);
  console.log('Amount to retry:', escrowData.deposited.toString(), 'units');

  // Calculate fees
  const fee = (BigInt(escrowData.deposited) * BigInt(escrowData.commissionBps)) / BigInt(10000);
  const toBuyer = BigInt(escrowData.deposited) - fee;
  
  console.log('Platform fee:', fee.toString(), 'units');
  console.log('To buyer:', toBuyer.toString(), 'units');

  // Retry payout
  try {
    console.log('Retrying payout with new query IDs...');
    
    await escrow.send(
      admin,
      {
        value: toNano('0.1'), // Gas for the transaction
        body: beginCell()
          .storeUint(0x9, 32) // RetryPayout opcode
          .endCell()
      }
    );
    
    console.log('✅ Payout retry initiated successfully!');
    console.log('New transfers sent with unique query IDs.');
    console.log('Transaction sent. Check escrow events.');
    
  } catch (error) {
    console.error('❌ Error retrying payout:', error);
  }
}

// Run if called directly
if (require.main === module) {
  run(NetworkProvider.testnet()).catch(console.error);
}

