const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Ensure data directory exists
const dataDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(config.DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Messages table
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capcode TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    protocol TEXT NOT NULL DEFAULT 'POCSAG',
    bitrate INTEGER,
    function_code INTEGER,
    source TEXT DEFAULT 'unknown',
    call_type TEXT,
    location TEXT,
    trucks TEXT,
    is_multipart INTEGER NOT NULL DEFAULT 0,
    multipart_id TEXT,
    raw TEXT,
    hash TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_capcode ON messages(capcode);
  CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at);
  CREATE INDEX IF NOT EXISTS idx_messages_call_type ON messages(call_type);
  CREATE INDEX IF NOT EXISTS idx_messages_location ON messages(location);
  CREATE INDEX IF NOT EXISTS idx_messages_hash ON messages(hash);

  -- Capcode aliases (friendly names for capcodes)
  CREATE TABLE IF NOT EXISTS capcode_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capcode TEXT UNIQUE NOT NULL,
    alias TEXT NOT NULL,
    colour TEXT DEFAULT '#6b7280',
    icon TEXT DEFAULT 'radio',
    call_type TEXT,
    location TEXT
  );

  -- Groups (regions / categories)
  CREATE TABLE IF NOT EXISTS groups_ (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    colour TEXT DEFAULT '#3b82f6',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Group members (capcodes belonging to a group)
  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_(id) ON DELETE CASCADE,
    capcode TEXT NOT NULL,
    UNIQUE(group_id, capcode)
  );
  CREATE INDEX IF NOT EXISTS idx_group_members_capcode ON group_members(capcode);

  -- User favourites (groups a user has favourited)
  CREATE TABLE IF NOT EXISTS user_favourites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups_(id) ON DELETE CASCADE,
    notify INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, group_id)
  );

  -- User filters (saved filter presets)
  CREATE TABLE IF NOT EXISTS user_filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filter_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Push subscriptions
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    keys_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Settings (key-value store for admin-configurable settings)
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Migrations ───
// Add notes column to capcode_aliases if it doesn't exist
try {
  db.exec("ALTER TABLE capcode_aliases ADD COLUMN notes TEXT");
} catch (e) {
  // Column already exists, ignore
}

// Add keyword_alerts table
db.exec(`
  CREATE TABLE IF NOT EXISTS keyword_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    notify INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, keyword)
  );
`);

// Add min_alarm_level column to users for alarm level alerts
try {
  db.exec("ALTER TABLE users ADD COLUMN min_alarm_level INTEGER DEFAULT NULL");
} catch (e) {
  // Column already exists, ignore
}

// Add hidden column to capcode_aliases for filtering out junk capcodes
try {
  db.exec("ALTER TABLE capcode_aliases ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
} catch (e) {
  // Column already exists, ignore
}

// Group keywords table (keyword matching in addition to capcodes)
db.exec(`
  CREATE TABLE IF NOT EXISTS group_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    UNIQUE(group_id, keyword)
  );
`);

// Normalize capcodes: strip leading zeros for consistent matching across FLEX/POCSAG
try {
  db.exec("UPDATE group_members SET capcode = CASE WHEN LENGTH(LTRIM(capcode, '0')) = 0 THEN '0' ELSE LTRIM(capcode, '0') END WHERE capcode LIKE '0%'");
  db.exec("UPDATE capcode_aliases SET capcode = CASE WHEN LENGTH(LTRIM(capcode, '0')) = 0 THEN '0' ELSE LTRIM(capcode, '0') END WHERE capcode LIKE '0%'");
} catch (e) {
  // Migration may fail on duplicate after normalization, that's ok
}

module.exports = db;
