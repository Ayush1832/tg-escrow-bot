// scripts/ton/seller-deposit-jetton.ts
import 'dotenv/config';
import { Address, beginCell, toNano, Cell } from '@ton/core';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';

// TEP-74 jetton transfer function selector is commonly 0xf8a7ea5 (32 bits); some implementations use 0x0f8a7ea5 -- adjust if transfer fails
const TRANSFER_OP = 0xf8a7ea5; // common

function buildJettonTransferBody(dest: Address, amountUnits: bigint, forward_payload: Cell | null): Cell {
  const b = beginCell();
  b.storeUint(TRANSFER_OP, 32);
  b.storeUint(0, 64); // query id
  b.storeCoins(amountUnits); // amount - storeCoins is convenient wrapper (note: token amounts are not TON but Jetton; keep exact smallest units)
  b.storeAddress(dest);      // destination address
  // we don't set response_to here
  if (forward_payload) {
    b.storeRef(forward_payload);
  } else {
    b.storeRef(beginCell().endCell());
  }
  return b.endCell();
}

export default async function run(provider: NetworkProvider) {
  const sellerMnemonic = process.env.SELLER_MNEMONIC!;
  const sellerWallet = await openWalletFromMnemonic(provider, sellerMnemonic);

  // seller_jetton_wallet MUST be the seller's jetton wallet contract address (NOT the token master)
  const sellerJettonWallet = Address.parse(process.env.SELLER_JETTON_WALLET!);
  const escrowAddr = Address.parse(process.env.TRADE_CONTRACT!);
  const amountUnits = BigInt(process.env.AMOUNT_JETTON_UNITS!); // e.g., 1000000 for 1 USDT (6 decimals)

  // Build forward_payload to trigger onJettonTransfer on the escrow contract (if required)
  // Many wallets forward the transfer and the wallet contract will call `onTransfer/receive` on escrow.
  const forward = beginCell().endCell();

  const body = buildJettonTransferBody(escrowAddr, amountUnits, forward);

  // The seller must send a TON message to their jetton wallet with this body.
  // We construct an internal message from seller main wallet to sellerJettonWallet with small TON attached to cover gas.
  await provider.sendMessage({
    from: sellerWallet.address,
    to: sellerJettonWallet,
    value: toNano(process.env.JETTON_TRANSFER_GAS_TON || '0.05'),
    body: body.toBoc().toString('base64')
  });

  console.log('Jetton transfer message sent to seller jetton wallet; check chain for onJettonTransfer callback to escrow');
}
