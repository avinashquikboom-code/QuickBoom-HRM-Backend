#!/usr/bin/env bash
# ============================================================================
# HRM (QuickBoom HRM) — deployment settings (backend API + admin panel).
#
# Single source of truth for non-secret deploy settings. Sourced by every
# other *.sh script in this folder. Edit values here, not in the scripts.
#
# Secrets (DB URL, JWT secrets, ...) live in .env next to this file, NOT here.
#
# NOT synced by CI: this folder is copied to the server by hand once. CI only
# rewrites the pinned lines below (ECR_REGISTRY and the image tags) over SSH,
# then runs backend.sh or admin.sh.
# ============================================================================

set -euo pipefail

# ---- ECR --------------------------------------------------------------------
# Pinned by CI (from the amazon-ecr-login output). Do not edit by hand.
export ECR_REGISTRY="211107604014.dkr.ecr.ap-southeast-2.amazonaws.com"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"

# ---- Backend API image --------------------------------------------------------
export API_ECR_REPOSITORY="hrm-backend"
export API_IMAGE_TAG="83d1d78070b54a9ec8ba3a0586072b99f024f5a4"
export API_IMAGE="${ECR_REGISTRY}/${API_ECR_REPOSITORY}:${API_IMAGE_TAG}"

# ---- Admin panel image --------------------------------------------------------
export ADMIN_ECR_REPOSITORY="hrm-admin"
export ADMIN_IMAGE_TAG="4fa4feb99ae8c7afc26cce7531cbd9b2ed3a5e7c"
export ADMIN_IMAGE="${ECR_REGISTRY}/${ADMIN_ECR_REPOSITORY}:${ADMIN_IMAGE_TAG}"

# ---- Paths ------------------------------------------------------------------
export DEPLOY_DIR="${DEPLOY_DIR:-/var/www/hrm}"
export ENV_FILE="${DEPLOY_DIR}/.env"

# ---- Domains / TLS -------------------------------------------------------------
# API_DOMAIN and ADMIN_DOMAIN must match the file names in nginx/.
export API_DOMAIN="${API_DOMAIN:-api.voxiqai.com}"
export ADMIN_DOMAIN="${ADMIN_DOMAIN:-voxiqai.com}"
export CERTBOT_EMAIL="${CERTBOT_EMAIL:-someshsa9860@gmail.com}"

# ---- Docker network -----------------------------------------------------------
export DOCKER_NETWORK="hrm-net"

# ---- API container ------------------------------------------------------------
export API_CONTAINER="hrm-backend"
export API_CONTAINER_PORT="5004"          # matches Dockerfile.deploy EXPOSE / PORT
export API_HOST_PORT="8110"               # nginx -> 127.0.0.1:8110, not public
# Memory guard (the server is small and shared; other Node APIs here use 70-90 MB each):
#   API_MEMORY           hard cap. Over it, only THIS container is OOM-killed (and restarted by docker).
#   API_MEMORY_SWAP      = API_MEMORY means the container may NOT use swap, so it cannot push the host into swap-thrash.
#   API_MEMORY_RESERVATION  soft target; the kernel reclaims from the container down to this under host pressure.
#   API_NODE_HEAP_MB     V8 heap ceiling, kept below API_MEMORY so Node garbage-collects instead of being killed.
#   API_OOM_SCORE_ADJ    if the HOST itself runs out of RAM, the kernel picks this container first, not nginx/sshd/others.
export API_MEMORY="448m"
export API_MEMORY_SWAP="448m"
export API_MEMORY_RESERVATION="256m"
export API_NODE_HEAP_MB="320"
export API_OOM_SCORE_ADJ="500"
export API_PIDS_LIMIT="256"
export API_CPUS="1.0"
# Throwaway `prisma migrate deploy` container (migrate.sh)
export MIGRATE_MEMORY="384m"

# ---- Admin container ----------------------------------------------------------
export ADMIN_CONTAINER="hrm-admin"
export ADMIN_CONTAINER_PORT="3000"        # matches admin Dockerfile PORT
export ADMIN_HOST_PORT="8111"             # nginx -> 127.0.0.1:8111, not public
# Same guard as the API (see above): hard cap, no swap, V8 heap below the cap, killed first if the host runs dry.
export ADMIN_MEMORY="384m"
export ADMIN_MEMORY_SWAP="384m"
export ADMIN_NODE_HEAP_MB="256"
export ADMIN_OOM_SCORE_ADJ="500"
export ADMIN_PIDS_LIMIT="256"
export ADMIN_CPUS="0.75"

# ---- Runtime (non-secret) -----------------------------------------------------
export NODE_ENV="production"
# Where the admin panel proxies /api/* to (the admin image also has this default baked in).
export BACKEND_API_URL="https://${API_DOMAIN}"
