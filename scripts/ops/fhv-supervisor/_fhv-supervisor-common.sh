#!/usr/bin/env bash
# Shared helpers for guarded FHV systemd supervisor tooling (DEE-424).
set -euo pipefail

readonly FHV_CAMPAIGN_UNIT="waia-fhv-campaign.service"
readonly FHV_OBSERVER_UNIT="waia-fhv-observer.service"
readonly FHV_ALLOWED_UNITS=("$FHV_CAMPAIGN_UNIT" "$FHV_OBSERVER_UNIT")

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 2; }

is_full_sha() {
  local sha="$1"
  [[ "${#sha}" -eq 40 && "$sha" =~ ^[0-9a-f]{40}$ ]]
}

require_confirm_or_noop() {
  local action="$1"
  if [[ "${CONFIRM:-0}" -eq 0 ]]; then
    log "fhv-supervisor ${action}: NO-OP (missing --confirm)"
    [[ "${DRY_RUN:-0}" -eq 1 ]] && log "  mode: dry-run"
    return 1
  fi
  return 0
}

print_noop_footer() {
  log ""
  log "No mutation performed. Re-run with --confirm on the execution host to apply."
  log "Agents and Composer must never pass --confirm on fhv-supervisor tooling."
}

assert_allowed_unit() {
  local unit="$1"
  local allowed
  for allowed in "${FHV_ALLOWED_UNITS[@]}"; do
    [[ "$unit" == "$allowed" ]] && return 0
  done
  die "unit not allowlisted: ${unit}"
}

resolve_repo_root() {
  local start="${1:-}"
  if [[ -n "$start" ]]; then
    git -C "$start" rev-parse --show-toplevel && return 0
    die "--repo-path is not a git work tree: ${start}"
  fi
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  git -C "${script_dir}/../.." rev-parse --show-toplevel
}
