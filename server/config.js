const path = require('path');

module.exports = {
  // Server
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || '0.0.0.0',

  // Database
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pdw.db'),

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || 'change-me-in-production-' + require('crypto').randomBytes(16).toString('hex'),
  JWT_EXPIRY: process.env.JWT_EXPIRY || '30d',

  // Client ingestion API key (shared secret between client script and server)
  API_KEY: process.env.API_KEY || 'change-me-pdw-api-key',

  // VAPID keys for web push (generate with: npm run generate-vapid)
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_EMAIL: process.env.VAPID_EMAIL || 'mailto:admin@example.com',

  // Message dedup window (ms) - messages with same capcode+content within this window are deduped
  DEDUP_WINDOW_MS: parseInt(process.env.DEDUP_WINDOW_MS || '30000', 10),

  // Multipart message join timeout (ms) - how long to wait for remaining parts
  MULTIPART_TIMEOUT_MS: parseInt(process.env.MULTIPART_TIMEOUT_MS || '10000', 10),

  // Max messages to keep in DB (0 = unlimited)
  MAX_MESSAGES: parseInt(process.env.MAX_MESSAGES || '0', 10),
};
