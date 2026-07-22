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

resolve_install_units() {
  case "$UNIT" in
    all) printf '%s\n%s\n' "$FHV_CAMPAIGN_UNIT" "$FHV_OBSERVER_UNIT" ;;
    "$FHV_CAMPAIGN_UNIT"|"$FHV_OBSERVER_UNIT") printf '%s\n' "$UNIT" ;;
    *) die "invalid --unit value" ;;
  esac
}

if [[ "$CONFIRM" -eq 0 ]]; then
  while IFS= read -r unit_name; do
    [[ -n "$unit_name" ]] || continue
    log "planned: install ${SYSTEMD_DIR}/${unit_name}"
    log "planned: systemctl enable ${unit_name}"
  done < <(resolve_install_units)
  log "planned: systemctl daemon-reload"
  print_noop_footer
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run: planned actions only; no mutation performed"
  exit 0
fi

INSTALL_UNITS=()
while IFS= read -r unit_name; do
  [[ -n "$unit_name" ]] || continue
  INSTALL_UNITS+=("$unit_name")
done < <(resolve_install_units)

snapshot_dir="$(mktemp -d)"
snapshot_manifest="${snapshot_dir}/snapshot.tsv"
: >"$snapshot_manifest"

capture_snapshot() {
  local unit_name dest enabled_state
  for unit_name in "${INSTALL_UNITS[@]}"; do
    assert_allowed_unit "$unit_name"
    dest="${SYSTEMD_DIR}/${unit_name}"
    if [[ -f "$dest" ]]; then
      cp "$dest" "${snapshot_dir}/${unit_name}.bak"
      printf '%s\tpresent\t' "$unit_name" >>"$snapshot_manifest"
    else
      printf '%s\tabsent\t' "$unit_name" >>"$snapshot_manifest"
    fi
    enabled_state="$(classify_systemctl_is_enabled "$unit_name")"
    printf '%s\n' "$enabled_state" >>"$snapshot_manifest"
  done
}

restore_snapshot() {
  local restore_failed=0 line unit_name file_state enabled_state
  while IFS=$'\t' read -r unit_name file_state enabled_state; do
    [[ -n "$unit_name" ]] || continue
    dest="${SYSTEMD_DIR}/${unit_name}"
    if [[ "$file_state" == "present" ]]; then
      cp "${snapshot_dir}/${unit_name}.bak" "$dest" || restore_failed=1
    else
      rm -f "$dest" || restore_failed=1
    fi
    case "$enabled_state" in
      enabled) "$SYSTEMCTL" enable "$unit_name" >/dev/null 2>&1 || restore_failed=1 ;;
      disabled|not-found) "$SYSTEMCTL" disable "$unit_name" >/dev/null 2>&1 || true ;;
      *) restore_failed=1 ;;
    esac
  done <"$snapshot_manifest"
  "$SYSTEMCTL" daemon-reload || restore_failed=1
  if [[ "$restore_failed" -ne 0 ]]; then
    log "error: rollback restoration reported failures"
  fi
}

install_units_transaction() {
  local unit_name
  for unit_name in "${INSTALL_UNITS[@]}"; do
    install -m 0644 "${tmp_dir}/${unit_name}" "${SYSTEMD_DIR}/${unit_name}" || return 1
  done
  "$SYSTEMCTL" daemon-reload || return 1
  for unit_name in "${INSTALL_UNITS[@]}"; do
    "$SYSTEMCTL" enable "$unit_name" || return 1
  done
  for unit_name in "${INSTALL_UNITS[@]}"; do
    [[ -f "${SYSTEMD_DIR}/${unit_name}" ]] || return 1
    classify_systemctl_is_enabled "$unit_name" >/dev/null || return 1
  done
}

capture_snapshot || die "failed to snapshot prior unit state"

set +e
install_units_transaction
install_status=$?
set -e

if [[ "$install_status" -ne 0 ]]; then
  restore_snapshot
  die "install transaction failed with exit ${install_status}; rollback attempted"
fi

log "Install complete."
