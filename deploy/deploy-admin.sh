#!/usr/bin/env bash
# Deploy the HRM admin panel: pull latest image from ECR and (re)start with limits.
#   Usage: ./deploy-admin.sh
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/config.sh"

preflight
ecr_login
ensure_network

# Health check via Node (the image has no curl/wget): hit the root on the app port.
ADMIN_HEALTH="node -e \"require('http').get('http://127.0.0.1:'+(process.env.PORT||3000),r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\""

run_service \
  "$ADMIN_CONTAINER" \
  "$(admin_image)" \
  "${ADMIN_PORT}:3000" \
  "$ADMIN_ENV_FILE" \
  "$ADMIN_CPUS" "$ADMIN_MEMORY" "$ADMIN_MEMORY_RESERVATION" \
  --health-cmd "$ADMIN_HEALTH" \
  --health-interval 30s --health-timeout 5s --health-retries 3 --health-start-period 15s

log "Pruning dangling images"
docker image prune -f >/dev/null || true
status
ok "Admin panel deployed: $(admin_image)"
