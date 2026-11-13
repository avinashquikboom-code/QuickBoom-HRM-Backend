#!/usr/bin/env bash
# ============================================================================
# HRM — manual full redeploy (both services). NOT called by CI.
#
# Usage on the server:  cd /var/www/hrm && ./deploy.sh
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "${SCRIPT_DIR}/backend.sh"
bash "${SCRIPT_DIR}/admin.sh"
