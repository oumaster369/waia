#!/usr/bin/env bash
# Shared helpers for guarded FHV systemd supervisor tooling (DEE-424 / DEE-431).
set -euo pipefail

readonly FHV_CAMPAIGN_UNIT="waia-fhv-campaign.service"
readonly FHV_OBSERVER_UNIT="waia-fhv-observer.service"
readonly FHV_ALLOWED_UNITS=("$FHV_CAMPAIGN_UNIT" "$FHV_OBSERVER_UNIT")

SCRIPT_DIR_COMMON="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_fhv-git-trust.sh
source "${SCRIPT_DIR_COMMON}/../_fhv-git-trust.sh"

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 2; }

is_full_sha() {
  local sha="$1"
  [[ "${#sha}" -eq 40 && "$sha" =~ ^[0-9a-f]{40}$ ]]
}

require_confirm_or_noop() {
  local action="$1"
  if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
    log "fhv-supervisor ${action}: NO-OP (dry-run mode)"
    return 1
  fi
  if [[ "${CONFIRM:-0}" -eq 0 ]]; then
    log "fhv-supervisor ${action}: NO-OP (missing --confirm)"
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
  local repo_path="${1:-}"
  local git_bin="${2:-}"
  if [[ -n "$repo_path" ]]; then
    [[ -n "$git_bin" ]] || die "--git-bin is required with --repo-path"
    fhv_git_trust_resolve_bound_repo_root "$git_bin" "$repo_path"
    return 0
  fi
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -n "$git_bin" ]]; then
    fhv_git_trust_require_abs_safe_path "git-bin" "$git_bin"
    [[ -x "$git_bin" ]] || die "git-bin not executable"
    fhv_git_trust_repo_git "$git_bin" "${script_dir}/../.." rev-parse --show-toplevel
    return 0
  fi
  git -C "${script_dir}/../.." rev-parse --show-toplevel
}

classify_systemctl_is_active() {
  local unit="$1"
  local exit_code=0
  local output=""
  output="$("$SYSTEMCTL" is-active "$unit" 2>&1)" || exit_code=$?
  case "$exit_code" in
    0)
      if [[ "$output" == "active" || "$output" == "activating" || "$output" == "reloading" ]]; then
        printf '%s\n' "active"
        return 0
      fi
      die "fatal: malformed is-active success output for ${unit}: ${output}"
      ;;
    3)
      printf '%s\n' "inactive"
      return 0
      ;;
    4)
      printf '%s\n' "not-found"
      return 0
      ;;
    1)
      if [[ "$output" == "inactive" || "$output" == "failed" || "$output" == "deactivating" ]]; then
        printf '%s\n' "inactive"
        return 0
      fi
      die "fatal: unclassified is-active exit 1 for ${unit}: ${output}"
      ;;
    126|127)
      die "fatal: systemctl unavailable for is-active ${unit}"
      ;;
    *)
      die "fatal: unclassified is-active exit ${exit_code} for ${unit}: ${output}"
      ;;
  esac
}

classify_systemctl_is_enabled() {
  local unit="$1"
  local exit_code=0
  local output=""
  output="$("$SYSTEMCTL" is-enabled "$unit" 2>&1)" || exit_code=$?
  case "$exit_code" in
    0)
      printf '%s\n' "enabled"
      return 0
      ;;
    1)
      if [[ "$output" == "disabled" || "$output" == "masked" || "$output" == "static" || "$output" == "indirect" ]]; then
        printf '%s\n' "disabled"
        return 0
      fi
      die "fatal: unclassified is-enabled exit 1 for ${unit}: ${output}"
      ;;
    4)
      printf '%s\n' "not-found"
      return 0
      ;;
    126|127)
      die "fatal: systemctl unavailable for is-enabled ${unit}"
      ;;
    *)
      die "fatal: unclassified is-enabled exit ${exit_code} for ${unit}: ${output}"
      ;;
  esac
}
