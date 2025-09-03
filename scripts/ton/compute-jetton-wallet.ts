import { TonClient } from "@ton/ton";
import { Address, beginCell, Cell } from "@ton/core";

// PRODUCTION SCRIPT: Compute USDT jetton wallet address for escrow contract
export async function computeUSDTJettonWallet(escrowAddress: Address): Promise<Address> {
  const client = new TonClient({
    endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
    apiKey: process.env.TON_API_KEY || undefined
  });

  // USDT Master on testnet
  const usdtMaster = Address.parse("kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy");

  try {
    console.log(`Computing USDT jetton wallet for escrow: ${escrowAddress.toString()}`);
    
    // Call USDT master to get the jetton wallet address for this escrow
    const result = await client.runMethod(usdtMaster, "get_wallet_address", [
      { type: "slice", cell: beginCell().storeAddress(escrowAddress).endCell() }
    ]);

    if (result.stack.length > 0) {
      const walletAddress = result.stack[0].readAddress();
      console.log(`✅ USDT Jetton Wallet Address: ${walletAddress.toString()}`);
      return walletAddress;
    } else {
      throw new Error("Failed to get jetton wallet address from master");
    }

  } catch (error) {
    console.error("❌ Error computing jetton wallet:", error);
    throw error;
  }
}

// Helper function to use in deployment scripts
export async function getJettonWalletForEscrow(escrowAddress: string): Promise<string> {
  const escrow = Address.parse(escrowAddress);
  const wallet = await computeUSDTJettonWallet(escrow);
  return wallet.toString();
}

// Example usage
if (require.main === module) {
  // Test with a sample address
  const testAddress = Address.parse("0:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
  computeUSDTJettonWallet(testAddress)
    .then(wallet => {
      console.log("Jetton wallet computed successfully:", wallet.toString());
    })
    .catch(console.error);
}
