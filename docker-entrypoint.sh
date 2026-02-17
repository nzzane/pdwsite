#!/bin/sh
set -e

echo "=== PDW Monitor ==="
echo "DB path: ${DB_PATH:-/data/pdw.db}"
echo "Port: ${PORT:-3000}"

# Auto-create admin account on first run if ADMIN_PASSWORD is set
if [ -n "$ADMIN_PASSWORD" ]; then
  # Check if any admin user exists
  if ! node -e "
    const db = require('./server/db');
    const row = db.prepare(\"SELECT id FROM users WHERE role = 'admin'\").get();
    if (row) process.exit(0);
    process.exit(1);
  " 2>/dev/null; then
    echo "Creating admin account (username: ${ADMIN_USERNAME:-admin})..."
    node -e "
      const bcrypt = require('bcrypt');
      const db = require('./server/db');
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD;
      bcrypt.hash(password, 12).then(hash => {
        db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'admin');
        console.log('Admin account created: ' + username);
      });
    "
  else
    echo "Admin account already exists, skipping creation."
  fi
fi

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
