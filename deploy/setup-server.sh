#!/usr/bin/env bash
# =============================================================================
# setup-server.sh — one-time server bootstrap (idempotent).
#   - 2GB swapfile (host has ~1.9GB RAM, no swap)
#   - Nginx reverse proxy (admin on /, backend on /api, ws on /socket.io)
# Run with sudo:  sudo ./setup-server.sh
# Re-runnable safely.
# =============================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { echo -e "\033[34m==>\033[0m $*"; }

[[ "$(id -u)" -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }

# ---- swap --------------------------------------------------------------------
if ! swapon --show | grep -q '/swapfile'; then
  say "Creating 2GB swapfile"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  say "swap enabled"
else
  say "swap already present — skipping"
fi

# ---- nginx + certbot ---------------------------------------------------------
if ! command -v nginx >/dev/null 2>&1; then
  say "Installing nginx"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
fi
if ! command -v certbot >/dev/null 2>&1; then
  say "Installing certbot (Let's Encrypt)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
fi

say "Installing HRM nginx site"
install -m 644 "$DIR/nginx/hrm.conf" /etc/nginx/sites-available/hrm.conf
ln -sf /etc/nginx/sites-available/hrm.conf /etc/nginx/sites-enabled/hrm.conf
# Drop the default site so our default_server wins.
rm -f /etc/nginx/sites-enabled/default

say "Testing nginx config"
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx || systemctl restart nginx
say "nginx reloaded"

# ---- firewall (best effort) --------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  ufw allow 'Nginx Full' >/dev/null 2>&1 || ufw allow 80/tcp >/dev/null 2>&1 || true
fi

say "Server bootstrap complete."
echo "Next:"
echo "  1. Point DNS A records to this server:"
echo "       voxiqai.com, www.voxiqai.com, api.voxiqai.com  ->  $(curl -s ifconfig.me 2>/dev/null || echo '<server-ip>')"
echo "  2. ./deploy-all.sh                  # pull images + start containers"
echo "  3. sudo certbot --nginx -d voxiqai.com -d www.voxiqai.com -d api.voxiqai.com"
echo "  4. Browse https://voxiqai.com  and  https://api.voxiqai.com/api/health"
