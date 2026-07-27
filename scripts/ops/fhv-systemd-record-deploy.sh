#!/usr/bin/env bash
# DEE-435 — record FHV systemd deployment truth (separate from legacy Docker record).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=_fhv-git-trust.sh
source "${SCRIPT_DIR}/_fhv-git-trust.sh"

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") \\
  --target-sha <sha> \\
  --release-tag <tag> \\
  --run-id <id> \\
  --organization-id <uuid> \\
  --operator <id> \\
  --service-user <user> \\
  --rendered-unit-digests '<json>' \\
  [--repo-path PATH] [--node-bin PATH] [--git-bin PATH] [--docker-bin PATH] [--confirm] [--dry-run]

Preview writes .ops/fhv-systemd-deployed-revision.v1.json without --confirm.
Atomic write occurs only with --confirm.
Legacy container ai-trader-execution-host / waia-execution-host:bp6 must be running (inspection only).
EOF
}

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 2; }

is_full_sha() {
  local sha="$1"
  [[ "${#sha}" -eq 40 && "$sha" =~ ^[0-9a-f]{40}$ ]]
}

repo_git() {
  fhv_git_trust_repo_git "$GIT_BIN" "$REPO_PATH" "$@"
}

resolve_record_repo_root() {
  if [[ -n "$REPO_PATH" ]]; then
    fhv_git_trust_require_abs_safe_path "repo-path" "$REPO_PATH"
    fhv_git_trust_require_abs_safe_path "git-bin" "$GIT_BIN"
    [[ -x "$GIT_BIN" ]] || die "git-bin not executable"
    fhv_git_trust_resolve_bound_repo_root "$GIT_BIN" "$REPO_PATH"
    return 0
  fi
  printf '%s\n' "$ROOT"
}

inspect_legacy_container_running() {
  local docker_bin="${DOCKER_BIN:-docker}"
  if ! command -v "$docker_bin" >/dev/null 2>&1; then
    die "docker required to inspect legacy container (inspection only)"
  fi
  local name="ai-trader-execution-host"
  local image="waia-execution-host:bp6"
  if ! "$docker_bin" inspect "$name" >/dev/null 2>&1; then
    die "legacy container missing: ${name}"
  fi
  local actual_image
  actual_image="$("$docker_bin" inspect --format='{{.Config.Image}}' "$name")"
  if [[ "$actual_image" != "$image" ]]; then
    die "legacy container image mismatch: expected ${image}, got ${actual_image}"
  fi
  local running
  running="$("$docker_bin" inspect --format='{{.State.Running}}' "$name")"
  if [[ "$running" != "true" ]]; then
    die "legacy container not running: ${name}"
  fi
  log "legacy container inspection: ${name} image=${image} running=true"
}

TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"
RELEASE_TAG=""
RUN_ID=""
ORGANIZATION_ID=""
OPERATOR=""
SERVICE_USER=""
RENDERED_UNIT_DIGESTS=""
REPO_PATH=""
CONFIRM=0
DRY_RUN=0
NODE_BIN=""
GIT_BIN=""
DOCKER_BIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --release-tag) RELEASE_TAG="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --organization-id) ORGANIZATION_ID="${2:-}"; shift 2 ;;
    --operator) OPERATOR="${2:-}"; shift 2 ;;
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --rendered-unit-digests) RENDERED_UNIT_DIGESTS="${2:-}"; shift 2 ;;
    --repo-path) REPO_PATH="${2:-}"; shift 2 ;;
    --node-bin) NODE_BIN="${2:-}"; shift 2 ;;
    --git-bin) GIT_BIN="${2:-}"; shift 2 ;;
    --docker-bin) DOCKER_BIN="${2:-}"; shift 2 ;;
    --confirm) CONFIRM=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$TARGET_SHA" && -n "$RELEASE_TAG" && -n "$RUN_ID" && -n "$ORGANIZATION_ID" && -n "$OPERATOR" && -n "$SERVICE_USER" && -n "$RENDERED_UNIT_DIGESTS" ]] \
  || die "all identity fields required (see --help)"
is_full_sha "$TARGET_SHA" || die "invalid target SHA"
[[ -n "$NODE_BIN" ]] || die "--node-bin is required"
[[ -n "$GIT_BIN" ]] || die "--git-bin is required"
[[ -n "$DOCKER_BIN" ]] || die "--docker-bin is required"
fhv_git_trust_require_abs_safe_path "node-bin" "$NODE_BIN"
[[ -x "$NODE_BIN" ]] || die "node-bin not executable"

REPO_ROOT="$(resolve_record_repo_root)"

INSTALLED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "fhv-systemd record deploy"
log "  repo: ${REPO_ROOT}"
log "  target sha: ${TARGET_SHA}"
log "  release tag: ${RELEASE_TAG}"
log "  run id: ${RUN_ID}"
log "  organization id: ${ORGANIZATION_ID}"
log "  operator: ${OPERATOR}"
log "  service user: ${SERVICE_USER}"

if [[ "$CONFIRM" -eq 1 ]]; then
  export DOCKER_BIN
  inspect_legacy_container_running
else
  log "  legacy container: preview mode (no docker inspection without --confirm)"
fi

CLI_ARGS=(
  --repo-root "$REPO_ROOT"
  --target-sha "$TARGET_SHA"
  --release-tag "$RELEASE_TAG"
  --run-id "$RUN_ID"
  --organization-id "$ORGANIZATION_ID"
  --operator "$OPERATOR"
  --service-user "$SERVICE_USER"
  --rendered-unit-digests "$RENDERED_UNIT_DIGESTS"
  --installed-at "$INSTALLED_AT"
  --legacy-container-running true
)
if [[ "$CONFIRM" -eq 1 ]]; then
  CLI_ARGS+=(--confirm)
fi

if [[ "$CONFIRM" -eq 0 ]]; then
  log "fhv-systemd record deploy: NO-OP (missing --confirm)"
  [[ "$DRY_RUN" -eq 1 ]] && log "  mode: dry-run"
fi

fhv_ops_cd_repo_root "$REPO_ROOT"
WAIA_TRADER_CLI=1 "$NODE_BIN" --import tsx --conditions=react-server \
  scripts/ops/fhv-systemd-record-deploy-cli.ts "${CLI_ARGS[@]}"

if [[ "$CONFIRM" -eq 0 ]]; then
  log ""
  log "No mutation performed. Re-run with --confirm on the execution host to apply."
else
  log "result: OK"
fi
