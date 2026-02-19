#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# CRONTAB SETUP INSTRUCTIONS
# ============================================================================
# To run this script automatically via cron:
#
# 1. Make sure the script is executable, and the log file can be written to:
#    chmod +x /path/to/aiqa_elasticsearch_snapshot.sh
#    touch /var/log/aiqa-es-snapshot.log
#
# 2. Edit your crontab:
#    crontab -e
#
# 3. Add a line to run the script (examples below):
#
#    # Run daily at 2 AM
#    0 2 * * * /path/to/aiqa_elasticsearch_snapshot.sh >> /var/log/aiqa-es-snapshot.log 2>&1
#    To test, temporarily use a faster crontab, and tail the log:
#    crontab -e
#    */5 * * * * /path/to/aiqa_elasticsearch_snapshot.sh >> /var/log/aiqa-es-snapshot.log 2>&1
#    tail -f /var/log/aiqa-es-snapshot.log
#   
#
# 4. Optional: Set environment variables in crontab if needed:
#    ES_CONTAINER=my-container SNAP_DIR=/custom/path /path/to/script.sh
#
# Note: Ensure the SNAP_DIR directory exists and is writable by the cron user.
# ============================================================================

# ---- Config ----
CONTAINER="${ES_CONTAINER:-aiqa-elasticsearch}"
ES_URL="${ES_URL:-http://localhost:9200}"
REPO_NAME="${ES_REPO_NAME:-aiqa_backup_repo}"

# Where to store the one-and-only snapshot
SNAP_DIR="${SNAP_DIR:-/var/backups/aiqa-elasticsearch}"
SNAP_FILE="${SNAP_FILE:-${SNAP_DIR}/aiqa_latest.json.gz}"

# ---- Prep ----
mkdir -p "$SNAP_DIR"
umask 077  # backups readable only by owner (good hygiene)

TMP_FILE="${SNAP_FILE}.tmp"

# ---- Pre-flight checks ----
# Check if container exists and is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: Container '$CONTAINER' is not running" >&2
  echo "Available containers:" >&2
  docker ps --format '{{.Names}}' >&2
  exit 1
fi

# Check if Elasticsearch is accessible
if ! docker exec "$CONTAINER" curl -sS -f "$ES_URL/_cluster/health" > /dev/null 2>&1; then
  echo "ERROR: Cannot connect to Elasticsearch at $ES_URL" >&2
  exit 1
fi

# ---- Helper function to call Elasticsearch API ----
# Returns response body; check response for errors using grep/parsing
es_api() {
  local method="${1:-GET}"
  local endpoint="${2:-}"
  local data="${3:-}"
  
  if [[ -n "$data" ]]; then
    docker exec "$CONTAINER" curl -sS -X "$method" "$ES_URL$endpoint" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    docker exec "$CONTAINER" curl -sS -X "$method" "$ES_URL$endpoint"
  fi
}

# ---- Register filesystem repository if it doesn't exist ----
# Use path within the es_data volume so snapshots persist across container restarts
REPO_PATH="/usr/share/elasticsearch/data/backups"
REPO_RESPONSE=$(es_api GET "/_snapshot/$REPO_NAME" 2>/dev/null || echo "")

if [[ -z "$REPO_RESPONSE" ]] || echo "$REPO_RESPONSE" | grep -q '"error"'; then
  echo "Registering snapshot repository: $REPO_NAME"
  REPO_RESULT=$(es_api PUT "/_snapshot/$REPO_NAME" "{
    \"type\": \"fs\",
    \"settings\": {
      \"location\": \"$REPO_PATH\"
    }
  }")
  
  if echo "$REPO_RESULT" | grep -q '"error"'; then
    echo "ERROR: Failed to register repository: $REPO_RESULT" >&2
    exit 1
  fi
fi

# ---- Create snapshot ----
SNAPSHOT_NAME="aiqa_snapshot_$(date +%Y%m%d_%H%M%S)"
echo "Creating snapshot: $SNAPSHOT_NAME"

# Create snapshot (snapshot all indices)
# Note: wait_for_completion=true can take a long time for large datasets
# Consider removing it and polling status separately if timeouts occur
SNAPSHOT_RESULT=$(es_api PUT "/_snapshot/$REPO_NAME/$SNAPSHOT_NAME?wait_for_completion=true" "{
  \"indices\": \"*\",
  \"ignore_unavailable\": true,
  \"include_global_state\": false
}")

# Check for immediate errors in snapshot creation
if echo "$SNAPSHOT_RESULT" | grep -q '"error"'; then
  echo "ERROR: Snapshot creation failed: $SNAPSHOT_RESULT" >&2
  exit 1
fi

# Check if snapshot succeeded
SNAPSHOT_RESPONSE=$(es_api GET "/_snapshot/$REPO_NAME/$SNAPSHOT_NAME")
SNAPSHOT_STATUS=$(echo "$SNAPSHOT_RESPONSE" | grep -o '"state":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

if [[ -z "$SNAPSHOT_STATUS" ]]; then
  echo "ERROR: Could not determine snapshot status" >&2
  echo "Response: $SNAPSHOT_RESPONSE" >&2
  exit 1
fi

if [[ "$SNAPSHOT_STATUS" != "SUCCESS" ]]; then
  echo "ERROR: Snapshot failed with status: $SNAPSHOT_STATUS" >&2
  echo "Response: $SNAPSHOT_RESPONSE" >&2
  exit 1
fi

# ---- Export snapshot metadata and indices info ----
# Get snapshot info
SNAPSHOT_INFO=$(es_api GET "/_snapshot/$REPO_NAME/$SNAPSHOT_NAME")

# Get all indices info
INDICES_INFO=$(es_api GET "/_cat/indices?v&format=json")

# Combine into export file
{
  echo "=== Snapshot Info ==="
  echo "$SNAPSHOT_INFO"
  echo ""
  echo "=== Indices Info ==="
  echo "$INDICES_INFO"
} | gzip -c > "$TMP_FILE"

# Basic sanity check: file exists and is not tiny/empty
if [[ ! -s "$TMP_FILE" ]]; then
  echo "ERROR: export produced empty file: $TMP_FILE" >&2
  rm -f "$TMP_FILE"
  exit 1
fi

# Optional deeper check: gzip file can be read
gzip -t "$TMP_FILE"

# Atomic replace (same filesystem)
mv -f "$TMP_FILE" "$SNAP_FILE"

# ---- Cleanup old snapshots (keep only the latest) ----
# Delete old snapshots except the one we just created
ALL_SNAPSHOTS_RESPONSE=$(es_api GET "/_snapshot/$REPO_NAME/_all")
ALL_SNAPSHOTS=$(echo "$ALL_SNAPSHOTS_RESPONSE" | grep -o '"snapshot":"[^"]*"' | cut -d'"' -f4 || echo "")

for snap in $ALL_SNAPSHOTS; do
  if [[ -n "$snap" ]] && [[ "$snap" != "$SNAPSHOT_NAME" ]]; then
    echo "Deleting old snapshot: $snap"
    es_api DELETE "/_snapshot/$REPO_NAME/$snap" > /dev/null || true
  fi
done

echo "OK: snapshot created ($SNAPSHOT_NAME) and metadata exported to $SNAP_FILE"
echo "Note: Full snapshot data is stored in container at $REPO_PATH (within es_data volume)"
