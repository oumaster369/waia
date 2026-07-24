#!/usr/bin/env bash
# DEE-435 — verify FHV systemd deployment record matches target SHA.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") --target-sha <sha> [--repo-path PATH]

Fails closed when .ops/fhv-systemd-deployed-revision.v1.json is missing, corrupt, or mismatched.
EOF
}

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 2; }

is_full_sha() {
  local sha="$1"
  [[ "${#sha}" -eq 40 && "$sha" =~ ^[0-9a-f]{40}$ ]]
}

TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"
REPO_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --repo-path) REPO_PATH="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$TARGET_SHA" ]] || die "--target-sha required"
is_full_sha "$TARGET_SHA" || die "invalid target SHA"

if [[ -n "$REPO_PATH" ]]; then
  REPO_ROOT="$(git -C "$REPO_PATH" rev-parse --show-toplevel)"
else
  REPO_ROOT="$ROOT"
fi

WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server \
  "${ROOT}/scripts/ops/fhv-systemd-verify-deploy-cli.ts" \
  --repo-root "$REPO_ROOT" --target-sha "$TARGET_SHA"

log "fhv-systemd verify deploy: PASS"
