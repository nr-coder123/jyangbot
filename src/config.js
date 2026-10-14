'use strict';
const path = require('path');
require('dotenv').config();

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

module.exports = {
  token: process.env.DISCORD_TOKEN || '',
  guildId: process.env.GUILD_ID || '',
  port: Number(process.env.PORT) || 3000,
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),

  // Dashboard login. Anyone who knows these can open the dashboard.
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'jianghu',
  adminPasswordFromEnv: !!process.env.ADMIN_PASSWORD,
  // Set ADMIN_RESET=true once to force the admin password back to ADMIN_PASSWORD (forgot-password recovery).
  adminReset: bool(process.env.ADMIN_RESET, false),
  sessionSecret: process.env.SESSION_SECRET || '',

  // Storage: MongoDB if MONGODB_URI is set, otherwise a JSON file in DATA_DIR.
  mongoUri: process.env.MONGODB_URI || '',
  mongoDb: process.env.MONGODB_DB || 'jianghu',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // Needed for typing "strength 5" in chat. Turn on "Message Content Intent" in the Discord developer portal.
  messageContent: bool(process.env.ENABLE_MESSAGE_CONTENT, true),
};
