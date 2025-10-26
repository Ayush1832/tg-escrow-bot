const hre = require('hardhat');
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ContractModel = require(path.join(__dirname, '..', 'src', 'models', 'Contract'));

async function deployUSDCBSC10() {
  try {
    const {
      MONGODB_URI,
      USDC_BSC,
      FEE_WALLET_1,
      FEE_WALLET_2,
      HOT_WALLET_PRIVATE_KEY
    } = process.env;

    if (!MONGODB_URI) throw new Error('MONGODB_URI missing');
    if (!USDC_BSC) throw new Error('USDC_BSC token address missing');
    if (!FEE_WALLET_1) throw new Error('FEE_WALLET_1 missing');
    if (!HOT_WALLET_PRIVATE_KEY) throw new Error('HOT_WALLET_PRIVATE_KEY missing');

    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const feePercent = 0; // 0% escrow fee
    const w1 = FEE_WALLET_1;
    const w2 = FEE_WALLET_2 || FEE_WALLET_1;
    const deployCount = 10;

    console.log(`🚀 Deploying ${deployCount} USDC-BSC contracts with ${feePercent}% fee...`);
    console.log(`📍 USDC Address: ${USDC_BSC}`);

    const deployedAddresses = [];

    for (let i = 1; i <= deployCount; i++) {
      try {
        console.log(`\n📦 Deploying contract ${i}/${deployCount}...`);

        const EscrowVault = await hre.ethers.getContractFactory('EscrowVault');
        const contract = await EscrowVault.deploy(
          USDC_BSC,
          w1,
          w2,
          feePercent * 100 // Convert to basis points (0% = 0)
        );

        await contract.waitForDeployment();
        const address = await contract.getAddress();

        console.log(`✅ Contract ${i} deployed at: ${address}`);

        // Save to database
        const contractData = {
          name: 'EscrowVault',
          token: 'USDC',
          network: 'BSC',
          address: address,
          feePercent: feePercent,
          status: 'deployed',
          deployedAt: new Date()
        };

        await ContractModel.create(contractData);
        deployedAddresses.push(contractData);

        console.log(`💾 Contract ${i} saved to database`);

        // Wait 2 seconds between deployments to avoid rate limits
        if (i < deployCount) {
          console.log(`⏳ Waiting 2 seconds before next deployment...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.error(`❌ Error deploying contract ${i}:`, error);
      }
    }

    console.log(`\n🎉 USDC-BSC Deployment Complete!`);
    console.log(`✅ Deployed: ${deployedAddresses.length}/${deployCount} contracts`);
    console.log(`💰 Fee: ${feePercent}%`);
    console.log(`🔗 USDC Address: ${USDC_BSC}`);

    if (deployedAddresses.length > 0) {
      console.log('\n📋 Contract Addresses:');
      deployedAddresses.forEach((contract, index) => {
        console.log(`${index + 1}. ${contract.address}`);
      });
    }

    console.log('\n🔧 Next Steps:');
    console.log('1. Start your bot');
    console.log('2. Run: /admin_init_addresses');
    console.log('3. Check: /admin_address_pool');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Deployment failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

deployUSDCBSC10().catch((e) => {
  console.error(e);
  process.exit(1);
});
