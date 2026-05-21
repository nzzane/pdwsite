const db = require('./db');

const MAX_ERROR_LOG_ROWS = 5000;
const MAX_NOTIFICATION_LOG_DAYS = 30;
const MESSAGE_RETENTION_DAYS = parseInt(process.env.MESSAGE_RETENTION_DAYS || '180', 10);

const insertError = db.prepare(
  'INSERT INTO error_log (level, source, message, stack, context) VALUES (?, ?, ?, ?, ?)'
);

function logError(source, err, context) {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : null;
    const ctx = context ? JSON.stringify(context) : null;
    insertError.run('error', source, message, stack, ctx);
  } catch {
    // Don't let logging errors crash the app
    console.error('[logger] Failed to write error log:', err);
  }
}

function logWarn(source, message, context) {
  try {
    const ctx = context ? JSON.stringify(context) : null;
    insertError.run('warn', source, message, null, ctx);
  } catch {
    console.error('[logger] Failed to write warn log:', message);
  }
}

/**
 * Prune old logs to keep the DB lean.
 * Called periodically from the server.
 */
function pruneOldLogs() {
  try {
    // Keep only the most recent MAX_ERROR_LOG_ROWS error log entries
    const count = db.prepare('SELECT COUNT(*) as c FROM error_log').get().c;
    if (count > MAX_ERROR_LOG_ROWS) {
      db.prepare(
        `DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY created_at DESC LIMIT ?)`
      ).run(MAX_ERROR_LOG_ROWS);
    }
    // Delete notification logs older than MAX_NOTIFICATION_LOG_DAYS days
    db.prepare(
      `DELETE FROM notification_log WHERE created_at < datetime('now', '-${MAX_NOTIFICATION_LOG_DAYS} days')`
    ).run();
    // Delete messages older than MESSAGE_RETENTION_DAYS days
    const deletedMessages = db.prepare(
      `DELETE FROM messages WHERE received_at < datetime('now', '-${MESSAGE_RETENTION_DAYS} days')`
    ).run();
    if (deletedMessages.changes > 0) {
      console.log(`[prune] Removed ${deletedMessages.changes} messages older than ${MESSAGE_RETENTION_DAYS} days`);
    }
    // Vacuum the database periodically to reclaim space (only if messages were deleted)
    if (deletedMessages.changes > 0) {
      try { db.exec('VACUUM'); } catch { /* ignore vacuum failures */ }
    }
  } catch (err) {
    console.error('[logger] Prune failed:', err.message);
  }
}

module.exports = { logError, logWarn, pruneOldLogs };
