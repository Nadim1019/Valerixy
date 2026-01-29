#!/bin/bash

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAILY_DIR="$BACKUP_DIR/$(date +%Y%m%d)"

mkdir -p "$DAILY_DIR"

# Dump order database
PGPASSWORD=$ORDER_DB_PASSWORD pg_dump -h order-db -U $ORDER_DB_USER -d $ORDER_DB_NAME > "$DAILY_DIR/order_${TIMESTAMP}.sql"
echo "[$(date)] Order DB snapshot saved: $DAILY_DIR/order_${TIMESTAMP}.sql"

# Dump inventory database
PGPASSWORD=$INVENTORY_DB_PASSWORD pg_dump -h inventory-db -U $INVENTORY_DB_USER -d $INVENTORY_DB_NAME > "$DAILY_DIR/inventory_${TIMESTAMP}.sql"
echo "[$(date)] Inventory DB snapshot saved: $DAILY_DIR/inventory_${TIMESTAMP}.sql"

echo "[$(date)] Snapshot complete"
