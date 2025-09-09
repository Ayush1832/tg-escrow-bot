#!/bin/bash

# TON Escrow Bot Production Deployment Script
# Run this script on your production server

echo "🚀 Starting TON Escrow Bot Production Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "Please run as root (use sudo)"
    exit 1
fi

print_status "Updating system packages..."
apt update && apt upgrade -y

print_status "Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

print_status "Installing PM2..."
npm install -g pm2

print_status "Installing Git..."
apt install git -y

print_status "Installing Nginx..."
apt install nginx -y

print_status "Installing UFW Firewall..."
apt install ufw -y

print_status "Installing Certbot for SSL..."
apt install certbot python3-certbot-nginx -y

print_status "Creating application directory..."
mkdir -p /var/www/escrow-bot
cd /var/www/escrow-bot

print_status "Cloning repository..."
# Replace with your actual repository URL
read -p "Enter your Git repository URL: " REPO_URL
git clone $REPO_URL .

print_status "Installing dependencies..."
npm install

print_status "Building smart contract..."
npm run build:ton
print_status "Smart contract ready - sellers will deploy their own contracts"

print_status "Creating logs directory..."
mkdir -p logs

print_status "Setting up environment file..."
if [ ! -f .env ]; then
    print_warning "Please create .env file with your production environment variables"
    print_warning "Copy env.production.example to .env and fill in your values"
    cp env.production.example .env
    nano .env
fi

print_status "Setting up PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

print_status "Configuring firewall..."
ufw allow ssh
ufw allow 80
ufw allow 443
ufw --force enable

print_status "Setting up Nginx configuration..."
cat > /etc/nginx/sites-available/escrow-bot << EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

ln -s /etc/nginx/sites-available/escrow-bot /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

print_status "Testing Nginx configuration..."
nginx -t

if [ $? -eq 0 ]; then
    print_status "Restarting Nginx..."
    systemctl restart nginx
    systemctl enable nginx
else
    print_error "Nginx configuration test failed!"
    exit 1
fi

print_status "Setting up log rotation..."
pm2 install pm2-logrotate

print_status "Setting up automatic security updates..."
apt install unattended-upgrades -y
echo 'Unattended-Upgrade::Automatic-Reboot "false";' >> /etc/apt/apt.conf.d/50unattended-upgrades

print_status "Creating backup script..."
cat > /var/www/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf /var/backups/escrow-bot-$DATE.tar.gz /var/www/escrow-bot
find /var/backups -name "escrow-bot-*.tar.gz" -mtime +7 -delete
EOF

chmod +x /var/www/backup.sh

# Add to crontab for daily backups
(crontab -l 2>/dev/null; echo "0 2 * * * /var/www/backup.sh") | crontab -

print_status "Setting up monitoring..."
pm2 monit &

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Next Steps:"
echo "1. Configure your domain DNS to point to this server"
echo "2. Run: certbot --nginx -d your-domain.com"
echo "3. Update .env file with your domain: DOMAIN=https://your-domain.com"
echo "4. Restart services: pm2 restart all"
echo "5. Smart contract is ready - sellers deploy their own contracts"
echo ""
echo "🔧 Useful Commands:"
echo "- Check status: pm2 status"
echo "- View logs: pm2 logs"
echo "- Restart bot: pm2 restart escrow-bot"
echo "- Monitor: pm2 monit"
echo ""
echo "🌐 Your bot should be accessible at: http://$(curl -s ifconfig.me)"
echo ""
print_warning "Don't forget to:"
print_warning "1. Set up your domain and SSL certificate"
print_warning "2. Smart contract is ready - no deployment needed"
print_warning "3. Test all functionality before going live"
