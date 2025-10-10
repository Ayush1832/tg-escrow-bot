const { ethers } = require('ethers');
const BIP32Factory = require('bip32').default;
const bip39 = require('bip39');
const config = require('../../config');

class WalletService {
  constructor() {
    this.hdNode = null;
    this.hotWallets = {};
    this.derivationIndex = 0;
    this.init();
  }

  init() {
    // Ensure private key has 0x prefix
    const privateKey = config.HOT_WALLET_PRIVATE_KEY.startsWith('0x') 
      ? config.HOT_WALLET_PRIVATE_KEY 
      : '0x' + config.HOT_WALLET_PRIVATE_KEY;
    
    // Initialize hot wallet for each network
    this.hotWallets = {
      BSC: new ethers.Wallet(privateKey),
      SEPOLIA: new ethers.Wallet(privateKey),
      ETH: new ethers.Wallet(privateKey),
      LTC: new ethers.Wallet(privateKey)
    };
    
    // Generate HD wallet from hot wallet private key
    const privateKeyHex = privateKey.startsWith('0x') 
      ? privateKey.slice(2) 
      : privateKey;
    const seed = Buffer.from(privateKeyHex, 'hex');
    const bip32 = BIP32Factory(require('tiny-secp256k1'));
    this.hdNode = bip32.fromSeed(seed);
  }

  generateDepositAddress(escrowId) {
    // For now, use a simple approach - generate a deterministic address
    // In production, you'd want proper HD wallet derivation
    const hash = ethers.keccak256(ethers.toUtf8Bytes(escrowId + Date.now()));
    const address = ethers.computeAddress(hash);
    
    return {
      address,
      derivationPath: `m/44'/60'/0'/0/${this.derivationIndex++}`
    };
  }

  async sendUSDT(toAddress, amount) {
    try {
      // Create provider
      const provider = new ethers.JsonRpcProvider(config.BSC_RPC_URL);
      const wallet = this.hotWallet.connect(provider);

      // USDT contract ABI (minimal)
      const usdtAbi = [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address account) view returns (uint256)"
      ];

      const usdtContract = new ethers.Contract(
        config.USDT_SEPOLIA,
        usdtAbi,
        wallet
      );

      // Check balance
      const balance = await usdtContract.balanceOf(wallet.address);
      if (balance < amount) {
        throw new Error('Insufficient USDT balance');
      }

      // Send USDT
      const tx = await usdtContract.transfer(toAddress, amount);
      await tx.wait();

      return tx.hash;
    } catch (error) {
      console.error('Error sending USDT:', error);
      throw error;
    }
  }

  async getUSDTBalance(address) {
    try {
      const provider = new ethers.JsonRpcProvider(config.BSC_RPC_URL);
      
      const usdtAbi = [
        "function balanceOf(address account) view returns (uint256)"
      ];

      const usdtContract = new ethers.Contract(
        config.USDT_SEPOLIA,
        usdtAbi,
        provider
      );

      const balance = await usdtContract.balanceOf(address);
      return ethers.formatUnits(balance, 6); // USDT has 6 decimals
    } catch (error) {
      console.error('Error getting USDT balance:', error);
      return 0;
    }
  }

  getHotWalletAddress() {
    return this.hotWallet.address;
  }
}

module.exports = new WalletService();
