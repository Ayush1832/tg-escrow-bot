// scripts/ton/claim-expired.ts
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
  console.log('Deposit verified:', escrowData.depositVerified);
  console.log('Payout attempted:', escrowData.payoutAttempted);
  console.log('Amount deposited:', escrowData.deposited.toString());
  console.log('Deadline:', escrowData.deadline.toString());

  // Verify this is the correct buyer
  if (escrowData.buyer.toString() !== buyer.address.toString()) {
    console.log('❌ This escrow does not belong to you');
    return;
  }

  // Check if escrow is in active status
  if (escrowData.status !== 1) {
    console.log('❌ Escrow is not in Active status');
    return;
  }

  if (!escrowData.depositVerified) {
    console.log('❌ Deposit not yet verified - cannot claim expired');
    return;
  }

  if (escrowData.payoutAttempted) {
    console.log('❌ Payout already attempted');
    return;
  }

  // Check if deadline is set
  if (escrowData.deadline === 0) {
    console.log('❌ No deadline set for this escrow');
    return;
  }

  // Check if deadline has passed
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < escrowData.deadline) {
    console.log('❌ Deadline not yet reached');
    console.log('Current time:', now.toString());
    console.log('Deadline:', escrowData.deadline.toString());
    console.log('Time remaining:', (escrowData.deadline - now).toString(), 'seconds');
    return;
  }

  console.log('✅ Escrow expired and ready for claim');
  console.log('Amount to claim:', escrowData.deposited.toString(), 'units');

  // Calculate fees
  const fee = (BigInt(escrowData.deposited) * BigInt(escrowData.commissionBps)) / BigInt(10000);
  const toBuyer = BigInt(escrowData.deposited) - fee;
  
  console.log('Platform fee:', fee.toString(), 'units');
  console.log('To buyer:', toBuyer.toString(), 'units');

  // Claim expired trade
  try {
    console.log('Claiming expired trade...');
    
    await escrow.send(
      buyer,
      {
        value: toNano('0.1'), // Gas for the transaction
        body: beginCell()
          .storeUint(0x6, 32) // ClaimExpired opcode
          .endCell()
      }
    );
    
    console.log('✅ Expired trade claimed successfully!');
    console.log('USDT released to buyer due to deadline expiration.');
    console.log('Transaction sent. Check escrow status.');
    
  } catch (error) {
    console.error('❌ Error claiming expired trade:', error);
  }
}

// Run if called directly
if (require.main === module) {
  run(NetworkProvider.testnet()).catch(console.error);
}

