#!/usr/bin/env bash
set -euo pipefail

# ---- Config ----
CONTAINER="${PG_CONTAINER:-aiqa-postgres}"
DB="${PG_DB:-aiqa}"
USER="${PG_USER:-aiqa}"

# Where to store the one-and-only snapshot
SNAP_DIR="${SNAP_DIR:-/var/backups/aiqa-postgres}"
SNAP_FILE="${SNAP_FILE:-${SNAP_DIR}/aiqa_latest.sql.gz}"

# ---- Prep ----
mkdir -p "$SNAP_DIR"
umask 077  # backups readable only by owner (good hygiene)

TMP_FILE="${SNAP_FILE}.tmp"

# ---- Dump (to temp), then replace on success ----
# Use gzip to keep it small; remove | gzip if you prefer plain .sql
docker exec -i "$CONTAINER" pg_dump -U "$USER" -d "$DB" \
  --no-owner --no-privileges \
  | gzip -c > "$TMP_FILE"

# Basic sanity check: file exists and is not tiny/empty
if [[ ! -s "$TMP_FILE" ]]; then
  echo "ERROR: dump produced empty file: $TMP_FILE" >&2
  rm -f "$TMP_FILE"
  exit 1
fi

# Optional deeper check: gzip file can be read
gzip -t "$TMP_FILE"

# Atomic replace (same filesystem)
mv -f "$TMP_FILE" "$SNAP_FILE"

echo "OK: snapshot written to $SNAP_FILE"