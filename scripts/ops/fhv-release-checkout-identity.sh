#!/usr/bin/env bash
# DEE-436 — read-only Git checkout / release-tag identity verifier.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WAIA_TRADER_CLI=1 exec node --import tsx --conditions=react-server \
  "${ROOT}/scripts/ops/fhv-release-checkout-identity-cli.ts" "$@"
