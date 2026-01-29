#!/bin/bash

BACKUP_DIR="/backups"
TODAY=$(date +%Y%m%d)
ARCHIVE="/backups/valerix_backup_${TODAY}.tar.gz"

# Bundle all today's snapshots into one archive
tar -czvf "$ARCHIVE" -C "$BACKUP_DIR" "$TODAY"

echo "[$(date)] Archive created: $ARCHIVE"

# THE ONE DAILY CALL to Valerix backup service
if [ -n "$VALERIX_BACKUP_URL" ] && [ "$VALERIX_BACKUP_URL" != "http://localhost:9999/backup" ]; then
  curl -X POST "${VALERIX_BACKUP_URL}" \
    -H "Authorization: Bearer ${VALERIX_BACKUP_TOKEN}" \
    -F "backup=@${ARCHIVE}"
  echo "[$(date)] Daily backup pushed to Valerix"
else
  echo "[$(date)] VALERIX_BACKUP_URL not configured - archive stored locally"
fi

# Cleanup old local backups (keep 7 days)
find "$BACKUP_DIR" -maxdepth 1 -type d -name "20*" -mtime +7 -exec rm -rf {} +
find "$BACKUP_DIR" -maxdepth 1 -name "*.tar.gz" -mtime +7 -delete

echo "[$(date)] Daily backup complete"
