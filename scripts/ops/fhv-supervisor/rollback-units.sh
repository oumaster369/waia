#!/usr/bin/env bash
# Rollback FHV systemd units (Human-only, requires --confirm).
set -euo pipefail

CONFIRM=0
DRY_RUN=0
UNIT="all"
SYSTEMD_DIR="/etc/systemd/system"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"

usage() {
  cat >&2 <<'EOF'
Usage: rollback-units.sh [--unit waia-fhv-campaign.service|waia-fhv-observer.service|all] \
  [--systemd-dir DIR] [--dry-run] [--confirm]

Stops, disables, and removes allowlisted FHV systemd units.
Without --confirm: print planned actions only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=1; shift ;;
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

rollback_one() {
  local unit_name="$1"
  assert_allowed_unit "$unit_name"
  log "planned: systemctl stop ${unit_name}"
  log "planned: systemctl disable ${unit_name}"
  log "planned: rm -f ${SYSTEMD_DIR}/${unit_name}"
  if ! require_confirm_or_noop "rollback"; then
    return 1
  fi
  if "$SYSTEMCTL" is-active --quiet "$unit_name"; then
    "$SYSTEMCTL" stop "$unit_name"
  else
    log "note: ${unit_name} already stopped (idempotent)"
  fi
  if "$SYSTEMCTL" is-enabled --quiet "$unit_name" 2>/dev/null; then
    "$SYSTEMCTL" disable "$unit_name"
  else
    log "note: ${unit_name} already disabled or not installed (idempotent)"
  fi
  rm -f "${SYSTEMD_DIR}/${unit_name}"
}

if [[ "$CONFIRM" -eq 0 ]]; then
  case "$UNIT" in
    all)
      log "planned: systemctl stop ${FHV_OBSERVER_UNIT}"
      log "planned: systemctl stop ${FHV_CAMPAIGN_UNIT}"
      log "planned: systemctl disable ${FHV_OBSERVER_UNIT}"
      log "planned: systemctl disable ${FHV_CAMPAIGN_UNIT}"
      log "planned: rm -f ${SYSTEMD_DIR}/${FHV_OBSERVER_UNIT}"
      log "planned: rm -f ${SYSTEMD_DIR}/${FHV_CAMPAIGN_UNIT}"
      log "planned: systemctl daemon-reload"
      ;;
    "$FHV_CAMPAIGN_UNIT"|"$FHV_OBSERVER_UNIT")
      log "planned: systemctl stop ${UNIT}"
      log "planned: systemctl disable ${UNIT}"
      log "planned: rm -f ${SYSTEMD_DIR}/${UNIT}"
      log "planned: systemctl daemon-reload"
      ;;
    *) die "invalid --unit value" ;;
  esac
  print_noop_footer
  exit 0
fi

case "$UNIT" in
  all)
    rollback_one "$FHV_OBSERVER_UNIT"
    rollback_one "$FHV_CAMPAIGN_UNIT"
    ;;
  "$FHV_CAMPAIGN_UNIT"|"$FHV_OBSERVER_UNIT")
    rollback_one "$UNIT"
    ;;
  *) die "invalid --unit value" ;;
esac

log "planned: systemctl daemon-reload"
"$SYSTEMCTL" daemon-reload
log "Rollback complete."
