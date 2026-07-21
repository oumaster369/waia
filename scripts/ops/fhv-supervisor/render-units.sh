#!/usr/bin/env bash
# Render FHV systemd units locally (no install). Human-only install follows separately.
set -euo pipefail

CONFIRM=0
DRY_RUN=0
REPO_PATH=""
TARGET_SHA=""
WORKING_DIRECTORY=""
SERVICE_USER=""
ENVIRONMENT_FILE=""
FHV_RUN_ROOT=""
FHV_RUN_ID=""
FHV_ORGANIZATION_ID=""
OUTPUT_DIR=""
NODE_BIN="$(command -v node || true)"
OBSERVER_PORT=9471

usage() {
  cat >&2 <<'EOF'
Usage: render-units.sh --target-sha SHA --working-directory PATH --service-user USER \
  --environment-file PATH --fhv-run-root PATH --fhv-run-id ID --fhv-organization-id UUID \
  [--repo-path PATH] [--output-dir DIR] [--node-bin PATH] [--observer-port PORT]

Renders waia-fhv-campaign.service and waia-fhv-observer.service to stdout or --output-dir.
No systemd mutation is performed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --repo-path) REPO_PATH="${2:-}"; shift 2 ;;
    --working-directory) WORKING_DIRECTORY="${2:-}"; shift 2 ;;
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --environment-file) ENVIRONMENT_FILE="${2:-}"; shift 2 ;;
    --fhv-run-root) FHV_RUN_ROOT="${2:-}"; shift 2 ;;
    --fhv-run-id) FHV_RUN_ID="${2:-}"; shift 2 ;;
    --fhv-organization-id) FHV_ORGANIZATION_ID="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --node-bin) NODE_BIN="${2:-}"; shift 2 ;;
    --observer-port) OBSERVER_PORT="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_fhv-supervisor-common.sh
source "${SCRIPT_DIR}/_fhv-supervisor-common.sh"

[[ -n "$TARGET_SHA" ]] || die "--target-sha is required"
is_full_sha "$TARGET_SHA" || die "--target-sha must be a 40-char lowercase hex SHA"
[[ -n "$WORKING_DIRECTORY" ]] || die "--working-directory is required"
[[ -n "$SERVICE_USER" ]] || die "--service-user is required"
[[ -n "$ENVIRONMENT_FILE" ]] || die "--environment-file is required"
[[ -n "$FHV_RUN_ROOT" ]] || die "--fhv-run-root is required"
[[ -n "$FHV_RUN_ID" ]] || die "--fhv-run-id is required"
[[ -n "$FHV_ORGANIZATION_ID" ]] || die "--fhv-organization-id is required"
[[ -n "$NODE_BIN" ]] || die "node binary not found; pass --node-bin"

REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"

export FHV_RENDER_REPO_ROOT="$REPO_ROOT"
export FHV_RENDER_WORKING_DIRECTORY="$WORKING_DIRECTORY"
export FHV_RENDER_SERVICE_USER="$SERVICE_USER"
export FHV_RENDER_ENVIRONMENT_FILE="$ENVIRONMENT_FILE"
export FHV_RENDER_TARGET_SHA="$TARGET_SHA"
export FHV_RENDER_NODE_BIN="$NODE_BIN"
export FHV_RENDER_FHV_RUN_ROOT="$FHV_RUN_ROOT"
export FHV_RENDER_FHV_RUN_ID="$FHV_RUN_ID"
export FHV_RENDER_FHV_ORGANIZATION_ID="$FHV_ORGANIZATION_ID"
export FHV_RENDER_OBSERVER_PORT="$OBSERVER_PORT"

rendered="$(
  (
    cd "$REPO_ROOT"
    WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server \
      scripts/ops/fhv-supervisor/render-units-cli.ts
  )
)"

campaign_unit="$(printf '%s' "$rendered" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.campaignUnit);})')"
observer_unit="$(printf '%s' "$rendered" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.observerUnit);})')"

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
  printf '%s\n' "$campaign_unit" > "${OUTPUT_DIR}/${FHV_CAMPAIGN_UNIT}"
  printf '%s\n' "$observer_unit" > "${OUTPUT_DIR}/${FHV_OBSERVER_UNIT}"
  log "Rendered units to ${OUTPUT_DIR}/"
else
  printf '%s\n' "===== ${FHV_CAMPAIGN_UNIT} ====="
  printf '%s\n' "$campaign_unit"
  printf '%s\n' "===== ${FHV_OBSERVER_UNIT} ====="
  printf '%s\n' "$observer_unit"
fi

if command -v systemd-analyze >/dev/null 2>&1 && [[ -n "$OUTPUT_DIR" ]]; then
  systemd-analyze verify "${OUTPUT_DIR}/${FHV_CAMPAIGN_UNIT}" "${OUTPUT_DIR}/${FHV_OBSERVER_UNIT}" || true
fi

log "Render complete (no install performed)."
