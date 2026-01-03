const { ethers } = require("ethers");
const config = require("../../config");
const Contract = require("../models/Contract");
const Escrow = require("../models/Escrow");
const GroupPool = require("../models/GroupPool");

class AddressAssignmentService {
  /**
   * Normalize chain name to network name
   * Maps: BNB -> BSC, ETHEREUM -> ETH, etc.
   */
  normalizeChainToNetwork(chain) {
    if (!chain) return "BSC";
    const upper = chain.toUpperCase();
    if (upper === "BNB" || upper === "BEP-20") return "BSC";
    if (upper === "ETHEREUM") return "ETH";
    if (upper === "MATIC" || upper === "POLYGON") return "POLYGON";
    return upper;
  }

  async assignDepositAddress(
    escrowId,
    token,
    network,
    amount,
    feePercent = null,
    groupId = null
  ) {
    try {
      const normalizedToken = (token || "").toUpperCase();
      let normalizedNetwork = network
        ? this.normalizeChainToNetwork(network)
        : "BSC";
      const normalizedFeePercent =
        feePercent !== null
          ? Number(feePercent)
          : Number(config.ESCROW_FEE_PERCENT || 0);

      if (!groupId) {
        const escrow = await Escrow.findOne({ escrowId });
        if (escrow && escrow.groupId) {
          groupId = escrow.groupId;
          if (escrow.chain && !network) {
            normalizedNetwork = this.normalizeChainToNetwork(escrow.chain);
          }
        }
      }

      normalizedNetwork = normalizedNetwork.toUpperCase();

      if (groupId) {
        try {
          // 1. Try to find the specific contract assigned to this group via GroupPool
          // This is the authoritative source for the 1:1 mapping
          const group = await GroupPool.findOne({ groupId });
          if (group && group.contracts) {
            // Check contracts map (supports both Map and Object access for safety)
            let assignedContract = null;
            if (
              group.contracts.get &&
              typeof group.contracts.get === "function"
            ) {
              assignedContract = group.contracts.get(normalizedToken);
            } else if (group.contracts[normalizedToken]) {
              assignedContract = group.contracts[normalizedToken];
            }

            // Also check if network matches (default BSC)
            if (assignedContract && assignedContract.address) {
              // Verify network if strict, but usually token+group implies the network
              return {
                address: assignedContract.address,
                contractAddress: assignedContract.address,
                sharedWithAmount: null,
              };
            }
          }

          // 2. Fallback: Check for legacy contractAddress field (mostly for USDT)
          if (group && group.contractAddress && normalizedToken === "USDT") {
            return {
              address: group.contractAddress,
              contractAddress: group.contractAddress,
              sharedWithAmount: null,
            };
          }

          // 3. Fallback: Look up Contract model (if populated with groupId - currently not used but good for future)
          let contract = await Contract.findOne({
            name: "EscrowVault",
            token: normalizedToken,
            network: normalizedNetwork,
            feePercent: normalizedFeePercent,
            groupId: groupId,
            status: "deployed",
          });

          if (!contract) {
            // 4. Final Fallback: Find ANY deployed contract for this token/tier
            contract = await Contract.findOne({
              name: "EscrowVault",
              token: normalizedToken,
              network: normalizedNetwork,
              feePercent: normalizedFeePercent,
              status: "deployed",
            });
          }

          if (!contract) {
            throw new Error(
              `No EscrowVault contract found for ${normalizedToken} on ${normalizedNetwork} with ${normalizedFeePercent}% fee. ` +
                `Please deploy the contract first using: npm run deploy`
            );
          }

          return {
            address: contract.address,
            contractAddress: contract.address,
            sharedWithAmount: null,
          };
        } catch (groupError) {
          console.error(
            "Error getting group-specific contract address, falling back to general contract:",
            groupError
          );
        }
      }

      let contract = null;
      if (groupId) {
        contract = await Contract.findOne({
          name: "EscrowVault",
          token: normalizedToken,
          network: normalizedNetwork,
          feePercent: normalizedFeePercent,
          groupId: groupId,
          status: "deployed",
        });
      }

      if (!contract) {
        contract = await Contract.findOne({
          name: "EscrowVault",
          token: normalizedToken,
          network: normalizedNetwork,
          feePercent: normalizedFeePercent,
          status: "deployed",
        });
      }

      if (!contract) {
        throw new Error(
          `No EscrowVault contract found for ${normalizedToken} on ${normalizedNetwork} with ${normalizedFeePercent}% fee. ` +
            `Please deploy the contract first using: npm run deploy`
        );
      }

      const contractAddress = contract.address;

      return {
        address: contractAddress,
        contractAddress: contractAddress,
        sharedWithAmount: null,
      };
    } catch (error) {
      console.error("Error getting deposit address:", error);
      throw error;
    }
  }

  async releaseDepositAddress(escrowId) {
    return true;
  }

  async cleanupAbandonedAddresses() {
    return 0;
  }

  async getAddressPoolStats() {
    try {
      const privateKey = config.HOT_WALLET_PRIVATE_KEY.startsWith("0x")
        ? config.HOT_WALLET_PRIVATE_KEY
        : "0x" + config.HOT_WALLET_PRIVATE_KEY;
      const wallet = new ethers.Wallet(privateKey);
      const depositAddress = wallet.address;

      return {
        total: 1,
        singleAddress: depositAddress,
        byToken: {
          ALL_TOKENS: depositAddress,
        },
      };
    } catch (error) {
      console.error("Error getting address pool stats:", error);
      return { total: 0, singleAddress: null, byToken: {} };
    }
  }

  async initializeAddressPool(feePercent = null) {
    return {
      message:
        "Address pool initialization no longer needed. Single deposit address is used for all tokens.",
    };
  }
}

module.exports = new AddressAssignmentService();
