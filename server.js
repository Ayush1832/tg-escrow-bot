// server.js - Simple web server for wallet connection
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Store wallet connections temporarily
const walletConnections = new Map();

// Serve wallet connect page
app.get('/connect', (req, res) => {
    const { user_id, bot_token } = req.query;
    
    if (!user_id || !bot_token) {
        return res.status(400).send('Missing required parameters');
    }
    
    res.sendFile(path.join(__dirname, 'public', 'wallet-connect.html'));
});

// Handle wallet connection callback
app.post('/api/wallet-connected', (req, res) => {
    const { userId, wallet, botToken } = req.body;
    
    if (!userId || !wallet || !botToken) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Store the connection
    walletConnections.set(userId, {
        wallet: wallet,
        timestamp: Date.now(),
        botToken: botToken
    });
    
    console.log(`✅ Wallet connected for user ${userId}:`, wallet.account.address);
    
    res.json({ success: true, message: 'Wallet connection stored' });
});

// Get wallet connection status
app.get('/api/wallet-status/:userId', (req, res) => {
    const { userId } = req.params;
    const connection = walletConnections.get(userId);
    
    if (connection) {
        res.json({ connected: true, wallet: connection.wallet });
    } else {
        res.json({ connected: false });
    }
});

// Clean up old connections (older than 1 hour)
setInterval(() => {
    const now = Date.now();
    for (const [userId, connection] of walletConnections.entries()) {
        if (now - connection.timestamp > 60 * 60 * 1000) { // 1 hour
            walletConnections.delete(userId);
            console.log(`🧹 Cleaned up old connection for user ${userId}`);
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

app.listen(PORT, () => {
    console.log(`🌐 Wallet connection server running on port ${PORT}`);
    console.log(`🔗 Connect URL: http://localhost:${PORT}/connect`);
});

// Export for bot to use
module.exports = { walletConnections };
