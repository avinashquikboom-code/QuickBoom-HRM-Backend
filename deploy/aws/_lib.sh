#!/usr/bin/env bash
# ============================================================================
# HRM — shared shell helpers, sourced by the other *.sh scripts.
# ============================================================================
set -euo pipefail

# Resolve this directory regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./config.sh
source "${SCRIPT_DIR}/config.sh"

log()  { printf '\033[1;34m[hrm]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[hrm] WARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[hrm] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---- ECR login --------------------------------------------------------------
ecr_login() {
  command -v aws >/dev/null 2>&1 || die "aws CLI not found on server"
  log "Logging in to ECR: ${ECR_REGISTRY}"
  aws ecr get-login-password --region "${AWS_REGION}" \
    | docker login --username AWS --password-stdin "${ECR_REGISTRY}"
}

pull_image() {
  local image="$1"
  log "Pulling image: ${image}"
  docker pull "${image}"
}

# Ensure the docker network exists.
ensure_network() {
  if ! docker network inspect "${DOCKER_NETWORK}" >/dev/null 2>&1; then
    log "Creating docker network: ${DOCKER_NETWORK}"
    docker network create "${DOCKER_NETWORK}"
  fi
}

# Stop & remove a container if it exists (idempotent restart).
remove_container() {
  local name="$1"
  if docker ps -a --format '{{.Names}}' | grep -qx "${name}"; then
    log "Removing existing container: ${name}"
    docker rm -f "${name}" >/dev/null
  fi
}

# The env file must exist before any app container starts.
require_env_file() {
  [[ -f "${ENV_FILE}" ]] || die "env file not found: ${ENV_FILE} (copy .env.example to ${ENV_FILE} and fill it in)"
}

# Every named key must be present AND non-empty in the env file (values are never printed).
require_env_values() {
  local key
  for key in "$@"; do
    grep -Eq "^${key}=.+" "${ENV_FILE}" || die "${key} is empty or missing in ${ENV_FILE}"
  done
}

# Install/refresh the nginx site for one domain (nginx/<domain>.conf),
# unless certbot has already added a TLS server block to it.
install_vhost() {
  local domain="$1"
  local avail="/etc/nginx/sites-available/${domain}.conf"
  local enabled="/etc/nginx/sites-enabled/${domain}.conf"

  if [[ -f "${avail}" ]] && sudo grep -q "listen 443" "${avail}"; then
    log "TLS site detected for ${domain} — leaving certbot-managed nginx config in place"
    sudo nginx -t
    sudo systemctl reload nginx
    return 0
  fi

  local src="${SCRIPT_DIR}/nginx/${domain}.conf"
  if [[ ! -f "${src}" ]]; then
    warn "vhost ${src} not found — skipping"
    return 0
  fi

  log "Installing nginx site -> ${avail}"
  sudo cp "${src}" "${avail}"
  sudo ln -sfn "${avail}" "${enabled}"
  # A broken file in sites-enabled would block reloads for the other live sites,
  # so remove this site's link again if the config test fails.
  if ! sudo nginx -t; then
    sudo rm -f "${enabled}"
    die "nginx config test failed for ${domain} — its site link was removed, other sites untouched"
  fi
  sudo systemctl reload nginx
  warn "HTTPS not yet enabled for ${domain} — run ./setup-domain.sh once DNS points here"
}
