const express = require('express');
const { requireAuth, requireAdmin, requireApiKey, login, register } = require('./auth');
const db = require('./db');
const config = require('./config');
const parser = require('./parser');
const webpush = require('web-push');

const router = express.Router();

// ─── Broadcast helper (set by server on startup) ───
let broadcast = () => {};
function setBroadcast(fn) {
  broadcast = fn;
}

// ─── Health check (unauthenticated - used by Docker HEALTHCHECK) ───
router.get('/api/health', (req, res) => {
  try {
    // Verify DB is accessible
    const row = db.prepare("SELECT COUNT(*) as count FROM users").get();
    const wsClients = req.app.get('wsClientCount') || 0;
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
      db: 'ok',
      users: row.count,
      wsClients,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ─── Auth routes ───

router.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const result = await login(username, password);
    if (!result) return res.status(401).json({ error: 'Invalid credentials' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/api/auth/register', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (role && role !== 'user' && role !== 'admin') return res.status(400).json({ error: 'Invalid role' });
    const result = await register(username, password, role || 'user');
    res.json(result);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

router.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    const bcrypt = require('bcrypt');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ─── Admin: user management ───

router.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  res.json(users);
});

router.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ ok: true });
});

router.put('/api/admin/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { role } = req.body;
  if (role !== 'user' && role !== 'admin') return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  res.json({ ok: true });
});

// ─── Admin: settings ───

router.get('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  // If api_key not in DB yet, show the env var value
  if (!settings.api_key) {
    settings.api_key = config.API_KEY || '';
  }
  res.json(settings);
});

router.put('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  const { key, value } = req.body;
  if (!key || typeof value !== 'string') return res.status(400).json({ error: 'Key and value required' });
  // Only allow known settings keys
  const allowedKeys = ['api_key'];
  if (!allowedKeys.includes(key)) return res.status(400).json({ error: 'Unknown setting: ' + key });
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')").run(key, value, value);
  res.json({ ok: true });
});

router.post('/api/admin/settings/regenerate-api-key', requireAuth, requireAdmin, (req, res) => {
  const crypto = require('crypto');
  const newKey = 'pdw_' + crypto.randomBytes(24).toString('base64url');
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('api_key', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')").run(newKey, newKey);
  res.json({ api_key: newKey });
});

// ─── Messages ───

router.get('/api/messages', requireAuth, (req, res) => {
  const {
    limit = 100,
    offset = 0,
    capcode,
    call_type,
    exclude_call_type,
    location,
    trucks,
    group_id,
    search,
    since,
  } = req.query;

  let sql = 'SELECT m.* FROM messages m';
  const params = [];
  const conditions = [];

  if (group_id) {
    sql += " INNER JOIN group_members gm ON LTRIM(m.capcode, '0') = LTRIM(gm.capcode, '0') AND gm.group_id = ?";
    params.push(parseInt(group_id, 10));
  }

  if (capcode) {
    conditions.push('m.capcode = ?');
    params.push(capcode);
  }
  if (call_type) {
    conditions.push('m.call_type = ?');
    params.push(call_type);
  }
  if (exclude_call_type) {
    conditions.push('(m.call_type IS NULL OR m.call_type != ?)');
    params.push(exclude_call_type);
  }
  if (location) {
    conditions.push('m.location LIKE ?');
    params.push(`%${location}%`);
  }
  if (trucks) {
    conditions.push('m.trucks LIKE ?');
    params.push(`%${trucks}%`);
  }
  if (search) {
    conditions.push('m.content LIKE ?');
    params.push(`%${search}%`);
  }
  if (since) {
    conditions.push('m.received_at > ?');
    params.push(since);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY m.received_at DESC LIMIT ? OFFSET ?';
  params.push(Math.min(parseInt(limit, 10) || 100, 500), parseInt(offset, 10) || 0);

  const messages = db.prepare(sql).all(...params);

  // Enrich with computed fields not stored in DB
  const aliasStmt = db.prepare('SELECT alias, colour, icon, notes FROM capcode_aliases WHERE capcode = ?');
  for (const msg of messages) {
    const priority = parser.extractPriority(msg.content);
    if (priority) msg.priority = priority;
    const alias = aliasStmt.get(parser.normalizeCapcode(msg.capcode));
    if (alias) {
      msg.alias = alias.alias;
      msg.alias_colour = alias.colour;
      msg.alias_notes = alias.notes;
    }
    const incidentNum = parser.extractIncidentNumber(msg.content);
    if (incidentNum) msg.incident_number = incidentNum;
  }

  res.json(messages);
});

router.get('/api/messages/stats', requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const today = db.prepare("SELECT COUNT(*) as count FROM messages WHERE received_at > datetime('now', '-1 day')").get().count;
  const callTypes = db.prepare(
    "SELECT call_type, COUNT(*) as count FROM messages WHERE call_type IS NOT NULL AND received_at > datetime('now', '-1 day') GROUP BY call_type ORDER BY count DESC"
  ).all();
  const topCapcodes = db.prepare(
    "SELECT capcode, COUNT(*) as count FROM messages WHERE received_at > datetime('now', '-1 day') GROUP BY capcode ORDER BY count DESC LIMIT 20"
  ).all();
  res.json({ total, today, callTypes, topCapcodes });
});

router.get('/api/messages/call-types', requireAuth, (req, res) => {
  const types = parser.CALL_TYPE_PATTERNS.map((p) => ({
    type: p.type,
    colour: p.colour,
  }));
  res.json(types);
});

// ─── Groups ───

router.get('/api/groups', requireAuth, (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, COUNT(gm.id) as member_count
    FROM groups_ g
    LEFT JOIN group_members gm ON g.id = gm.group_id
    GROUP BY g.id
    ORDER BY g.name
  `).all();
  res.json(groups);
});

router.get('/api/groups/:id', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups_ WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const members = db.prepare('SELECT * FROM group_members WHERE group_id = ?').all(group.id);
  res.json({ ...group, members });
});

router.post('/api/groups', requireAuth, requireAdmin, (req, res) => {
  const { name, description, colour, capcodes } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name required' });
  try {
    const result = db.prepare('INSERT INTO groups_ (name, description, colour, created_by) VALUES (?, ?, ?, ?)').run(
      name, description || '', colour || '#3b82f6', req.user.id
    );
    const groupId = result.lastInsertRowid;
    if (capcodes && Array.isArray(capcodes)) {
      const insert = db.prepare('INSERT OR IGNORE INTO group_members (group_id, capcode) VALUES (?, ?)');
      for (const cap of capcodes) {
        insert.run(groupId, parser.normalizeCapcode(cap));
      }
    }
    res.json({ id: groupId, name, description, colour });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Group name already exists' });
    }
    res.status(500).json({ error: 'Failed to create group' });
  }
});

router.put('/api/groups/:id', requireAuth, requireAdmin, (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  const { name, description, colour, capcodes } = req.body;
  db.prepare('UPDATE groups_ SET name = COALESCE(?, name), description = COALESCE(?, description), colour = COALESCE(?, colour) WHERE id = ?').run(
    name || null, description !== undefined ? description : null, colour || null, groupId
  );
  if (capcodes && Array.isArray(capcodes)) {
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
    const insert = db.prepare('INSERT OR IGNORE INTO group_members (group_id, capcode) VALUES (?, ?)');
    for (const cap of capcodes) {
      insert.run(groupId, parser.normalizeCapcode(cap));
    }
  }
  res.json({ ok: true });
});

router.delete('/api/groups/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM groups_ WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

// ─── Capcode aliases ───

router.get('/api/aliases', requireAuth, (req, res) => {
  const aliases = db.prepare('SELECT * FROM capcode_aliases ORDER BY capcode').all();
  // Attach group memberships for each alias
  const groupStmt = db.prepare('SELECT gm.group_id, g.name FROM group_members gm JOIN groups_ g ON gm.group_id = g.id WHERE gm.capcode = ?');
  for (const a of aliases) {
    a.groups = groupStmt.all(a.capcode);
  }
  res.json(aliases);
});

router.post('/api/aliases', requireAuth, requireAdmin, (req, res) => {
  const { capcode, alias, colour, icon, call_type, location, notes, group_ids } = req.body;
  if (!capcode || !alias) return res.status(400).json({ error: 'Capcode and alias required' });
  const normCapcode = parser.normalizeCapcode(capcode);
  try {
    db.prepare(
      'INSERT INTO capcode_aliases (capcode, alias, colour, icon, call_type, location, notes) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(capcode) DO UPDATE SET alias=?, colour=?, icon=?, call_type=?, location=?, notes=?'
    ).run(normCapcode, alias, colour || '#6b7280', icon || 'radio', call_type || null, location || null, notes || null,
      alias, colour || '#6b7280', icon || 'radio', call_type || null, location || null, notes || null);

    // Update group memberships if provided
    if (Array.isArray(group_ids)) {
      // Remove capcode from all groups first
      db.prepare('DELETE FROM group_members WHERE capcode = ?').run(normCapcode);
      // Add to specified groups
      const insert = db.prepare('INSERT OR IGNORE INTO group_members (group_id, capcode) VALUES (?, ?)');
      for (const gid of group_ids) {
        insert.run(parseInt(gid, 10), normCapcode);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save alias' });
  }
});

router.delete('/api/aliases/:capcode', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM capcode_aliases WHERE capcode = ?').run(parser.normalizeCapcode(req.params.capcode));
  res.json({ ok: true });
});

// ─── User favourites ───

router.get('/api/favourites', requireAuth, (req, res) => {
  const favs = db.prepare(`
    SELECT uf.*, g.name as group_name, g.colour as group_colour
    FROM user_favourites uf
    JOIN groups_ g ON uf.group_id = g.id
    WHERE uf.user_id = ?
  `).all(req.user.id);
  res.json(favs);
});

router.post('/api/favourites/:groupId', requireAuth, (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  const notify = req.body.notify !== undefined ? (req.body.notify ? 1 : 0) : 1;
  try {
    db.prepare('INSERT OR REPLACE INTO user_favourites (user_id, group_id, notify) VALUES (?, ?, ?)').run(
      req.user.id, groupId, notify
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add favourite' });
  }
});

router.delete('/api/favourites/:groupId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_favourites WHERE user_id = ? AND group_id = ?').run(
    req.user.id, parseInt(req.params.groupId, 10)
  );
  res.json({ ok: true });
});

// ─── User saved filters ───

router.get('/api/filters', requireAuth, (req, res) => {
  const filters = db.prepare('SELECT * FROM user_filters WHERE user_id = ? ORDER BY name').all(req.user.id);
  res.json(filters.map((f) => ({ ...f, filter: JSON.parse(f.filter_json) })));
});

router.post('/api/filters', requireAuth, (req, res) => {
  const { name, filter } = req.body;
  if (!name || !filter) return res.status(400).json({ error: 'Name and filter required' });
  const result = db.prepare('INSERT INTO user_filters (user_id, name, filter_json) VALUES (?, ?, ?)').run(
    req.user.id, name, JSON.stringify(filter)
  );
  res.json({ id: result.lastInsertRowid, name, filter });
});

router.delete('/api/filters/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_filters WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10), req.user.id
  );
  res.json({ ok: true });
});

// ─── Push subscriptions ───

router.post('/api/push/subscribe', requireAuth, (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  try {
    db.prepare(
      'INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_json) VALUES (?, ?, ?)'
    ).run(req.user.id, subscription.endpoint, JSON.stringify(subscription.keys));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

router.delete('/api/push/subscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, endpoint);
  } else {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.id);
  }
  res.json({ ok: true });
});

router.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: config.VAPID_PUBLIC_KEY });
});

// ─── Ingestion endpoint (called by client script) ───

router.post('/api/ingest', requireApiKey, (req, res) => {
  try {
    const messages = Array.isArray(req.body) ? req.body : [req.body];
    const inserted = [];

    for (const msg of messages) {
      if (!msg.capcode) continue;

      // Clean control character tags from content
      msg.content = parser.cleanContent(msg.content);

      // Enrich
      const callType = msg.call_type || parser.detectCallType(msg.content);
      const location = msg.location || parser.extractLocation(msg.content);
      const trucks = msg.trucks || parser.extractTrucks(msg.content);
      const hash = parser.dedupeHash(msg.capcode, msg.content);

      // Dedup check
      if (parser.isDuplicate(db, hash)) continue;

      // Check capcode alias for overrides (normalize to handle FLEX leading zeros)
      const normCapcode = parser.normalizeCapcode(msg.capcode);
      const alias = db.prepare('SELECT * FROM capcode_aliases WHERE capcode = ?').get(normCapcode);

      const finalCallType = callType || (alias && alias.call_type) || null;
      const finalLocation = location || (alias && alias.location) || null;

      const result = db.prepare(`
        INSERT INTO messages (capcode, content, protocol, bitrate, function_code, source, call_type, location, trucks, is_multipart, multipart_id, raw, hash, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        msg.capcode,
        msg.content || '',
        msg.protocol || 'POCSAG',
        msg.bitrate || null,
        msg.function_code || 0,
        msg.source || 'client',
        finalCallType,
        finalLocation,
        trucks,
        msg.is_multipart ? 1 : 0,
        msg.multipart_id || null,
        msg.raw || null,
        hash
      );

      const insertedMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);

      // Add alias info for broadcast
      if (alias) {
        insertedMsg.alias = alias.alias;
        insertedMsg.alias_colour = alias.colour;
        insertedMsg.alias_icon = alias.icon;
        insertedMsg.alias_notes = alias.notes;
      }

      // Add incident number if present
      const incidentNum = parser.extractIncidentNumber(msg.content);
      if (incidentNum) {
        insertedMsg.incident_number = incidentNum;
      }

      // Add priority colour if present (ambo/fire pages)
      const priority = parser.extractPriority(msg.content);
      if (priority) {
        insertedMsg.priority = priority;
      }

      inserted.push(insertedMsg);

      // Broadcast via WebSocket
      broadcast({ type: 'message', data: insertedMsg });

      // Send push notifications for matching groups
      sendPushForMessage(insertedMsg);
    }

    res.json({ inserted: inserted.length });
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: 'Ingestion failed' });
  }
});

// ─── Keyword alerts ───

router.get('/api/keyword-alerts', requireAuth, (req, res) => {
  const alerts = db.prepare('SELECT * FROM keyword_alerts WHERE user_id = ? ORDER BY keyword').all(req.user.id);
  res.json(alerts);
});

router.post('/api/keyword-alerts', requireAuth, (req, res) => {
  const { keyword } = req.body;
  if (!keyword || !keyword.trim()) return res.status(400).json({ error: 'Keyword required' });
  try {
    const result = db.prepare('INSERT INTO keyword_alerts (user_id, keyword) VALUES (?, ?)').run(
      req.user.id, keyword.trim()
    );
    res.json({ id: result.lastInsertRowid, keyword: keyword.trim() });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Keyword already exists' });
    }
    res.status(500).json({ error: 'Failed to add keyword alert' });
  }
});

router.delete('/api/keyword-alerts/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM keyword_alerts WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10), req.user.id
  );
  res.json({ ok: true });
});

/**
 * Send push notifications to users who have favourited groups containing this capcode,
 * and to users with keyword alerts matching the message content.
 */
function sendPushForMessage(msg) {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return;

  try {
    webpush.setVapidDetails(config.VAPID_EMAIL, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  } catch {
    return;
  }

  const normCapcode = parser.normalizeCapcode(msg.capcode);

  // Find groups this capcode belongs to (normalize for FLEX/POCSAG matching)
  const groups = db.prepare(
    "SELECT g.id, g.name FROM groups_ g JOIN group_members gm ON g.id = gm.group_id WHERE LTRIM(gm.capcode, '0') = ?"
  ).all(normCapcode);

  // ─── Group-based notifications ───
  if (groups.length > 0) {
    const groupIds = groups.map((g) => g.id);
    const placeholders = groupIds.map(() => '?').join(',');
    const subs = db.prepare(`
      SELECT DISTINCT ps.endpoint, ps.keys_json
      FROM push_subscriptions ps
      JOIN user_favourites uf ON ps.user_id = uf.user_id
      WHERE uf.group_id IN (${placeholders}) AND uf.notify = 1
    `).all(...groupIds);

    const groupNames = groups.map((g) => g.name).join(', ');
    const payload = JSON.stringify({
      title: `PDW: ${msg.call_type || 'Page'} - ${groupNames}`,
      body: msg.content ? msg.content.substring(0, 200) : `Capcode: ${msg.capcode}`,
      data: { messageId: msg.id, capcode: msg.capcode },
    });

    sendToSubscriptions(subs, payload);
  }

  // ─── Keyword alert notifications ───
  const content = (msg.content || '').toLowerCase();
  if (!content) return;

  const keywordAlerts = db.prepare('SELECT DISTINCT ka.user_id, ka.keyword FROM keyword_alerts ka WHERE ka.notify = 1').all();
  const matchedUsers = new Map(); // user_id -> matched keywords

  for (const ka of keywordAlerts) {
    if (content.includes(ka.keyword.toLowerCase())) {
      if (!matchedUsers.has(ka.user_id)) matchedUsers.set(ka.user_id, []);
      matchedUsers.get(ka.user_id).push(ka.keyword);
    }
  }

  for (const [userId, keywords] of matchedUsers) {
    const subs = db.prepare('SELECT endpoint, keys_json FROM push_subscriptions WHERE user_id = ?').all(userId);
    if (subs.length === 0) continue;

    const payload = JSON.stringify({
      title: `PDW Alert: ${keywords.join(', ')}`,
      body: msg.content ? msg.content.substring(0, 200) : `Capcode: ${msg.capcode}`,
      data: { messageId: msg.id, capcode: msg.capcode, keywordMatch: true },
    });

    sendToSubscriptions(subs, payload);
  }
}

function sendToSubscriptions(subs, payload) {
  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: JSON.parse(sub.keys_json),
    };
    webpush.sendNotification(subscription, payload).catch((err) => {
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      }
    });
  }
}

module.exports = { router, setBroadcast };
