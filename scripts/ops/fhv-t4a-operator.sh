#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec env WAIA_TRADER_CLI=1 node --import tsx "${SCRIPT_DIR}/fhv-t4a-operator.ts" "$@"
