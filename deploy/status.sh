#!/usr/bin/env bash
# Show HRM container status + live resource usage + recent logs.
#   Usage: ./status.sh [backend|admin]
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/config.sh"

status

case "${1:-}" in
  backend) docker logs --tail 40 "$BACKEND_CONTAINER" ;;
  admin)   docker logs --tail 40 "$ADMIN_CONTAINER" ;;
  "")      : ;;
  *)       die "unknown service '$1' (use: backend|admin)" ;;
esac
