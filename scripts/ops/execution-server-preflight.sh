#!/usr/bin/env bash
# Read-only stale-code guard for the AI-TRADER Execution Server.
#
# Verifies that the WAIA checkout HEAD matches the declared target git SHA.
# Does not mutate git state, containers, or remote hosts.
#
# Usage:
#   EXECUTION_SERVER_TARGET_SHA=<40-char-sha> ./scripts/ops/execution-server-preflight.sh
#   ./scripts/ops/execution-server-preflight.sh --target-sha <40-char-sha> [--repo-path PATH]
#   ./scripts/ops/execution-server-preflight.sh --dry-run [--target-sha <sha>]
#
# Environment:
#   EXECUTION_SERVER_TARGET_SHA   Full git SHA to require (alternative to --target-sha)
#   EXECUTION_SERVER_REPO_PATH    Repo root to inspect (default: auto-detect from script)
#
# Exit codes:
#   0 = HEAD matches target (or dry-run printed comparison)
#   1 = stale / mismatch / invalid SHA
#   2 = usage error

set -euo pipefail

readonly SCRIPT_NAME="${0##*/}"

usage() {
  cat >&2 <<EOF
Usage:
  EXECUTION_SERVER_TARGET_SHA=<sha> ${SCRIPT_NAME}
  ${SCRIPT_NAME} --target-sha <sha> [--repo-path PATH] [--dry-run]

Read-only guard: refuses when checkout HEAD != target SHA.
EOF
}

log() {
  printf '%s\n' "$*" >&2
}

is_full_sha() {
  local sha="$1"
  [[ "${#sha}" -eq 40 && "$sha" =~ ^[0-9a-f]{40}$ ]]
}

resolve_repo_root() {
  local start="${1:-}"
  if [[ -n "$start" ]]; then
    if git -C "$start" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git -C "$start" rev-parse --show-toplevel
      return 0
    fi
    log "error: --repo-path is not a git work tree: ${start}"
    return 1
  fi

  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  git -C "${script_dir}/../.." rev-parse --show-toplevel
}

TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"
REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-sha)
      if [[ $# -lt 2 ]]; then
        log "error: --target-sha requires a value"
        usage
        exit 2
      fi
      TARGET_SHA="$2"
      shift 2
      ;;
    --repo-path)
      if [[ $# -lt 2 ]]; then
        log "error: --repo-path requires a value"
        usage
        exit 2
      fi
      REPO_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      log "error: unknown argument: $1"
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$TARGET_SHA" ]]; then
  log "error: target SHA required (EXECUTION_SERVER_TARGET_SHA or --target-sha)"
  usage
  exit 2
fi

if ! is_full_sha "$TARGET_SHA"; then
  log "error: target SHA must be a 40-character lowercase hex git object id"
  log "       received: ${TARGET_SHA}"
  exit 1
fi

REPO_ROOT="$(resolve_repo_root "$REPO_PATH")" || exit 2

HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
HEAD_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
TARGET_SHORT="$(printf '%s' "$TARGET_SHA" | cut -c1-7)"

log "execution-server preflight (read-only)"
log "  repo:   ${REPO_ROOT}"
log "  head:   ${HEAD_SHA} (${HEAD_SHORT})"
log "  target: ${TARGET_SHA} (${TARGET_SHORT})"

if [[ "$HEAD_SHA" == "$TARGET_SHA" ]]; then
  log "result: OK — checkout matches target SHA"
  exit 0
fi

log "result: STALE — checkout HEAD does not match target SHA"
log "action: sync host checkout to ${TARGET_SHA} before build/deploy/campaign (see docs/ops/EXECUTION-SERVER-RUNBOOK.md §3)"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run: exiting 1 (mismatch reported, no mutation performed)"
fi

exit 1
