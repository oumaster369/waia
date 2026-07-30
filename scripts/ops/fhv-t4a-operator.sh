#!/usr/bin/env bash
# DEE-436 — canonical T4A workstation operator entry (exact tool bindings).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OPERATOR_TS="${SCRIPT_DIR}/fhv-t4a-operator.ts"
PRELUDE="${SCRIPT_DIR}/../trader/trader-cli-server-only-prelude.cjs"

: "${FHV_LOCAL_NODE_BIN:?FHV_LOCAL_NODE_BIN required}"
: "${FHV_LOCAL_GIT_BIN:?FHV_LOCAL_GIT_BIN required}"
: "${FHV_LOCAL_SSH_BIN:?FHV_LOCAL_SSH_BIN required}"

[[ -f "$OPERATOR_TS" ]] || {
  printf 'error: operator TypeScript entry missing: %s\n' "$OPERATOR_TS" >&2
  exit 2
}
[[ -f "$PRELUDE" ]] || {
  printf 'error: trader CLI prelude missing: %s\n' "$PRELUDE" >&2
  exit 2
}
[[ -e "${REPO_ROOT}/node_modules/tsx" ]] || {
  printf 'error: repo-local tsx missing under %s\n' "$REPO_ROOT" >&2
  exit 2
}

cd "$REPO_ROOT"
if [[ "$(pwd -P)" != "$(cd "$REPO_ROOT" && pwd -P)" ]]; then
  printf 'error: repository-root cwd invariant failed\n' >&2
  exit 2
fi

exec env WAIA_TRADER_CLI=1 \
  FHV_LOCAL_NODE_BIN="${FHV_LOCAL_NODE_BIN}" \
  FHV_LOCAL_GIT_BIN="${FHV_LOCAL_GIT_BIN}" \
  FHV_LOCAL_SSH_BIN="${FHV_LOCAL_SSH_BIN}" \
  "${FHV_LOCAL_NODE_BIN}" --require "${PRELUDE}" --import tsx "${OPERATOR_TS}" "$@"
