#!/usr/bin/env bash
# Read-only Cursor / WAIA developer environment preflight.
#
# Verifies tooling, git context, hooks, and MCP config without mutating state.
#
# Usage:
#   ./scripts/ops/cursor-env-preflight.sh [--repo-path PATH] [--dry-run]
#
# Environment:
#   CURSOR_ENV_REPO_PATH   Repo root to inspect (default: auto-detect from script)
#
# Exit codes:
#   0 = all checks passed (or --dry-run with gaps reported)
#   1 = one or more checks failed (strict mode only)
#   2 = usage error

set -euo pipefail

readonly SCRIPT_NAME="${0##*/}"

usage() {
  cat >&2 <<EOF
Usage:
  ${SCRIPT_NAME} [--repo-path PATH] [--dry-run]

Read-only WAIA Cursor environment checks (node, pnpm, gh, hooks, mcp.json).
EOF
}

log() {
  printf '%s\n' "$*" >&2
}

resolve_repo_root() {
  local start="${1:-}"
  if [[ -n "$start" ]]; then
    if git -C "$start" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git -C "$start" rev-parse --show-toplevel
      return 0
    fi
    log "error: --repo-path is not a git work tree: ${start}"
    return 1
  fi

  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  git -C "${script_dir}/../.." rev-parse --show-toplevel
}

REPO_PATH="${CURSOR_ENV_REPO_PATH:-}"
DRY_RUN=0
FAILURES=0
CHECKS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-path)
      if [[ $# -lt 2 ]]; then
        log "error: --repo-path requires a value"
        usage
        exit 2
      fi
      REPO_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      log "error: unknown argument: $1"
      usage
      exit 2
      ;;
  esac
done

record_check() {
  local name="$1"
  local ok="$2"
  local detail="$3"

  CHECKS=$((CHECKS + 1))
  if [[ "$ok" -eq 1 ]]; then
    log "  [ok]   ${name}: ${detail}"
  else
    log "  [FAIL] ${name}: ${detail}"
    FAILURES=$((FAILURES + 1))
  fi
}

REPO_ROOT="$(resolve_repo_root "$REPO_PATH")" || exit 2

log "cursor-env preflight (read-only)"
log "  repo: ${REPO_ROOT}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  log "  mode: dry-run (gaps reported; exit 0)"
else
  log "  mode: strict"
fi

# --- Tooling ---

if command -v node >/dev/null 2>&1; then
  node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "$node_major" == "22" ]]; then
    record_check "node" 1 "$(node -v) (expect 22.x)"
  else
    record_check "node" 0 "$(node -v) (expect 22.x)"
  fi
else
  record_check "node" 0 "not found (install Node 22.x)"
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm_major="$(pnpm -v | sed -E 's/^([0-9]+).*/\1/')"
  if [[ "$pnpm_major" == "10" ]]; then
    record_check "pnpm" 1 "$(pnpm -v) (expect 10.x)"
  else
    record_check "pnpm" 0 "$(pnpm -v) (expect 10.x)"
  fi
else
  record_check "pnpm" 0 "not found (install pnpm 10.x)"
fi

if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    record_check "gh" 1 "authenticated"
  else
    record_check "gh" 0 "installed but not authenticated (run: gh auth login)"
  fi
else
  record_check "gh" 0 "not found (install GitHub CLI)"
fi

if command -v jq >/dev/null 2>&1; then
  record_check "jq" 1 "present (optional but recommended)"
else
  record_check "jq" 0 "not found (optional; recommended for hooks)"
fi

# --- Repository artifacts ---

mcp_json="${REPO_ROOT}/.cursor/mcp.json"
if [[ -f "$mcp_json" ]]; then
  if grep -q '@playwright/mcp@latest' "$mcp_json" 2>/dev/null; then
    record_check "mcp.json" 0 "Playwright MCP uses @latest — pin a version"
  elif grep -q '@playwright/mcp@' "$mcp_json" 2>/dev/null; then
    record_check "mcp.json" 1 "Playwright MCP version pinned"
  else
    record_check "mcp.json" 0 "playwright server entry missing or unexpected format"
  fi
else
  record_check "mcp.json" 0 "missing ${mcp_json}"
fi

hooks_json="${REPO_ROOT}/.cursor/hooks.json"
if [[ -f "$hooks_json" ]]; then
  record_check "hooks.json" 1 "present"
else
  record_check "hooks.json" 0 "missing ${hooks_json}"
fi

guard_shell="${REPO_ROOT}/.cursor/hooks/guard-shell.sh"
if [[ -f "$guard_shell" && -x "$guard_shell" ]]; then
  record_check "guard-shell.sh" 1 "present and executable"
elif [[ -f "$guard_shell" ]]; then
  record_check "guard-shell.sh" 0 "present but not executable (chmod +x)"
else
  record_check "guard-shell.sh" 0 "missing ${guard_shell}"
fi

agents_md="${REPO_ROOT}/AGENTS.md"
if [[ -f "$agents_md" ]]; then
  record_check "AGENTS.md" 1 "present"
else
  record_check "AGENTS.md" 0 "missing ${agents_md}"
fi

model_policy="${REPO_ROOT}/docs/waia-governance/MODEL-COST-POLICY.md"
if [[ -f "$model_policy" ]]; then
  record_check "MODEL-COST-POLICY" 1 "present"
else
  record_check "MODEL-COST-POLICY" 0 "missing (Slice F)"
fi

operator_quickref="${REPO_ROOT}/docs/ops/OPERATOR-QUICKREF.md"
if [[ -f "$operator_quickref" ]]; then
  record_check "OPERATOR-QUICKREF" 1 "present"
else
  record_check "OPERATOR-QUICKREF" 0 "missing (Slice F)"
fi

# --- Git branch hygiene (informational) ---

current_branch="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)"
if [[ -n "$current_branch" ]]; then
  if [[ "$current_branch" == "dev" || "$current_branch" == "main" ]]; then
    record_check "branch" 0 "on protected branch '${current_branch}' — use dee-<NN>-<slug>"
  elif [[ "$current_branch" =~ ^dee-[0-9]+- ]]; then
    record_check "branch" 1 "${current_branch}"
  else
    record_check "branch" 0 "${current_branch} (expect dee-<NN>-<slug>)"
  fi
else
  record_check "branch" 0 "detached or unknown"
fi

# --- Summary ---

log ""
log "summary: ${CHECKS} checks, ${FAILURES} failure(s)"

if [[ "$FAILURES" -eq 0 ]]; then
  log "result: OK — environment preflight passed"
  exit 0
fi

log "result: GAPS — see failures above"
log "action: follow docs/ops/CURSOR-ENVIRONMENT.md (§13–§15)"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run: exiting 0 (gaps reported, no mutation performed)"
  exit 0
fi

exit 1
