#!/usr/bin/env bash
# Deploy both services (backend first, then admin).
#   Usage: ./deploy-all.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/deploy-backend.sh"
"$DIR/deploy-admin.sh"
echo "All services deployed."
