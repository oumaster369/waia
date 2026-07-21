#!/usr/bin/env bash
# Fail-closed regression validator for FHV operational release identity (DEE-431).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server \
  "${ROOT}/scripts/ops/validate-fhv-release-identity-cli.ts" "$@"
