/**
 * Initial setup script - creates admin account and generates config hints.
 */
const readline = require('readline');
const bcrypt = require('bcrypt');
const db = require('./db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.log('=== PDW Monitor Setup ===\n');

  // Check if admin exists
  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (existing) {
    console.log('Admin account already exists. To reset, delete the database file and re-run.\n');
  } else {
    const username = (await ask('Admin username [admin]: ')).trim() || 'admin';
    const password = (await ask('Admin password: ')).trim();
    if (!password) {
      console.error('Password cannot be empty.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(password, 12);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'admin');
    console.log(`\nAdmin account "${username}" created.\n`);
  }

  console.log('--- Environment variables you should set ---');
  console.log('JWT_SECRET=<random-secret>');
  console.log('API_KEY=<shared-key-for-client-script>');
  console.log('');
  console.log('For push notifications, generate VAPID keys:');
  console.log('  npm run generate-vapid');
  console.log('Then set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars.\n');

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
