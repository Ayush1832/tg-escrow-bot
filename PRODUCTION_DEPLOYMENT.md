# 🚀 Production Deployment Guide

Complete step-by-step guide to deploy your TON Escrow Bot to production with mainnet support.

## 📋 Pre-Deployment Checklist

### ✅ Code Verification
- [x] Smart contract is production-ready
- [x] Bot has real TON Connect integration
- [x] All test files removed
- [x] Clean codebase with no unused code
- [x] Comprehensive README created

### ⚠️ Required Updates for Production

1. **Update USDT Master Address** (Testnet → Mainnet)
2. **Update TON RPC Endpoints** (Testnet → Mainnet)
3. **Configure Production Environment Variables**
4. **Set up Production Server**
5. **Deploy Smart Contract to Mainnet**
6. **Configure Domain and SSL**

---

## 🔧 Step 1: Update Code for Mainnet

### 1.1 Update USDT Master Address

**File:** `scripts/ton/compute-jetton-wallet.ts`

```typescript
// Change from testnet to mainnet USDT master
const usdtMaster = Address.parse("EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"); // Mainnet USDT
```

### 1.2 Update TON RPC Endpoints

**File:** `scripts/ton/compute-jetton-wallet.ts`

```typescript
const client = new TonClient({
  endpoint: "https://toncenter.com/api/v2/jsonRPC", // Mainnet endpoint
  apiKey: process.env.TON_API_KEY || undefined
});
```

**File:** `bot/utils/tonClient.ts`

```typescript
const client = new TonClient({
  endpoint: "https://toncenter.com/api/v2/jsonRPC", // Mainnet endpoint
  apiKey: process.env.TON_API_KEY || undefined
});
```

### 1.3 Update Web Server URL

**File:** `bot/index.ts`

```typescript
// Change from localhost to your production domain
const connectionUrl = `https://your-domain.com/connect?user_id=${userId}&bot_token=${BOT_TOKEN}`;
```

---

## 🌐 Step 2: Production Environment Variables

Create `.env` file with these **PRODUCTION** values:

```env
# ===========================================
# PRODUCTION ENVIRONMENT VARIABLES
# ===========================================

# Bot Configuration
BOT_TOKEN=your_production_bot_token_from_botfather
ADMIN_USER_ID=your_telegram_user_id

# TON Configuration (MAINNET)
TON_API_KEY=your_toncenter_api_key
TON_NETWORK=mainnet

# Fee Wallets (MAINNET TON ADDRESSES)
FEE_WALLET_1=your_mainnet_fee_wallet_1
FEE_WALLET_2=your_mainnet_fee_wallet_2
FEE_WALLET_3=your_mainnet_fee_wallet_3

# Server Configuration
PORT=3000
NODE_ENV=production

# Domain Configuration
DOMAIN=https://your-domain.com
```

### 🔑 How to Get Required Values:

#### **BOT_TOKEN**
1. Message @BotFather on Telegram
2. Create new bot: `/newbot`
3. Choose name and username
4. Copy the token

#### **ADMIN_USER_ID**
1. Message @userinfobot on Telegram
2. Copy your user ID

#### **TON_API_KEY**
1. Go to https://toncenter.com/
2. Register and get API key
3. Use for mainnet access

#### **FEE_WALLETS**
- Create 3 TON wallets (Tonkeeper, MyTonWallet, etc.)
- Copy their mainnet addresses
- These will receive commission fees

---

## 🖥️ Step 3: Server Setup & Deployment

### 3.1 Choose Your Server Provider

**Recommended Options:**
- **DigitalOcean** (Recommended) - $5-10/month
- **AWS EC2** - $5-15/month
- **Vultr** - $5-10/month
- **Linode** - $5-10/month

### 3.2 DigitalOcean Setup (Recommended)

#### Create Droplet:
1. Go to https://digitalocean.com
2. Create account
3. Create new Droplet:
   - **OS:** Ubuntu 22.04 LTS
   - **Plan:** Basic $6/month (1GB RAM, 1 CPU)
   - **Region:** Choose closest to your users
   - **Authentication:** SSH Key (recommended)

#### Connect to Server:
```bash
ssh root@your_server_ip
```

#### Install Dependencies:
```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Install PM2 (Process Manager)
npm install -g pm2

# Install Git
apt install git -y

# Install Nginx (for reverse proxy)
apt install nginx -y
```

### 3.3 Deploy Your Code

#### Clone Repository:
```bash
# Create app directory
mkdir /var/www/escrow-bot
cd /var/www/escrow-bot

# Clone your repository
git clone https://github.com/yourusername/tg-escrow-bot.git .

# Install dependencies
npm install

# Build smart contract
npm run build:ton
```

#### Set Environment Variables:
```bash
# Create production .env file
nano .env
# Paste your production environment variables
```

#### Set up PM2:
```bash
# Create PM2 ecosystem file
nano ecosystem.config.js
```

**ecosystem.config.js:**
```javascript
module.exports = {
  apps: [
    {
      name: 'escrow-bot',
      script: 'bot/start.ts',
      interpreter: 'ts-node',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G'
    },
    {
      name: 'escrow-server',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G'
    }
  ]
};
```

#### Start Services:
```bash
# Start both services with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
```

---

## 🌍 Step 4: Domain & SSL Setup

### 4.1 Configure Domain

#### Buy Domain (if needed):
- **Namecheap** - $10-15/year
- **GoDaddy** - $10-15/year
- **Cloudflare** - $10-15/year

#### Point Domain to Server:
1. Go to your domain registrar
2. Update DNS A record:
   - **Type:** A
   - **Name:** @ (or subdomain)
   - **Value:** Your server IP

### 4.2 Configure Nginx

#### Create Nginx Config:
```bash
nano /etc/nginx/sites-available/escrow-bot
```

**Nginx Configuration:**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### Enable Site:
```bash
# Enable the site
ln -s /etc/nginx/sites-available/escrow-bot /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

### 4.3 Install SSL Certificate

#### Install Certbot:
```bash
apt install certbot python3-certbot-nginx -y
```

#### Get SSL Certificate:
```bash
certbot --nginx -d your-domain.com
```

---

## 📱 Step 5: Smart Contract Setup (Seller Deploys)

### 5.1 Contract Code Ready
✅ **No deployment needed from you!** The smart contract code is already built and ready.

### 5.2 How It Works:
1. **Seller clicks `/sell`** in your bot
2. **Bot generates escrow contract** with seller's parameters
3. **Seller's wallet deploys** the contract to mainnet
4. **Each trade gets its own contract** - completely independent

### 5.3 Benefits of This Approach:
- ✅ **No mainnet deployment costs** for you
- ✅ **Each trade is isolated** - no shared contract issues
- ✅ **Seller controls their contract** - more secure
- ✅ **Scalable** - unlimited concurrent trades

---

## 🧪 Step 6: Testing & Verification

### 6.1 Test Bot Commands:
1. Message your bot: `/start`
2. Test: `/sell` → Connect wallet → Create escrow
3. Test: `/admin` (admin only)
4. Test: `/status`

### 6.2 Test Wallet Connection:
1. Click "Connect Wallet" in bot
2. Verify web page opens
3. Test wallet connection
4. Verify bot receives connection

### 6.3 Test Smart Contract:
1. Deploy test escrow
2. Deposit USDT
3. Test trade flow
4. Test dispute resolution

---

## 📊 Step 7: Monitoring & Maintenance

### 7.1 Set up Monitoring:
```bash
# Monitor PM2 processes
pm2 monit

# View logs
pm2 logs escrow-bot
pm2 logs escrow-server
```

### 7.2 Set up Log Rotation:
```bash
# Install logrotate
apt install logrotate -y

# Configure log rotation for PM2
pm2 install pm2-logrotate
```

### 7.3 Backup Strategy:
```bash
# Create backup script
nano /var/www/backup.sh
```

**Backup Script:**
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf /var/backups/escrow-bot-$DATE.tar.gz /var/www/escrow-bot
find /var/backups -name "escrow-bot-*.tar.gz" -mtime +7 -delete
```

---

## 🚨 Step 8: Security & Production Hardening

### 8.1 Firewall Setup:
```bash
# Install UFW
apt install ufw -y

# Configure firewall
ufw allow ssh
ufw allow 80
ufw allow 443
ufw enable
```

### 8.2 Environment Security:
```bash
# Secure .env file
chmod 600 .env
chown root:root .env
```

### 8.3 Regular Updates:
```bash
# Set up automatic security updates
apt install unattended-upgrades -y
dpkg-reconfigure unattended-upgrades
```

---

## 📈 Step 9: Scaling & Performance

### 9.1 Database Upgrade (Future):
- Consider PostgreSQL for production
- Implement Redis for session storage
- Add database backup strategy

### 9.2 Load Balancing (Future):
- Multiple server instances
- Load balancer configuration
- CDN for static assets

---

## 🎯 Final Checklist

### ✅ Pre-Launch:
- [ ] Code updated for mainnet
- [ ] Environment variables configured
- [ ] Server deployed and running
- [ ] Domain configured with SSL
- [ ] Smart contract deployed to mainnet
- [ ] Bot tested and working
- [ ] Wallet connection tested
- [ ] Monitoring set up

### ✅ Post-Launch:
- [ ] Monitor bot performance
- [ ] Check error logs daily
- [ ] Monitor server resources
- [ ] Update dependencies regularly
- [ ] Backup data regularly

---

## 🆘 Troubleshooting

### Common Issues:

#### Bot Not Responding:
```bash
# Check PM2 status
pm2 status

# Restart bot
pm2 restart escrow-bot
```

#### Wallet Connection Failing:
```bash
# Check server logs
pm2 logs escrow-server

# Verify domain is accessible
curl https://your-domain.com/connect
```

#### Smart Contract Issues:
```bash
# Check contract deployment
npm run deploy:escrow

# Verify contract address
```

---

## 📞 Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs`
2. Check Nginx logs: `tail -f /var/log/nginx/error.log`
3. Verify environment variables
4. Test each component individually

---

**🎉 Congratulations! Your TON Escrow Bot is now live on mainnet!**

**Total Cost:** ~$10-15/month for server + domain
**Setup Time:** 2-4 hours
**Maintenance:** Minimal with proper monitoring
