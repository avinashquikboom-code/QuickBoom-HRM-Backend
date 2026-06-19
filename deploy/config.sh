#!/usr/bin/env bash
# =============================================================================
# config.sh — shared config & helpers for the HRM deploy scripts.
# Not run directly; sourced by deploy-backend.sh / deploy-admin.sh / deploy-all.sh.
# =============================================================================

set -euo pipefail

# Resolve the directory this toolkit lives in (so scripts work from anywhere).
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- load tunable config -----------------------------------------------------
ENV_FILE="${DEPLOY_ENV_FILE:-$DEPLOY_DIR/deploy.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a; . "$ENV_FILE"; set +a
else
  echo "FATAL: $ENV_FILE not found (copy deploy.env.example -> deploy.env)" >&2
  exit 1
fi

# ---- pretty logging ----------------------------------------------------------
_c_blue=$'\033[34m'; _c_green=$'\033[32m'; _c_yellow=$'\033[33m'; _c_red=$'\033[31m'; _c_off=$'\033[0m'
log()  { echo "${_c_blue}[$(date '+%H:%M:%S')]${_c_off} $*"; }
ok()   { echo "${_c_green}  ✓${_c_off} $*"; }
warn() { echo "${_c_yellow}  ! ${_c_off}$*" >&2; }
die()  { echo "${_c_red}  ✗ $*${_c_off}" >&2; exit 1; }

# ---- prerequisites -----------------------------------------------------------
require() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed"; }
preflight() {
  require docker
  require aws
  [[ -n "${ECR_REGISTRY:-}" ]]   || die "ECR_REGISTRY not set in deploy.env"
  [[ -n "${AWS_REGION:-}" ]]     || die "AWS_REGION not set in deploy.env"
}

# ---- image URI helpers -------------------------------------------------------
backend_image() { echo "${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG}"; }
admin_image()   { echo "${ECR_REGISTRY}/${ADMIN_REPO}:${IMAGE_TAG}"; }

# ---- ECR auth (cached per shell run) -----------------------------------------
_ecr_logged_in=0
ecr_login() {
  [[ "$_ecr_logged_in" == "1" ]] && return 0
  log "Authenticating Docker to ECR (${ECR_REGISTRY})"
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null \
    || die "ECR login failed (check AWS creds / instance role)"
  _ecr_logged_in=1
  ok "ECR login OK"
}

# ---- ensure the docker network exists ----------------------------------------
NETWORK="${DOCKER_NETWORK:-hrm-net}"
ensure_network() {
  docker network inspect "$NETWORK" >/dev/null 2>&1 || {
    log "Creating docker network: $NETWORK"
    docker network create "$NETWORK" >/dev/null
  }
}

# =============================================================================
# run_service — generic, resource-limited container (re)launcher.
# Usage: run_service NAME IMAGE PORT_MAP ENV_FILE CPUS MEM MEM_RES [extra args...]
# =============================================================================
run_service() {
  local name="$1" image="$2" portmap="$3" envfile="$4"
  local cpus="$5" mem="$6" memres="$7"; shift 7
  local extra=("$@")

  [[ -f "$envfile" ]] || die "env file not found: $envfile"

  log "Pulling $image"
  docker pull "$image" >/dev/null || die "pull failed: $image"
  ok "pulled"

  # Zero-stale restart: stop & remove any existing container of this name.
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    log "Replacing existing container: $name"
    docker rm -f "$name" >/dev/null
  fi

  log "Starting $name  (cpus=$cpus mem=$mem reserve=$memres)"
  docker run -d \
    --name "$name" \
    --restart unless-stopped \
    --network "$NETWORK" \
    --env-file "$envfile" \
    --add-host host.docker.internal:host-gateway \
    -p "$portmap" \
    --cpus "$cpus" \
    --memory "$mem" \
    --memory-reservation "$memres" \
    --memory-swap "$mem" \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    "${extra[@]}" \
    "$image" >/dev/null || die "failed to start $name"

  ok "$name is up"
}

# ---- show status -------------------------------------------------------------
status() {
  echo
  log "Current HRM containers:"
  docker ps --filter "name=hrm-" \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
  echo
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' \
    $(docker ps --filter "name=hrm-" -q) 2>/dev/null || true
}
