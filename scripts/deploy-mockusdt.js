const hre = require('hardhat');
require('dotenv').config();

async function main() {
  const MockUSDT = await hre.ethers.getContractFactory('MockUSDT');
  const initial = hre.ethers.parseUnits('1000000', 6); // 1,000,000 mUSDT
  const token = await MockUSDT.deploy(initial);
  await token.waitForDeployment();
  const addr = await token.getAddress();
  console.log('MockUSDT deployed at:', addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


