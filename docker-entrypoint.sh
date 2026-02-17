#!/bin/sh
set -e

echo "=== PDW Monitor ==="
echo "DB path: ${DB_PATH:-/data/pdw.db}"
echo "Port: ${PORT:-3000}"

# ── Auto-generate JWT_SECRET if not provided ──
if [ -z "$JWT_SECRET" ]; then
  JWT_FILE="/data/.jwt-secret"
  if [ -f "$JWT_FILE" ]; then
    echo "Loading JWT secret from $JWT_FILE"
    JWT_SECRET=$(cat "$JWT_FILE")
  else
    echo "Generating JWT secret (first run)..."
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
    printf '%s' "$JWT_SECRET" > "$JWT_FILE"
    chmod 600 "$JWT_FILE"
    echo "JWT secret generated and saved to $JWT_FILE"
  fi
  export JWT_SECRET
fi

# ── Auto-generate API_KEY if not provided and not in DB ──
if [ -z "$API_KEY" ]; then
  API_KEY_FILE="/data/.api-key"
  if [ -f "$API_KEY_FILE" ]; then
    echo "Loading API key from $API_KEY_FILE"
    API_KEY=$(cat "$API_KEY_FILE")
  else
    echo "Generating API key (first run)..."
    API_KEY=$(node -e "console.log('pdw_' + require('crypto').randomBytes(24).toString('base64url'))")
    printf '%s' "$API_KEY" > "$API_KEY_FILE"
    chmod 600 "$API_KEY_FILE"
    echo "API key generated and saved to $API_KEY_FILE"
  fi
  export API_KEY
fi

# ── Auto-create admin account on first run ──
# Default password is 'changeme' if not explicitly set
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"
node -e "
  const bcrypt = require('bcrypt');
  const db = require('./server/db');
  const row = db.prepare(\"SELECT id FROM users WHERE role = 'admin'\").get();
  if (row) {
    console.log('Admin account already exists, skipping creation.');
    db.close();
    process.exit(0);
  }
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  bcrypt.hash(password, 12).then(hash => {
    db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'admin');
    console.log('Admin account created: ' + username + ' (default password: changeme)');
    db.close();
  }).catch(err => {
    console.error('Failed to create admin:', err.message);
    process.exit(1);
  });
"

# ── Seed API key into settings table if not already set ──
node -e "
  const db = require('./server/db');
  const row = db.prepare(\"SELECT value FROM settings WHERE key = 'api_key'\").get();
  if (!row) {
    const apiKey = process.env.API_KEY || '';
    if (apiKey) {
      db.prepare(\"INSERT OR IGNORE INTO settings (key, value) VALUES ('api_key', ?)\").run(apiKey);
      console.log('API key saved to settings database.');
    }
  }
  db.close();
"

# Generate VAPID keys automatically if not provided
if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
  VAPID_FILE="/data/.vapid-keys"
  if [ -f "$VAPID_FILE" ]; then
    echo "Loading VAPID keys from $VAPID_FILE"
    . "$VAPID_FILE"
    export VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY
  else
    echo "Generating VAPID keys (first run)..."
    node -e "
      const wp = require('web-push');
      const k = wp.generateVAPIDKeys();
      const fs = require('fs');
      const content = 'VAPID_PUBLIC_KEY=' + k.publicKey + '\nVAPID_PRIVATE_KEY=' + k.privateKey + '\n';
      fs.writeFileSync('/data/.vapid-keys', content, { mode: 0o600 });
      console.log('VAPID keys generated and saved to /data/.vapid-keys');
      console.log('Public key: ' + k.publicKey);
    "
    . "$VAPID_FILE"
    export VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY
  fi
fi

echo "Starting server..."
exec node server/index.js
