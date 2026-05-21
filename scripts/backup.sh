#!/bin/sh
# ─── PDW Monitor Database Backup Script ───
# Run via cron or systemd timer to create full SQLite backups.
# Usage:
#   BACKUP_DIR=/var/lib/pdw-backups ./backup.sh
# Or set env vars:
#   PDW_DB_PATH=/data/pdw.db BACKUP_DIR=/var/lib/pdw-backups MAX_BACKUPS=30 ./backup.sh

set -e

DB_PATH="${PDW_DB_PATH:-/data/pdw.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
MAX_BACKUPS="${MAX_BACKUPS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/pdw-backup-${TIMESTAMP}.db"

mkdir -p "${BACKUP_DIR}"

if [ ! -f "${DB_PATH}" ]; then
  echo "[backup] ERROR: Database file not found at ${DB_PATH}"
  exit 1
fi

echo "[backup] Starting backup: ${BACKUP_FILE}"

# Use SQLite backup API for a consistent, online backup
# This works even while the database is in WAL mode with active connections
sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"

if [ -f "${BACKUP_FILE}" ]; then
  SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  echo "[backup] Backup complete: ${BACKUP_FILE} (${SIZE})"

  # Remove old backups beyond MAX_BACKUPS
  BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/pdw-backup-*.db 2>/dev/null | wc -l)
  if [ "${BACKUP_COUNT}" -gt "${MAX_BACKUPS}" ]; then
    REMOVE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
    echo "[backup] Removing ${REMOVE_COUNT} old backup(s)..."
    ls -1t "${BACKUP_DIR}"/pdw-backup-*.db | tail -n "${REMOVE_COUNT}" | xargs rm -f
  fi
else
  echo "[backup] ERROR: Backup file was not created"
  exit 1
fi
