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

// ─── Performance & reliability pragmas ───
// WAL mode: allows concurrent readers while writing (critical for multi-user)
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Wait up to 5 seconds if DB is locked by another operation (prevents SQLITE_BUSY errors)
db.pragma('busy_timeout = 5000');
// NORMAL sync is safe with WAL and significantly faster than FULL
db.pragma('synchronous = NORMAL');
// 64MB page cache for faster reads on large datasets
db.pragma('cache_size = -64000');
// Keep temp tables in memory for faster sorting/grouping
db.pragma('temp_store = MEMORY');
// Memory-map first 256MB of the DB file for faster sequential reads
db.pragma('mmap_size = 268435456');

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
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    colour TEXT DEFAULT '#3b82f6',
    created_by INTEGER REFERENCES users(id),
    user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, user_id)
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

// Add must_change_password column to users for forcing password change on first login
try {
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
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

// User preferences table (default view, etc.)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    default_view TEXT DEFAULT 'live',
    default_group_id INTEGER DEFAULT NULL,
    default_keyword TEXT DEFAULT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Notification log table (tracks sent notifications per user)
db.exec(`
  CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    capcode TEXT,
    title TEXT NOT NULL,
    body TEXT,
    match_type TEXT NOT NULL,
    match_detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id, created_at);
`);

// Silenced capcodes per user (suppresses notifications for specific capcodes)
db.exec(`
  CREATE TABLE IF NOT EXISTS silenced_capcodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    capcode TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, capcode)
  );
`);

// Error log table (admin-visible server-side errors)
db.exec(`
  CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'error',
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    context TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);
`);

// ─── Performance indexes ───
// push_subscriptions: queried by user_id frequently
db.exec('CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)');
// user_filters: queried by user_id
db.exec('CREATE INDEX IF NOT EXISTS idx_user_filters_user ON user_filters(user_id)');
// silenced_capcodes: queried by capcode in sendPushForMessage
db.exec('CREATE INDEX IF NOT EXISTS idx_silenced_capcodes_capcode ON silenced_capcodes(capcode)');
// keyword_alerts: queried by notify for push matching
db.exec('CREATE INDEX IF NOT EXISTS idx_keyword_alerts_notify ON keyword_alerts(notify)');
// messages: content search (partial - helps with prefix matching)
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content)');
// notification_log: capcode for filtering
db.exec('CREATE INDEX IF NOT EXISTS idx_notification_log_capcode ON notification_log(capcode)');

// Add group_id column to keyword_alerts for scoping keywords to groups
try {
  db.exec("ALTER TABLE keyword_alerts ADD COLUMN group_id INTEGER DEFAULT NULL REFERENCES groups_(id) ON DELETE SET NULL");
} catch (e) {
  // Column already exists, ignore
}

// Alarm level alert group scoping (per-user, multi-select groups)
// Empty table = nationwide (all groups). Rows = restrict to specific groups.
db.exec(`
  CREATE TABLE IF NOT EXISTS alarm_level_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups_(id) ON DELETE CASCADE,
    UNIQUE(user_id, group_id)
  );
  CREATE INDEX IF NOT EXISTS idx_alarm_level_groups_user ON alarm_level_groups(user_id);
`);

// Normalize capcodes: strip leading zeros for consistent matching across FLEX/POCSAG
try {
  db.exec("UPDATE group_members SET capcode = CASE WHEN LENGTH(LTRIM(capcode, '0')) = 0 THEN '0' ELSE LTRIM(capcode, '0') END WHERE capcode LIKE '0%'");
  db.exec("UPDATE capcode_aliases SET capcode = CASE WHEN LENGTH(LTRIM(capcode, '0')) = 0 THEN '0' ELSE LTRIM(capcode, '0') END WHERE capcode LIKE '0%'");
} catch (e) {
  // Migration may fail on duplicate after normalization, that's ok
}

// Add default_region column to user_preferences
try {
  db.exec("ALTER TABLE user_preferences ADD COLUMN default_region TEXT DEFAULT NULL");
} catch (e) {
  // Column already exists, ignore
}

// Add user_id column to groups_ for user-private groups (NULL = global/admin)
try {
  db.exec("ALTER TABLE groups_ ADD COLUMN user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE");
} catch (e) {
  // Column already exists, ignore
}

module.exports = db;
