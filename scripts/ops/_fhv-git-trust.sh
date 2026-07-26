#!/usr/bin/env bash
# Shared command-scoped Git trust helpers for FHV ops scripts (DEE-436).
# Sourced by identity, supervisor, and deployment record verifiers.
# No persistent system/global/user Git configuration is modified.

fhv_git_trust_fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

fhv_git_trust_require_abs_safe_path() {
  local label="$1"
  local value="$2"
  [[ -n "$value" ]] || fhv_git_trust_fail "${label} is required"
  [[ "$value" = /* ]] || fhv_git_trust_fail "${label} must be absolute"
  case "$value" in
    *".."*) fhv_git_trust_fail "${label} must not contain .." ;;
    *$'\n'*|*$'\r'*|*$'\t'*) fhv_git_trust_fail "${label} must not contain control characters" ;;
    *'"'*) fhv_git_trust_fail "${label} must not contain double quotes" ;;
  esac
  if printf '%s' "$value" | LC_ALL=C grep -q '[[:cntrl:]]'; then
    fhv_git_trust_fail "${label} must not contain control characters"
  fi
}

fhv_git_trust_repo_git() {
  local git_bin="$1"
  local repo_path="$2"
  shift 2
  local canonical_path=""
  canonical_path="$(cd "$repo_path" && pwd -P)"
  "$git_bin" -c "safe.directory=${canonical_path}" -C "$canonical_path" "$@"
}

fhv_git_trust_resolve_bound_repo_root() {
  local git_bin="$1"
  local repo_path="$2"
  fhv_git_trust_require_abs_safe_path "repo-path" "$repo_path"
  fhv_git_trust_require_abs_safe_path "git-bin" "$git_bin"
  [[ -x "$git_bin" ]] || fhv_git_trust_fail "git-bin not executable"
  local canonical_path=""
  canonical_path="$(cd "$repo_path" && pwd -P)"
  local top_level=""
  if ! top_level="$(fhv_git_trust_repo_git "$git_bin" "$repo_path" rev-parse --show-toplevel 2>&1)"; then
    fhv_git_trust_fail "git worktree check failed for ${repo_path}: ${top_level}"
  fi
  local normalized_top=""
  normalized_top="$(cd "$top_level" && pwd -P)"
  if [[ "$normalized_top" != "$canonical_path" ]]; then
    fhv_git_trust_fail "resolved repo root ${top_level} != bound repo-path ${repo_path}"
  fi
  printf '%s\n' "$canonical_path"
}

fhv_ops_cd_repo_root() {
  local repo_root="$1"
  local expected=""
  fhv_git_trust_require_abs_safe_path "repo-root" "$repo_root"
  expected="$(cd "$repo_root" && pwd -P)"
  cd "$expected" || fhv_git_trust_fail "failed to cd to repo-root: ${repo_root}"
  if [[ "$(pwd -P)" != "$expected" ]]; then
    fhv_git_trust_fail "cwd $(pwd -P) != expected repo-root ${expected}"
  fi
}
