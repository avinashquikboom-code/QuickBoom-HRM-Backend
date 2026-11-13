#!/usr/bin/env bash
# ============================================================================
# HRM — enable HTTPS (Let's Encrypt) for voxiqai.com and api.voxiqai.com
# (no www) on ONE certificate. Run once, after a deploy has installed the
# nginx sites.
#
#   ./setup-domain.sh              now: stop if any name does not point here yet
#   ./setup-domain.sh --wait [min] wait (default 4320 min = 3 days) until both
#                                  names point here, then issue the certificate by
#                                  itself. Start it in the background BEFORE the DNS
#                                  change and the site goes live with HTTPS on its own:
#        nohup ./setup-domain.sh --wait >> logs/setup-domain.log 2>&1 &
#
# DNS is checked against two public resolvers first, so a half-done DNS change
# never burns Let's Encrypt rate limits.
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then SUDO="sudo"; fi

WAIT_MIN=0
if [[ "${1:-}" == "--wait" ]]; then WAIT_MIN="${2:-4320}"; fi

NAMES=("${ADMIN_DOMAIN}" "${API_DOMAIN}")
log "Configuring HTTPS for: ${NAMES[*]}"

MY_IP="$(curl -fsS -m 8 https://checkip.amazonaws.com | tr -d '[:space:]')" \
  || die "cannot determine this server's public IP"

# 0 when every name resolves to this server on both resolvers. Pass "loud" to print each miss.
check_dns() {
  local mode="${1:-quiet}" bad=0 n r got
  for n in "${NAMES[@]}"; do
    for r in 1.1.1.1 8.8.8.8; do
      got="$(dig +short "${n}" A "@${r}" +time=3 +tries=1 | tr '\n' ' ')"
      if [[ " ${got} " != *" ${MY_IP} "* ]]; then
        [[ "${mode}" == "loud" ]] && warn "DNS NOT pointing here: ${n} -> ${got:-<nothing>} via ${r} (this server is ${MY_IP})"
        bad=1
      fi
    done
  done
  return "${bad}"
}

if [[ "${WAIT_MIN}" -gt 0 ]]; then
  log "Waiting up to ${WAIT_MIN} min for ${NAMES[*]} -> ${MY_IP} (checking every 30 s)"
  deadline=$(( $(date +%s) + WAIT_MIN * 60 ))
  tick=0
  until check_dns quiet; do
    (( $(date +%s) < deadline )) || die "gave up: DNS still does not point at ${MY_IP}"
    if (( tick % 20 == 0 )); then log "still waiting for DNS ($(date -u +%H:%M:%SZ))"; fi
    tick=$(( tick + 1 ))
    sleep 30
  done
  log "DNS now points here — issuing the certificate"
else
  check_dns loud || die "fix the DNS records above (A -> ${MY_IP}), wait for them to propagate, then re-run (or use --wait)"
  for n in "${NAMES[@]}"; do log "DNS ok: ${n} -> ${MY_IP}"; done
fi

if ! command -v certbot >/dev/null 2>&1; then
  log "Installing certbot"
  $SUDO apt-get update -y
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
fi

issue() {
  $SUDO certbot --nginx \
    --cert-name "${ADMIN_DOMAIN}" \
    -d "${ADMIN_DOMAIN}" -d "${API_DOMAIN}" \
    --non-interactive --agree-tos --redirect \
    -m "${CERTBOT_EMAIL}"
}

# In --wait mode retry a few times (resolver caches of the validators can lag the ones we asked).
attempts=1
[[ "${WAIT_MIN}" -gt 0 ]] && attempts=4
ok=0
for ((a = 1; a <= attempts; a++)); do
  if issue; then ok=1; break; fi
  warn "certbot attempt ${a}/${attempts} failed"
  (( a < attempts )) && sleep 90
done
[[ "${ok}" == 1 ]] || die "certbot failed — see /var/log/letsencrypt/letsencrypt.log"

$SUDO nginx -t
$SUDO systemctl reload nginx

# ---- Smoke test over real DNS + TLS -------------------------------------------------
sleep 3
for url in "https://${ADMIN_DOMAIN}/" "https://${API_DOMAIN}/socket.io/?EIO=4&transport=polling"; do
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "${url}" || true)"
  log "smoke ${url} -> HTTP ${code}"
done

log "Done. https://${ADMIN_DOMAIN} and https://${API_DOMAIN} are live."
log "Renewal is automatic (certbot systemd timer). Test with: sudo certbot renew --dry-run"
