# Telegram Escrow Bot - Commands Reference

## 👤 User Commands

### Trade Management

`/deal` - Start a new escrow trade by tagging another user (main group only)

`/restart` - Restart a trade from the beginning (trade group only, admin/seller/buyer before confirmation, admin only after)

`/dispute <reason>` - Report a dispute in an ongoing trade (trade group only, buyer/seller/admin)

### Fund Management

`/release` - Release funds to the buyer (trade group only, admin/seller)

`/release <amount>` - Release partial amount to buyer (trade group only, admin only)

`/refund` - Refund all funds to the seller (trade group only, admin only)

`/refund <amount>` - Refund partial amount to seller (trade group only, admin only)

`/balance` - Check available balance for current trade (trade group only, anyone)

### Verification

`/verify <address>` - Verify a wallet address before starting a trade (main group only)

### Statistics

`/stats` - View your trading statistics (group chat)

`/stats @username` - View another user's trading statistics (group chat)

`/leaderboard` - View top 5 traders by volume (group chat)

---

## 🔧 Admin Commands

### Statistics and Monitoring

`/admin_stats` - View overall escrow statistics (total, active, completed, refunded)

`/admin_trade_stats` - View detailed trade statistics by fee percentage

`/admin_recent_trades [limit]` - View recent trades with pagination (max 50)

`/admin_export_trades` - Export all trade data to CSV file

### Group Pool Management

`/admin_pool` - View group pool status and statistics

`/admin_pool_add <groupId>` - Add new group to the pool

`/admin_pool_list` - List all groups in the pool

`/admin_pool_delete <groupId>` - Delete specific group from pool

`/admin_pool_delete_all` - Delete ALL groups from pool (dangerous)

`/admin_group_reset` - Reset group when no deposits were made (removes users, recycles group, deletes escrow)

`/admin_reset_force` - Force reset group regardless of status (removes users, recycles group)

`/admin_reset_all_groups` - Force reset ALL groups at once (ignores escrows, removes users, recycles all)

### Settlement Commands (Group Only)

`/release` - Release funds to buyer (admin/seller, in group chat)

`/release <amount>` - Release partial amount to buyer (admin only, in group chat)

`/refund` - Refund funds to seller (admin only, in group chat)

`/refund <amount>` - Refund partial amount to seller (admin only, in group chat)

### Fund Management

`/admin_withdraw_bsc_usdt` - Withdraw excess USDT from BSC escrow contracts to admin wallet (private chat only, admin only)

### Help and Reference

`/admin_help` - Display all admin commands with descriptions

---

## 📋 Notes

- All commands are case-sensitive
- Commands must start with `/`
- Some commands only work in specific contexts (main group vs trade group)
- Admin commands require admin privileges (configured in `.env`)
- Statistics only include fully completed trades with blockchain transaction proof
- Partial releases/refunds are tracked and balance is maintained accurately
- All amounts use wei precision for blockchain accuracy

---

## 🔄 Automatic Features

The bot includes several automatic features that don't require commands:

- **Automatic Group Recycling**: Groups are automatically recycled 15 minutes after trade completion
- **Automatic User Removal**: Users are automatically removed from groups after recycling delay
- **Automatic Deposit Detection**: Deposits are automatically detected via blockchain monitoring
- **Automatic Status Updates**: Trade status updates automatically based on actions
- **Automatic Completion Feed**: Completed trades are automatically posted to completion feed channel
- **Automatic Dispute Notifications**: Disputes are automatically sent to dispute channel
