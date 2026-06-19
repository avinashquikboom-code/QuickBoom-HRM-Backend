#!/usr/bin/env bash
#
# Hourly PostgreSQL backup → S3.
# Dumps the DB, gzips it, uploads to s3://$S3_BUCKET/$PROJECT_NAME/YYYY/MM/DD/,
# prunes old local + (optionally) old remote copies, and logs everything.
#
# Config is read from a .env file next to this script (or $BACKUP_ENV_FILE).
# AWS auth comes from the environment: EC2 instance role OR `aws configure`
# OR AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in the .env.
#
# Install (on the VPS):
#   /opt/quickboom/backup/db-backup.sh         <- this script (chmod +x)
#   /opt/quickboom/backup/.env                 <- config (chmod 600)
#   cron: 0 * * * * /opt/quickboom/backup/db-backup.sh >> /var/log/db-backup.log 2>&1

set -euo pipefail

# ---- load config -------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-$SCRIPT_DIR/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a; . "$ENV_FILE"; set +a
fi

# ---- defaults ----------------------------------------------------------------
PROJECT_NAME="${PROJECT_NAME:-hrm}"            # S3 prefix / folder per project
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-quickboom}"
PGUSER="${PGUSER:-quickboom_user}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
LOCAL_DIR="${LOCAL_BACKUP_DIR:-/opt/quickboom/backup/dumps}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-2}"
S3_RETENTION_DAYS="${S3_RETENTION_DAYS:-30}"   # 0 = never prune S3
S3_STORAGE_CLASS="${S3_STORAGE_CLASS:-STANDARD_IA}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

[[ -n "${S3_BUCKET:-}" ]] || fail "S3_BUCKET not set in $ENV_FILE"
[[ -n "${PGPASSWORD:-}" ]] || fail "PGPASSWORD not set in $ENV_FILE"
command -v pg_dump >/dev/null || fail "pg_dump not found"
command -v aws >/dev/null     || fail "aws cli not found"

export PGPASSWORD

# ---- dump --------------------------------------------------------------------
mkdir -p "$LOCAL_DIR"
TS="$(date -u '+%Y%m%dT%H%M%SZ')"
DATE_PREFIX="$(date -u '+%Y/%m/%d')"
FILE="${PROJECT_NAME}_${PGDATABASE}_${TS}.sql.gz"
LOCAL_PATH="$LOCAL_DIR/$FILE"
S3_KEY="${PROJECT_NAME}/${DATE_PREFIX}/${FILE}"
S3_URI="s3://${S3_BUCKET}/${S3_KEY}"

log "Dumping ${PGDATABASE}@${PGHOST}:${PGPORT} -> $LOCAL_PATH"
# --no-owner/--no-privileges keeps the dump restorable under a different role.
pg_dump --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
        --no-owner --no-privileges --format=plain "$PGDATABASE" \
  | gzip -9 > "$LOCAL_PATH" \
  || fail "pg_dump failed"

SIZE="$(du -h "$LOCAL_PATH" | cut -f1)"
log "Dump complete ($SIZE)"

# ---- upload ------------------------------------------------------------------
log "Uploading -> $S3_URI"
aws s3 cp "$LOCAL_PATH" "$S3_URI" \
  --region "$AWS_REGION" \
  --storage-class "$S3_STORAGE_CLASS" \
  --only-show-errors \
  || fail "S3 upload failed"
log "Upload OK"

# ---- prune local -------------------------------------------------------------
find "$LOCAL_DIR" -name "${PROJECT_NAME}_*.sql.gz" -type f -mtime "+${LOCAL_RETENTION_DAYS}" -print -delete \
  | sed 's/^/[prune-local] removed /' || true

# ---- prune S3 (optional) -----------------------------------------------------
if [[ "${S3_RETENTION_DAYS}" -gt 0 ]]; then
  CUTOFF="$(date -u -d "${S3_RETENTION_DAYS} days ago" '+%Y-%m-%d' 2>/dev/null \
            || date -u -v-"${S3_RETENTION_DAYS}"d '+%Y-%m-%d')"
  aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "${PROJECT_NAME}/" \
      --region "$AWS_REGION" --query "Contents[?LastModified<'${CUTOFF}'].Key" \
      --output text 2>/dev/null | tr '\t' '\n' | while read -r key; do
    [[ -n "$key" && "$key" != "None" ]] || continue
    aws s3 rm "s3://${S3_BUCKET}/${key}" --region "$AWS_REGION" --only-show-errors \
      && log "[prune-s3] removed $key"
  done
fi

log "Backup finished: $S3_URI"
