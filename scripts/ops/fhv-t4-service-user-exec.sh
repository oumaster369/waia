#!/usr/bin/env bash
# DEE-436 — execute one allowlisted FHV T4 package command as the service user.
set -euo pipefail

SERVICE_USER=""
ENVIRONMENT_FILE=""
REPO_ROOT=""
ALLOWLIST=(
  "trader:fhv:rehearsal"
  "trader:fhv:t4:arm-pause"
  "trader:fhv:t4:resume"
  "trader:fhv:t4:verify-paused"
  "trader:fhv:t4:verify-final"
  "trader:fhv:t4:wait-paused"
  "trader:fhv:t4:wait-final"
  "trader:fhv:t4:verify-deployment"
  "trader:fhv:t4:verify-rollback"
  "trader:fhv:t4:seal-evidence"
  "trader:fhv:t4:verify-seal"
  "trader:fhv:t4:verify-ceremony"
  "trader:fhv:t4:capture-continuity-before"
  "trader:fhv:t4:capture-continuity-after"
  "trader:fhv:t4:verify-continuity"
  "trader:fhv:t4:build-evidence-inventory"
)

usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-service-user-exec.sh \
  --service-user USER \
  --environment-file PATH \
  --repo-root PATH \
  -- package-script [args...]

Runs: cd REPO_ROOT && corepack pnpm@10 <package-script> [args...]
Secrets are sourced from EnvironmentFile inside the service-user shell only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --environment-file) ENVIRONMENT_FILE="${2:-}"; shift 2 ;;
    --repo-root) REPO_ROOT="${2:-}"; shift 2 ;;
    --) shift; break ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ -n "$SERVICE_USER" && -n "$ENVIRONMENT_FILE" && -n "$REPO_ROOT" ]] || { usage; exit 2; }
[[ $# -ge 1 ]] || { usage; exit 2; }
[[ -f "$ENVIRONMENT_FILE" ]] || { printf 'error: environment file missing\n' >&2; exit 2; }

SCRIPT="$1"
shift
allowed=0
for entry in "${ALLOWLIST[@]}"; do
  if [[ "$SCRIPT" == "$entry" ]]; then
    allowed=1
    break
  fi
done
if [[ "$allowed" -ne 1 ]]; then
  printf 'error: script not allowlisted: %s\n' "$SCRIPT" >&2
  exit 2
fi

# Never print EnvironmentFile contents; source inside service-user subshell only.
runuser -u "$SERVICE_USER" -- bash -lc "
set -euo pipefail
cd \"${REPO_ROOT}\"
set -a
source \"${ENVIRONMENT_FILE}\"
set +a
exec corepack pnpm@10 \"${SCRIPT}\" \"\$@\"
" bash "$@"
