#!/usr/bin/env bash
# DEE-435 — record FHV systemd deployment truth (separate from legacy Docker record).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

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
  [--repo-path PATH] [--confirm] [--dry-run]

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

inspect_legacy_container_running() {
  if ! command -v docker >/dev/null 2>&1; then
    die "docker required to inspect legacy container (inspection only)"
  fi
  local name="ai-trader-execution-host"
  local image="waia-execution-host:bp6"
  if ! docker inspect "$name" >/dev/null 2>&1; then
    die "legacy container missing: ${name}"
  fi
  local actual_image
  actual_image="$(docker inspect --format='{{.Config.Image}}' "$name")"
  if [[ "$actual_image" != "$image" ]]; then
    die "legacy container image mismatch: expected ${image}, got ${actual_image}"
  fi
  local running
  running="$(docker inspect --format='{{.State.Running}}' "$name")"
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
    --confirm) CONFIRM=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$TARGET_SHA" && -n "$RELEASE_TAG" && -n "$RUN_ID" && -n "$ORGANIZATION_ID" && -n "$OPERATOR" && -n "$SERVICE_USER" && -n "$RENDERED_UNIT_DIGESTS" ]] \
  || die "all identity fields required (see --help)"
is_full_sha "$TARGET_SHA" || die "invalid target SHA"

if [[ -n "$REPO_PATH" ]]; then
  REPO_ROOT="$(git -C "$REPO_PATH" rev-parse --show-toplevel)"
else
  REPO_ROOT="$ROOT"
fi

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

WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server \
  "${ROOT}/scripts/ops/fhv-systemd-record-deploy-cli.ts" "${CLI_ARGS[@]}"

if [[ "$CONFIRM" -eq 0 ]]; then
  log ""
  log "No mutation performed. Re-run with --confirm on the execution host to apply."
else
  log "result: OK"
fi
