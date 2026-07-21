#!/usr/bin/env bash
# Rollback FHV systemd units (Human-only, requires --confirm).
set -euo pipefail

CONFIRM=0
DRY_RUN=0
UNIT="all"
SYSTEMD_DIR="/etc/systemd/system"

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
  systemctl stop "$unit_name" || true
  systemctl disable "$unit_name" || true
  rm -f "${SYSTEMD_DIR}/${unit_name}"
}

rc=0
case "$UNIT" in
  all)
    rollback_one "$FHV_OBSERVER_UNIT" || rc=1
    rollback_one "$FHV_CAMPAIGN_UNIT" || rc=1
    ;;
  "$FHV_CAMPAIGN_UNIT"|"$FHV_OBSERVER_UNIT")
    rollback_one "$UNIT" || rc=1
    ;;
  *) die "invalid --unit value" ;;
esac

if require_confirm_or_noop "daemon-reload"; then
  systemctl daemon-reload
else
  log "planned: systemctl daemon-reload"
  print_noop_footer
fi

exit "$rc"
