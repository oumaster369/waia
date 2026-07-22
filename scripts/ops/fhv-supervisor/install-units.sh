#!/usr/bin/env bash
# Install FHV systemd units on Execution Server (Human-only, requires --confirm).
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
UNIT=""
SYSTEMD_DIR="/etc/systemd/system"
SYSTEMD_ANALYZE="${SYSTEMD_ANALYZE:-systemd-analyze}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"

usage() {
  cat >&2 <<'EOF'
Usage: install-units.sh --target-sha SHA --working-directory PATH --service-user USER \
  --environment-file PATH --fhv-run-root PATH --fhv-run-id ID --fhv-organization-id UUID \
  [--unit waia-fhv-campaign.service|waia-fhv-observer.service|all] [--repo-path PATH] \
  [--systemd-dir DIR] [--dry-run] [--confirm]

Without --confirm: print planned actions and exit without mutation.
EOF
}

UNIT="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=1; shift ;;
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --repo-path) REPO_PATH="${2:-}"; shift 2 ;;
    --working-directory) WORKING_DIRECTORY="${2:-}"; shift 2 ;;
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --environment-file) ENVIRONMENT_FILE="${2:-}"; shift 2 ;;
    --fhv-run-root) FHV_RUN_ROOT="${2:-}"; shift 2 ;;
    --fhv-run-id) FHV_RUN_ID="${2:-}"; shift 2 ;;
    --fhv-organization-id) FHV_ORGANIZATION_ID="${2:-}"; shift 2 ;;
    --unit) UNIT="${2:-}"; shift 2 ;;
    --systemd-dir) SYSTEMD_DIR="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_fhv-supervisor-common.sh
source "${SCRIPT_DIR}/_fhv-supervisor-common.sh"

[[ -n "$TARGET_SHA" ]] || die "--target-sha is required"
is_full_sha "$TARGET_SHA" || die "invalid target SHA"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

"${SCRIPT_DIR}/render-units.sh" \
  --target-sha "$TARGET_SHA" \
  --repo-path "$REPO_PATH" \
  --working-directory "$WORKING_DIRECTORY" \
  --service-user "$SERVICE_USER" \
  --environment-file "$ENVIRONMENT_FILE" \
  --fhv-run-root "$FHV_RUN_ROOT" \
  --fhv-run-id "$FHV_RUN_ID" \
  --fhv-organization-id "$FHV_ORGANIZATION_ID" \
  --output-dir "$tmp_dir" >/dev/null

verify_rendered_units() {
  if ! command -v "$SYSTEMD_ANALYZE" >/dev/null 2>&1; then
    die "systemd-analyze is required for unit verification"
  fi
  "$SYSTEMD_ANALYZE" verify "${tmp_dir}/${FHV_CAMPAIGN_UNIT}" "${tmp_dir}/${FHV_OBSERVER_UNIT}"
}

verify_rendered_units

install_one() {
  local unit_name="$1"
  assert_allowed_unit "$unit_name"
  log "planned: install ${SYSTEMD_DIR}/${unit_name}"
  if ! require_confirm_or_noop "install"; then
    return 1
  fi
  install -m 0644 "${tmp_dir}/${unit_name}" "${SYSTEMD_DIR}/${unit_name}"
}

reload_and_enable() {
  local unit_name="$1"
  log "planned: systemctl daemon-reload"
  log "planned: systemctl enable ${unit_name}"
  if ! require_confirm_or_noop "enable"; then
    return 1
  fi
  "$SYSTEMCTL" daemon-reload
  "$SYSTEMCTL" enable "$unit_name"
}

if [[ "$CONFIRM" -eq 0 ]]; then
  case "$UNIT" in
    all)
      log "planned: install ${SYSTEMD_DIR}/${FHV_CAMPAIGN_UNIT}"
      log "planned: install ${SYSTEMD_DIR}/${FHV_OBSERVER_UNIT}"
      log "planned: systemctl daemon-reload"
      log "planned: systemctl enable ${FHV_CAMPAIGN_UNIT}"
      log "planned: systemctl enable ${FHV_OBSERVER_UNIT}"
      ;;
    "$FHV_CAMPAIGN_UNIT"|"$FHV_OBSERVER_UNIT")
      log "planned: install ${SYSTEMD_DIR}/${UNIT}"
      log "planned: systemctl daemon-reload"
      log "planned: systemctl enable ${UNIT}"
      ;;
    *) die "invalid --unit value" ;;
  esac
  print_noop_footer
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run: planned actions only; no mutation performed"
  exit 0
fi

case "$UNIT" in
  all)
    install_one "$FHV_CAMPAIGN_UNIT"
    install_one "$FHV_OBSERVER_UNIT"
    reload_and_enable "$FHV_CAMPAIGN_UNIT"
    reload_and_enable "$FHV_OBSERVER_UNIT"
    ;;
  "$FHV_CAMPAIGN_UNIT"|"$FHV_OBSERVER_UNIT")
    install_one "$UNIT"
    reload_and_enable "$UNIT"
    ;;
  *) die "invalid --unit value" ;;
esac

log "Install complete."
