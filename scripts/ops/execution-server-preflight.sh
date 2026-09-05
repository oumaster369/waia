#!/usr/bin/env bash
# Read-only stale-code guard for the AI-TRADER Execution Server.
#
# Verifies that the WAIA checkout is clean, HEAD matches the declared target git
# SHA, and that commit is reachable from the explicitly approved remote ref.
# Does not mutate git state, containers, or remote hosts.
#
# Usage:
#   EXECUTION_SERVER_TARGET_SHA=<40-char-sha> ./scripts/ops/execution-server-preflight.sh
#   ./scripts/ops/execution-server-preflight.sh --target-sha <40-char-sha> [--repo-path PATH] [--approved-ref refs/remotes/origin/main]
#   ./scripts/ops/execution-server-preflight.sh --dry-run [--target-sha <sha>]
#
# Environment:
#   EXECUTION_SERVER_TARGET_SHA   Full git SHA to require (alternative to --target-sha)
#   EXECUTION_SERVER_REPO_PATH    Repo root to inspect (default: auto-detect from script)
#   EXECUTION_SERVER_APPROVED_REF Full ref that must contain the target commit
#                                 (default: refs/remotes/origin/main)
#
# Exit codes:
#   0 = clean HEAD matches target and target is approved
#   1 = stale / mismatch / invalid SHA
#   2 = usage error

set -euo pipefail

readonly SCRIPT_NAME="${0##*/}"

usage() {
  cat >&2 <<EOF
Usage:
  EXECUTION_SERVER_TARGET_SHA=<sha> ${SCRIPT_NAME}
  ${SCRIPT_NAME} --target-sha <sha> [--repo-path PATH] [--approved-ref REF] [--dry-run]

Read-only guard: refuses dirty worktrees, HEAD mismatches, and targets not
reachable from the approved ref. REF must be a fully qualified refs/... name.
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
APPROVED_REF="${EXECUTION_SERVER_APPROVED_REF:-refs/remotes/origin/main}"
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
    --approved-ref)
      if [[ $# -lt 2 ]]; then
        log "error: --approved-ref requires a value"
        usage
        exit 2
      fi
      APPROVED_REF="$2"
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

if [[ "$APPROVED_REF" != refs/* ]] ||
    ! git -C "$REPO_ROOT" check-ref-format "$APPROVED_REF" >/dev/null 2>&1; then
  log "error: approved ref must be a fully qualified valid refs/... name"
  log "       received: ${APPROVED_REF}"
  exit 1
fi

if ! git -C "$REPO_ROOT" cat-file -e "${TARGET_SHA}^{commit}" >/dev/null 2>&1; then
  log "result: UNAPPROVED — target SHA is not a local commit"
  exit 1
fi

if ! APPROVED_SHA="$(git -C "$REPO_ROOT" rev-parse --verify "${APPROVED_REF}^{commit}" 2>/dev/null)"; then
  log "result: UNAPPROVED — approved ref is missing or is not a commit: ${APPROVED_REF}"
  exit 1
fi

if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$TARGET_SHA" "$APPROVED_SHA"; then
  log "result: UNAPPROVED — target SHA is not reachable from ${APPROVED_REF}"
  exit 1
fi

HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
HEAD_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
TARGET_SHORT="$(printf '%s' "$TARGET_SHA" | cut -c1-7)"

log "execution-server preflight (read-only)"
log "  repo:   ${REPO_ROOT}"
log "  head:   ${HEAD_SHA} (${HEAD_SHORT})"
log "  target: ${TARGET_SHA} (${TARGET_SHORT})"
log "  approved ref: ${APPROVED_REF} (${APPROVED_SHA})"

if [[ "$HEAD_SHA" != "$TARGET_SHA" ]]; then
  log "result: STALE — checkout HEAD does not match target SHA"
  log "action: sync host checkout to ${TARGET_SHA} before build/deploy/campaign (see docs/ops/EXECUTION-SERVER-RUNBOOK.md §3)"
  exit 1
fi

DIRTY_STATUS="$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)"
if [[ -n "$DIRTY_STATUS" ]]; then
  log "result: DIRTY — checkout contains tracked or untracked residue"
  while IFS= read -r dirty_entry; do
    [[ -n "$dirty_entry" ]] && log "  ${dirty_entry}"
  done <<< "$DIRTY_STATUS"
  exit 1
fi

[[ "$DRY_RUN" -eq 1 ]] && log "dry-run: validation only; no mutation performed"
log "result: OK — clean checkout matches approved target SHA"
