#!/usr/bin/env bash
# ============================================================================
# HRM Admin Panel — start (or restart) the admin container.
#
# No env file and no secrets: the admin only proxies /api/* to the backend
# (BACKEND_API_URL, from config.sh). Published on 127.0.0.1:${ADMIN_HOST_PORT}.
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

ensure_network
remove_container "${ADMIN_CONTAINER}"

log "Starting ${ADMIN_CONTAINER} (mem=${ADMIN_MEMORY}, no swap, node heap=${ADMIN_NODE_HEAP_MB}m, cpus=${ADMIN_CPUS}) on 127.0.0.1:${ADMIN_HOST_PORT}"

docker run -d \
  --name "${ADMIN_CONTAINER}" \
  --network "${DOCKER_NETWORK}" \
  --restart unless-stopped \
  --memory "${ADMIN_MEMORY}" \
  --memory-swap "${ADMIN_MEMORY_SWAP}" \
  --oom-score-adj "${ADMIN_OOM_SCORE_ADJ}" \
  --pids-limit "${ADMIN_PIDS_LIMIT}" \
  --cpus "${ADMIN_CPUS}" \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  -p "127.0.0.1:${ADMIN_HOST_PORT}:${ADMIN_CONTAINER_PORT}" \
  -e NODE_ENV="${NODE_ENV}" \
  -e NODE_OPTIONS="--max-old-space-size=${ADMIN_NODE_HEAP_MB}" \
  -e PORT="${ADMIN_CONTAINER_PORT}" \
  -e HOSTNAME="0.0.0.0" \
  -e BACKEND_API_URL="${BACKEND_API_URL}" \
  "${ADMIN_IMAGE}"

log "Admin container started. Recent logs:"
sleep 2
docker logs --tail 20 "${ADMIN_CONTAINER}" || true
