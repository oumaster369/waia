#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ops/_execution-server-common.sh
source "${SCRIPT_DIR}/_execution-server-common.sh"
readonly SCRIPT_NAME="${0##*/}"
usage() { cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --target-sha <sha> [--repo-path PATH] [--confirm] [--dry-run]
Pins checkout and merges deployed-revision.json gitSha on --confirm. No-op without --confirm.
EOF
}
TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"; REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"; CONFIRM=0; DRY_RUN=0
while [[ $# -gt 0 ]]; do case "$1" in
  --target-sha) TARGET_SHA="$2"; shift 2;; --repo-path) REPO_PATH="$2"; shift 2;;
  --confirm) CONFIRM=1; shift;; --dry-run) DRY_RUN=1; shift;; -h|--help) usage; exit 0;;
  *) die "unknown argument: $1";; esac; done
[[ -n "$TARGET_SHA" ]] || die "target SHA required"; is_full_sha "$TARGET_SHA" || die "invalid target SHA"
REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"; REVISION_PATH="$(resolve_revision_path "$REPO_ROOT")"
log "execution-server sync"; log "  repo: ${REPO_ROOT}"; log "  target: ${TARGET_SHA}"; log "  revision file: ${REVISION_PATH}"
log "planned actions: git fetch/checkout, preflight, merge gitSha"
if ! require_confirm_or_noop "sync"; then print_noop_footer; exit 0; fi
git -C "$REPO_ROOT" fetch origin; git -C "$REPO_ROOT" checkout "$TARGET_SHA"
run_preflight "$REPO_ROOT" "$TARGET_SHA" || { log "preflight failed"; exit 1; }
revision_merge_json "$REVISION_PATH" "$(node -e "process.stdout.write(JSON.stringify({gitSha:process.argv[1]}))" "$TARGET_SHA")"
log "result: OK"
