#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ops/_execution-server-common.sh
source "${SCRIPT_DIR}/_execution-server-common.sh"
readonly SCRIPT_NAME="${0##*/}"
usage() { cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --target-sha <sha> [--repo-path PATH] [--approved-ref refs/remotes/origin/main] [--confirm] [--dry-run]
Pins checkout and merges deployed-revision.json gitSha on --confirm. No-op without --confirm.
EOF
}
TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"; REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"
APPROVED_REF="${EXECUTION_SERVER_APPROVED_REF:-refs/remotes/origin/main}"; CONFIRM=0; DRY_RUN=0
while [[ $# -gt 0 ]]; do case "$1" in
  --target-sha) TARGET_SHA="$2"; shift 2;; --repo-path) REPO_PATH="$2"; shift 2;;
  --approved-ref) APPROVED_REF="$2"; shift 2;;
  --confirm) CONFIRM=1; shift;; --dry-run) DRY_RUN=1; shift;; -h|--help) usage; exit 0;;
  *) die "unknown argument: $1";; esac; done
[[ -n "$TARGET_SHA" ]] || die "target SHA required"; is_full_sha "$TARGET_SHA" || die "invalid target SHA"
REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"; REVISION_PATH="$(resolve_revision_path "$REPO_ROOT")"
log "execution-server sync"; log "  repo: ${REPO_ROOT}"; log "  target: ${TARGET_SHA}"; log "  approved ref: ${APPROVED_REF}"; log "  revision file: ${REVISION_PATH}"
log "planned actions: clean-tree check, git fetch, approved-ref verification, checkout, preflight, merge gitSha"
if ! require_confirm_or_noop "sync"; then print_noop_footer; exit 0; fi
[[ -z "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || \
  die "checkout contains tracked or untracked residue before sync"
if [[ "$APPROVED_REF" != refs/* ]] ||
    ! git -C "$REPO_ROOT" check-ref-format "$APPROVED_REF" >/dev/null 2>&1; then
  die "approved ref must be a fully qualified valid refs/... name"
fi
git -C "$REPO_ROOT" fetch origin
git -C "$REPO_ROOT" cat-file -e "${TARGET_SHA}^{commit}" >/dev/null 2>&1 || \
  die "target SHA is not a local commit after fetch"
APPROVED_SHA="$(git -C "$REPO_ROOT" rev-parse --verify "${APPROVED_REF}^{commit}" 2>/dev/null)" || \
  die "approved ref is missing or is not a commit: ${APPROVED_REF}"
git -C "$REPO_ROOT" merge-base --is-ancestor "$TARGET_SHA" "$APPROVED_SHA" || \
  die "target SHA is not reachable from approved ref ${APPROVED_REF}"
git -C "$REPO_ROOT" checkout "$TARGET_SHA"
run_preflight "$REPO_ROOT" "$TARGET_SHA" "$APPROVED_REF" || { log "preflight failed"; exit 1; }
revision_merge_json "$REVISION_PATH" "$(node -e "process.stdout.write(JSON.stringify({gitSha:process.argv[1]}))" "$TARGET_SHA")"
log "result: OK"
