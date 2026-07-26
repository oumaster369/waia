#!/usr/bin/env bash
# Rollback FHV systemd units (Human-only, requires --confirm).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_fhv-supervisor-common.sh
source "${SCRIPT_DIR}/_fhv-supervisor-common.sh"

CONFIRM=0
DRY_RUN=0
UNIT="all"
SYSTEMD_DIR=""
SYSTEMCTL=""

usage() {
  cat >&2 <<'EOF'
Usage: rollback-units.sh --systemctl-bin PATH --systemd-dir DIR \
  [--unit waia-fhv-campaign.service|waia-fhv-observer.service|all] \
  [--dry-run] [--confirm]

Stops, disables, and removes allowlisted FHV systemd units.
Without --confirm: print planned actions only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=1; shift ;;
    --unit) UNIT="${2:-}"; shift 2 ;;
    --systemd-dir) SYSTEMD_DIR="${2:-}"; shift 2 ;;
    --systemctl-bin) SYSTEMCTL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$SYSTEMCTL" && -x "$SYSTEMCTL" ]] || die "--systemctl-bin required and must be executable"
[[ -n "$SYSTEMD_DIR" && -d "$SYSTEMD_DIR" ]] || die "--systemd-dir required and must exist"

resolve_rollback_units() {
  case "$UNIT" in
    all) printf '%s\n%s\n' "$FHV_OBSERVER_UNIT" "$FHV_CAMPAIGN_UNIT" ;;
    "$FHV_CAMPAIGN_UNIT"|"$FHV_OBSERVER_UNIT") printf '%s\n' "$UNIT" ;;
    *) die "invalid --unit value" ;;
  esac
}

if [[ "$CONFIRM" -eq 0 ]]; then
  while IFS= read -r unit_name; do
    [[ -n "$unit_name" ]] || continue
    log "planned: systemctl stop ${unit_name} (via ${SYSTEMCTL})"
    log "planned: systemctl disable ${unit_name} (via ${SYSTEMCTL})"
    log "planned: rm -f ${SYSTEMD_DIR}/${unit_name}"
  done < <(resolve_rollback_units)
  log "planned: systemctl daemon-reload (via ${SYSTEMCTL})"
  print_noop_footer
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run: planned actions only; no mutation performed"
  exit 0
fi

rollback_one() {
  local unit_name="$1"
  assert_allowed_unit "$unit_name"
  local active_state enabled_state
  active_state="$(classify_systemctl_is_active "$unit_name")"
  enabled_state="$(classify_systemctl_is_enabled "$unit_name")"

  case "$active_state" in
    active)
      "$SYSTEMCTL" stop "$unit_name"
      ;;
    inactive|not-found)
      log "note: ${unit_name} already inactive or not found (benign)"
      ;;
    *)
      die "fatal: unclassified is-active state '${active_state}' for ${unit_name}; unit file preserved"
      ;;
  esac

  case "$enabled_state" in
    enabled)
      "$SYSTEMCTL" disable "$unit_name"
      ;;
    disabled|not-found)
      log "note: ${unit_name} already disabled or not installed (benign)"
      ;;
    *)
      die "fatal: unclassified is-enabled state '${enabled_state}' for ${unit_name}; unit file preserved"
      ;;
  esac

  rm -f "${SYSTEMD_DIR}/${unit_name}"
}

while IFS= read -r unit_name; do
  [[ -n "$unit_name" ]] || continue
  rollback_one "$unit_name"
done < <(resolve_rollback_units)

"$SYSTEMCTL" daemon-reload
log "Rollback complete."
