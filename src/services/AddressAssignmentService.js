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

      const normalizedFeePercent = feePercent !== null ? Number(feePercent) : 0;

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
          const group = await GroupPool.findOne({ groupId });
          if (group && group.contracts) {
            let assignedContract = null;
            if (
              group.contracts.get &&
              typeof group.contracts.get === "function"
            ) {
              assignedContract = group.contracts.get(normalizedToken);
              if (
                !assignedContract ||
                assignedContract.network !== normalizedNetwork
              ) {
                const specificKey = `${normalizedToken}_${normalizedNetwork}`;
                const specificContract = group.contracts.get(specificKey);
                if (specificContract) assignedContract = specificContract;
              }
            } else {
              assignedContract = group.contracts[normalizedToken];
              if (
                !assignedContract ||
                assignedContract.network !== normalizedNetwork
              ) {
                const specificKey = `${normalizedToken}_${normalizedNetwork}`;
                if (group.contracts[specificKey])
                  assignedContract = group.contracts[specificKey];
              }
            }

            if (assignedContract && assignedContract.address) {
              return {
                address: assignedContract.address,
                contractAddress: assignedContract.address,
                sharedWithAmount: null,
              };
            }
          }

          if (
            group &&
            group.contractAddress &&
            normalizedToken === "USDT" &&
            normalizedNetwork === "BSC"
          ) {
            return {
              address: group.contractAddress,
              contractAddress: group.contractAddress,
              sharedWithAmount: null,
            };
          }

          let contract = await Contract.findOne({
            name: "EscrowVault",
            token: normalizedToken,
            network: normalizedNetwork,
            feePercent: normalizedFeePercent,
            groupId: groupId,
            status: "deployed",
          });

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
