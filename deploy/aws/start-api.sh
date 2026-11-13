#!/usr/bin/env bash
# ============================================================================
# HRM Backend — start (or restart) the API container.
#
# Published on 127.0.0.1:${API_HOST_PORT} only; nginx reverse-proxies the
# API domain to it. Secrets come from .env; non-secret settings from config.sh.
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_env_file
# The code falls back to hard-coded secrets when these are missing, so refuse to start without them.
require_env_values DATABASE_URL JWT_SECRET
grep -Eq '^REFRESH_SECRET=.+' "${ENV_FILE}" \
  || warn "REFRESH_SECRET is not set in .env — the backend then uses a hard-coded default refresh secret"
ensure_network
remove_container "${API_CONTAINER}"

# Firebase service account JSON, read from a file on the host (not from .env).
# The backend looks for it at <cwd>/firebase-service-account.json = /app/... inside the
# container. If the file is absent, FIREBASE_* variables from .env (if any) are used instead.
FIREBASE_SA_HOST_FILE="${DEPLOY_DIR}/secrets/firebase-service-account.json"
FIREBASE_MOUNT=()
if [[ -f "${FIREBASE_SA_HOST_FILE}" ]]; then
  log "Mounting Firebase service account from ${FIREBASE_SA_HOST_FILE}"
  FIREBASE_MOUNT=(-v "${FIREBASE_SA_HOST_FILE}:/app/firebase-service-account.json:ro")
fi

log "Starting ${API_CONTAINER} (mem=${API_MEMORY}, no swap, node heap=${API_NODE_HEAP_MB}m, cpus=${API_CPUS}) on 127.0.0.1:${API_HOST_PORT}"

docker run -d \
  --name "${API_CONTAINER}" \
  --network "${DOCKER_NETWORK}" \
  --add-host "host.docker.internal:host-gateway" \
  --restart unless-stopped \
  --memory "${API_MEMORY}" \
  --memory-swap "${API_MEMORY_SWAP}" \
  --memory-reservation "${API_MEMORY_RESERVATION}" \
  --oom-score-adj "${API_OOM_SCORE_ADJ}" \
  --pids-limit "${API_PIDS_LIMIT}" \
  --cpus "${API_CPUS}" \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  --health-cmd 'node dist/health-check.js || exit 1' \
  --health-interval 30s --health-timeout 5s --health-retries 3 --health-start-period 20s \
  -p "127.0.0.1:${API_HOST_PORT}:${API_CONTAINER_PORT}" \
  --env-file "${ENV_FILE}" \
  "${FIREBASE_MOUNT[@]}" \
  -e NODE_ENV="${NODE_ENV}" \
  -e NODE_OPTIONS="--max-old-space-size=${API_NODE_HEAP_MB}" \
  -e PORT="${API_CONTAINER_PORT}" \
  -e HOST="0.0.0.0" \
  "${API_IMAGE}"

log "API container started. Recent logs:"
sleep 2
docker logs --tail 20 "${API_CONTAINER}" || true
