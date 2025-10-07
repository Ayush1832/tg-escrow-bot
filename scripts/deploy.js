const hre = require('hardhat');
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ContractModel = require(path.join('..', 'src', 'models', 'Contract'));

async function main() {
  const {
    MONGODB_URI,
    USDT_CONTRACT_ADDRESS,
    FEE_WALLET_1,
    FEE_WALLET_2,
    FEE_WALLET_3,
    ESCROW_FEE_BPS
  } = process.env;

  if (!MONGODB_URI) throw new Error('MONGODB_URI missing');
  if (!USDT_CONTRACT_ADDRESS) throw new Error('USDT_CONTRACT_ADDRESS missing');
  if (!FEE_WALLET_1) throw new Error('FEE_WALLET_1 missing');

  await mongoose.connect(MONGODB_URI);

  const feeBps = Number(ESCROW_FEE_BPS || 100); // default 1%
  const w1 = FEE_WALLET_1;
  const w2 = FEE_WALLET_2 || FEE_WALLET_1;
  const w3 = FEE_WALLET_3 || FEE_WALLET_1;

  const EscrowVault = await hre.ethers.getContractFactory('EscrowVault');
  const contract = await EscrowVault.deploy(
    USDT_CONTRACT_ADDRESS,
    w1,
    w2,
    w3,
    feeBps
  );
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log('EscrowVault deployed at:', address);

  await ContractModel.updateOne(
    { name: 'EscrowVault' },
    { name: 'EscrowVault', address, network: hre.network.name, deployedAt: new Date() },
    { upsert: true }
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


