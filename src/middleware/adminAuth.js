const config = require('../../config');

/**
 * Middleware to authenticate admin users
 * Checks if the user is an admin based on username or user ID
 */
function requireAdmin() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id;
      const username = ctx.from?.username;

      // Check if user ID matches admin user ID
      if (config.ADMIN_USER_ID && userId === parseInt(config.ADMIN_USER_ID)) {
        return next();
      }

      // Check if username matches admin username
      if (config.ADMIN_USERNAME && username === config.ADMIN_USERNAME) {
        return next();
      }

      // If neither matches, deny access
      await ctx.reply('❌ Access denied. Admin privileges required.');
      console.log(`🚫 Unauthorized admin access attempt by user ${userId} (@${username})`);
      
    } catch (error) {
      console.error('Error in admin auth middleware:', error);
      await ctx.reply('❌ Authentication error. Please try again.');
    }
  };
}

/**
 * Check if user is admin without sending response
 */
function isAdmin(ctx) {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;

  return (
    (config.ADMIN_USER_ID && userId === parseInt(config.ADMIN_USER_ID)) ||
    (config.ADMIN_USERNAME && username === config.ADMIN_USERNAME)
  );
}

module.exports = {
  requireAdmin,
  isAdmin
};
