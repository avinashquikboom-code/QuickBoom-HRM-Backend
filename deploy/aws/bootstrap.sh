#!/usr/bin/env bash
# ============================================================================
# HRM — one-time server bootstrap (idempotent, safe to re-run).
#
# Installs Docker, nginx and AWS CLI if missing and creates the deploy
# directory. Does not touch existing nginx sites or containers. On the shared
# QuikBoom server everything is already installed, so this only checks.
#
# Run once by hand:  cd /var/www/hrm && sudo ./bootstrap.sh
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./config.sh
source "${SCRIPT_DIR}/config.sh"

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then SUDO="sudo"; fi
TARGET_USER="${SUDO_USER:-$USER}"

command -v apt-get >/dev/null 2>&1 || { echo "[bootstrap] Unsupported distro (apt-get needed)"; exit 1; }

install_pkgs() {
  $SUDO apt-get update -y
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

# ---- Docker -----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  install_pkgs docker.io
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true

if ! id -nG "${TARGET_USER}" | grep -qw docker; then
  log "Adding ${TARGET_USER} to the docker group (log in again for it to apply)"
  $SUDO usermod -aG docker "${TARGET_USER}" || true
fi

# ---- nginx ----------------------------------------------------------------------
if ! command -v nginx >/dev/null 2>&1; then
  log "Installing nginx"
  install_pkgs nginx
fi
$SUDO systemctl enable --now nginx >/dev/null 2>&1 || true

# ---- AWS CLI --------------------------------------------------------------------
if ! command -v aws >/dev/null 2>&1; then
  log "Installing AWS CLI"
  install_pkgs awscli
fi

# ---- Deploy directory -------------------------------------------------------------
$SUDO mkdir -p "${DEPLOY_DIR}" "${DEPLOY_DIR}/secrets"
$SUDO chown -R "${TARGET_USER}":"${TARGET_USER}" "${DEPLOY_DIR}" || true
$SUDO chmod 700 "${DEPLOY_DIR}/secrets"

log "Bootstrap complete. Next: make sure ${ENV_FILE} exists (cp .env.example .env, then fill it in)."
