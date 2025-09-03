// scripts/ton/confirm.ts
import 'dotenv/config';
import { openWalletFromMnemonic, NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';

export default async function run(provider: NetworkProvider) {
  const signer = await openWalletFromMnemonic(provider, process.env.SELLER_MNEMONIC!);
  const contractAddr = Address.parse(process.env.TRADE_CONTRACT!);
  const escrow = provider.open(Escrow.fromAddress(contractAddr));

  // call confirm() — this will mark Released and (when we augment with actual jetton transfer code) move tokens
  await escrow.sendConfirm(signer, { value: toNano(process.env.CONFIRM_GAS_TON || '0.07') });
  console.log('confirm() called on chain');
}
