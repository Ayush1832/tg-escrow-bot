// scripts/ton/resolve-dispute.ts
import 'dotenv/config';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';

export default async function run(provider: NetworkProvider) {
  // Load environment variables
  const adminMnemonic = process.env.ADMIN_MNEMONIC!;
  const escrowAddress = Address.parse(process.env.ESCROW_ADDRESS!);
  
  // Get resolution preference from command line or env
  const resolveToBuyer = process.argv.includes('--buyer') || process.env.RESOLVE_TO_BUYER === 'true';
  const resolveToSeller = process.argv.includes('--seller') || process.env.RESOLVE_TO_SELLER === 'true';

  if (!resolveToBuyer && !resolveToSeller) {
    console.log('❌ Specify resolution: --buyer or --seller');
    console.log('Example: npm run resolve-dispute -- --buyer');
    return;
  }

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

  // Check if escrow is in dispute or active state
  if (escrowData.status !== 1 && escrowData.status !== 2) {
    console.log('❌ Escrow is not in Active or Dispute status');
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

  console.log('✅ Escrow ready for admin resolution');
  console.log('Resolution:', resolveToBuyer ? 'Release to Buyer' : 'Refund to Seller');

  // Calculate fees if releasing to buyer
  if (resolveToBuyer) {
    const fee = (BigInt(escrowData.deposited) * BigInt(escrowData.commissionBps)) / BigInt(10000);
    const toBuyer = BigInt(escrowData.deposited) - fee;
    console.log('Platform fee:', fee.toString(), 'units');
    console.log('To buyer:', toBuyer.toString(), 'units');
  }

  // Resolve dispute
  try {
    const opcode = resolveToBuyer ? 0x3 : 0x4; // ResolveToBuyer or ResolveToSeller
    const action = resolveToBuyer ? 'releasing to buyer' : 'refunding to seller';
    
    console.log(`Resolving dispute: ${action}...`);
    
    await escrow.send(
      admin,
      {
        value: toNano('0.1'), // Gas for the transaction
        body: beginCell()
          .storeUint(opcode, 32) // ResolveToBuyer or ResolveToSeller opcode
          .endCell()
      }
    );
    
    console.log(`✅ Dispute resolved successfully! ${action}`);
    console.log('Transaction sent. Check escrow status.');
    
  } catch (error) {
    console.error('❌ Error resolving dispute:', error);
  }
}

// Run if called directly
if (require.main === module) {
  run(NetworkProvider.testnet()).catch(console.error);
}

