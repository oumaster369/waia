#!/usr/bin/env bash
# DEE-436 — canonical T4A workstation operator entry (exact tool bindings).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${FHV_LOCAL_NODE_BIN:?FHV_LOCAL_NODE_BIN required}"
: "${FHV_LOCAL_GIT_BIN:?FHV_LOCAL_GIT_BIN required}"
: "${FHV_LOCAL_SSH_BIN:?FHV_LOCAL_SSH_BIN required}"

exec env WAIA_TRADER_CLI=1 \
  FHV_LOCAL_NODE_BIN="${FHV_LOCAL_NODE_BIN}" \
  FHV_LOCAL_GIT_BIN="${FHV_LOCAL_GIT_BIN}" \
  FHV_LOCAL_SSH_BIN="${FHV_LOCAL_SSH_BIN}" \
  "${FHV_LOCAL_NODE_BIN}" --import tsx "${SCRIPT_DIR}/fhv-t4a-operator.ts" "$@"
