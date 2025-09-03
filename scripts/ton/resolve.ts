// scripts/ton/resolve.ts
import 'dotenv/config';
import { openWalletFromMnemonic } from '@ton/blueprint';
import { Escrow } from '../../contracts/ton/build/Escrow/Escrow_Escrow';
import { Address, toNano } from '@ton/core';

export async function resolveToSeller(provider: any) {
  const admin = await openWalletFromMnemonic(provider, process.env.ADMIN_MNEMONIC!);
  const escrow = provider.open(Escrow.fromAddress(Address.parse(process.env.TRADE_CONTRACT!)));
  await escrow.sendResolveToSeller(admin, { value: toNano(process.env.RESOLVE_GAS_TON || '0.07') });
  console.log('resolveToSeller called');
}

export async function resolveToBuyer(provider: any) {
  const admin = await openWalletFromMnemonic(provider, process.env.ADMIN_MNEMONIC!);
  const escrow = provider.open(Escrow.fromAddress(Address.parse(process.env.TRADE_CONTRACT!)));
  await escrow.sendResolveToBuyer(admin, { value: toNano(process.env.RESOLVE_GAS_TON || '0.07') });
  console.log('resolveToBuyer called');
}
