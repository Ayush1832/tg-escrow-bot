const hre = require('hardhat');
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ContractModel = require(path.join('..', 'src', 'models', 'Contract'));

async function main() {
  const {
    MONGODB_URI,
    BNB_BSC,
    FEE_WALLET_1,
    FEE_WALLET_2
  } = process.env;

  if (!MONGODB_URI) throw new Error('MONGODB_URI missing');
  if (!BNB_BSC) throw new Error('BNB_BSC missing');
  if (!FEE_WALLET_1) throw new Error('FEE_WALLET_1 missing');

  await mongoose.connect(MONGODB_URI);

  const feePercent = Number(process.env.ESCROW_FEE_PERCENT || 0); // default 0%
  const w1 = FEE_WALLET_1;
  const w2 = FEE_WALLET_2 || FEE_WALLET_1;

  const EscrowVault = await hre.ethers.getContractFactory('EscrowVault');
  const contract = await EscrowVault.deploy(
    BNB_BSC,
    w1,
    w2,
    feePercent * 100 // Convert percentage to basis points for contract
  );
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log('BNB-BSC EscrowVault deployed at:', address);

  // Drop old unique index if it exists
  try {
    await ContractModel.collection.dropIndex('name_1');
  } catch (e) {
    // Index might not exist, ignore error
  }

  await ContractModel.updateOne(
    { name: 'EscrowVault', token: 'BNB', network: 'BSC', feePercent: feePercent },
    { 
      name: 'EscrowVault', 
      token: 'BNB',
      network: 'BSC',
      address, 
      feePercent: feePercent,
      deployedAt: new Date() 
    },
    { upsert: true }
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
