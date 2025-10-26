const hre = require('hardhat');
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ContractModel = require(path.join('..', 'src', 'models', 'Contract'));

async function deployUSDTContracts() {
  try {
    const {
      MONGODB_URI,
      USDT_SEPOLIA,
      FEE_WALLET_1,
      FEE_WALLET_2
    } = process.env;

    if (!MONGODB_URI) throw new Error('MONGODB_URI missing');
    if (!USDT_SEPOLIA) throw new Error('USDT_SEPOLIA missing');
    if (!FEE_WALLET_1) throw new Error('FEE_WALLET_1 missing');

    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const token = 'USDT';
    const network = 'SEPOLIA';
    const count = 10;
    const feePercent = 0; // 0% fee

    console.log(`🚀 Deploying ${count} ${token}-${network} contracts with ${feePercent}% fee...`);
    console.log(`📍 USDT Address: ${USDT_SEPOLIA}`);

    const w1 = FEE_WALLET_1;
    const w2 = FEE_WALLET_2 || FEE_WALLET_1;

    const deployedContracts = [];

    for (let i = 1; i <= count; i++) {
      try {
        console.log(`\n📦 Deploying contract ${i}/${count}...`);
        
        const EscrowVault = await hre.ethers.getContractFactory('EscrowVault');
        const contract = await EscrowVault.deploy(
          USDT_SEPOLIA,
          w1,
          w2,
          feePercent * 100 // 0 basis points
        );
        
        await contract.waitForDeployment();
        const address = await contract.getAddress();
        
        console.log(`✅ Contract ${i} deployed at: ${address}`);

        // Save to database
        const contractData = {
          name: 'EscrowVault',
          token: token,
          network: network,
          address: address,
          feePercent: feePercent,
          status: 'deployed',
          deployedAt: new Date()
        };

        await ContractModel.create(contractData);
        deployedContracts.push(contractData);

        console.log(`💾 Contract ${i} saved to database`);
        
        // Wait 2 seconds between deployments
        if (i < count) {
          console.log('⏳ Waiting 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`❌ Error deploying contract ${i}:`, error);
      }
    }

    console.log('\n🎉 USDT-SEPOLIA Deployment Complete!');
    console.log(`✅ Deployed: ${deployedContracts.length}/${count} contracts`);
    console.log(`💰 Fee: ${feePercent}% (Free)`);
    console.log(`🔗 USDT Address: ${USDT_SEPOLIA}`);

    if (deployedContracts.length > 0) {
      console.log('\n📋 Contract Addresses:');
      deployedContracts.forEach((contract, index) => {
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
    process.exit(1);
  }
}

deployUSDTContracts().catch((e) => {
  console.error('❌ Script failed:', e);
  process.exit(1);
});
