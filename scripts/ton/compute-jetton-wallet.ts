import { TonClient } from "@ton/ton";
import { Address, beginCell, Cell, toNano } from "@ton/core";

// PRODUCTION SCRIPT: Compute USDT jetton wallet address for escrow contract
export async function computeUSDTJettonWallet(escrowAddress: Address): Promise<Address> {
  const client = new TonClient({
    endpoint: process.env.TON_NETWORK === 'mainnet' 
      ? "https://toncenter.com/api/v2/jsonRPC"
      : "https://testnet.toncenter.com/api/v2/jsonRPC",
    apiKey: process.env.TON_API_KEY || undefined
  });

  // USDT Master - automatically choose based on network
  const usdtMaster = process.env.TON_NETWORK === 'mainnet'
    ? Address.parse("EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs") // Mainnet USDT
    : Address.parse("kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy"); // Testnet USDT

  try {
    console.log(`Computing USDT jetton wallet for escrow: ${escrowAddress.toString()}`);
    
    // Call USDT master to get the jetton wallet address for this escrow
    const result = await client.runMethod(usdtMaster, "get_wallet_address", [
      { type: "slice", cell: beginCell().storeAddress(escrowAddress).endCell() }
    ]);

    // Access the first item from the result stack
    const walletAddress = result.stack.readAddress();
    if (walletAddress) {
      console.log(`✅ USDT Jetton Wallet Address: ${walletAddress.toString()}`);
      return walletAddress;
    } else {
      throw new Error("Failed to read jetton wallet address from response");
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
