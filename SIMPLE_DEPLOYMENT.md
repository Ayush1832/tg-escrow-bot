# 🚀 Simple Production Deployment Guide

**Your Approach:** Full TON Connect + Seller Deploys Contracts

## 📋 **What You Need**

### **Required Services:**
1. **DigitalOcean Droplet** - $6/month (Ubuntu 22.04)
2. **Domain Name** - $10-15/year (for wallet connection)
3. **Telegram Bot Token** - Free (from @BotFather)
4. **TON API Key** - Free (from toncenter.com)
5. **3 TON Wallets** - Free (for fee collection)

### **Total Cost: ~$7-8/month**

---

## ⚡ **Quick Deployment (60 minutes)**

### **Step 1: Get Required Accounts** (15 min)
1. **Telegram Bot**: Message @BotFather → Create bot → Get token
2. **Your User ID**: Message @userinfobot → Get your ID
3. **TON API Key**: Go to https://toncenter.com → Register → Get key
4. **Domain**: Buy domain (Namecheap/GoDaddy) - $10-15/year
5. **DigitalOcean**: Sign up → Create $6/month droplet

### **Step 2: Deploy to Server** (30 min)
1. **SSH to server**: `ssh root@your_server_ip`
2. **Run deployment script**: `bash deploy.sh`
3. **Enter your Git repo URL** when prompted
4. **Create .env file** with your values

### **Step 3: Configure Domain** (15 min)
1. **Point domain to server**: Update DNS A record
2. **Get SSL certificate**: `certbot --nginx -d your-domain.com`
3. **Update .env**: Set `DOMAIN=https://your-domain.com`
4. **Restart services**: `pm2 restart all`

---

## 🔧 **Environment Variables (.env)**

```env
# Bot Configuration
BOT_TOKEN=your_bot_token_from_botfather
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
DOMAIN=https://your-domain.com
```

---

## 🎯 **How Your Bot Works**

### **Seller Flow:**
1. **Seller clicks `/sell`** in bot
2. **Connects wallet** via TON Connect (opens web page)
3. **Enters trade details** (buyer, amount, commission)
4. **Bot generates escrow contract** with seller's parameters
5. **Seller's wallet deploys** the contract to mainnet
6. **Seller deposits USDT** into their escrow contract
7. **Trade is active** - buyer can join

### **Buyer Flow:**
1. **Buyer gets escrow address** from seller
2. **Buyer clicks `/buy`** in bot
3. **Enters escrow address** to join trade
4. **Makes off-chain payment** to seller
5. **Seller confirms payment** in bot
6. **USDT released** to buyer automatically

### **Admin Flow:**
1. **Admin clicks `/admin`** in bot
2. **Views active trades** and disputes
3. **Resolves disputes** if needed
4. **Emergency actions** if required

---

## 🧪 **Testing Checklist**

### **After Deployment:**
- [ ] **Bot responds** to `/start`
- [ ] **Wallet connection** works (opens web page)
- [ ] **Trade creation** works (seller flow)
- [ ] **Trade joining** works (buyer flow)
- [ ] **Admin panel** works (admin only)
- [ ] **Contract deployment** works (seller deploys)

### **Test Trade Flow:**
1. **Create test trade** as seller
2. **Connect wallet** successfully
3. **Deploy contract** (testnet first)
4. **Join trade** as buyer
5. **Complete trade** end-to-end

---

## 🚨 **Important Notes**

### **Domain Requirement:**
- **Domain is ONLY for wallet connection** - users never see it
- **Required for TON Connect** to work properly
- **No website needed** - just a technical bridge

### **Contract Deployment:**
- **You don't deploy anything** to mainnet
- **Sellers deploy their own contracts** using their wallets
- **Each trade gets its own contract** - completely isolated
- **No shared contract issues** - much more secure

### **Fee Collection:**
- **3 fee wallets** receive commission automatically
- **Set up before deployment** - can't change easily later
- **Test with small amounts** first

---

## 📊 **Monitoring Commands**

```bash
# Check if services are running
pm2 status

# View logs
pm2 logs

# Restart services
pm2 restart all

# Monitor in real-time
pm2 monit
```

---

## 🆘 **Troubleshooting**

### **Bot Not Responding:**
```bash
pm2 logs escrow-bot
pm2 restart escrow-bot
```

### **Wallet Connection Failing:**
```bash
pm2 logs escrow-server
curl https://your-domain.com/connect
```

### **Domain Issues:**
```bash
# Check if domain points to server
nslookup your-domain.com

# Check if SSL is working
curl -I https://your-domain.com
```

---

## 🎉 **You're Ready!**

**Your bot will have:**
- ✅ **Professional wallet connection** (like blockchain games)
- ✅ **Secure escrow contracts** (each trade isolated)
- ✅ **Admin dispute resolution** (you control disputes)
- ✅ **Automatic fee distribution** (to your 3 wallets)
- ✅ **Scalable architecture** (unlimited concurrent trades)

**Total setup time: ~60 minutes**
**Monthly cost: ~$7-8**
**Maintenance: Minimal**

**Just follow the steps above and your professional escrow bot will be live!** 🚀
