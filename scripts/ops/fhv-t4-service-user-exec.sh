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
  "trader:fhv:t4:status"
  "trader:fhv:t4:verify"
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
  "trader:fhv:t4:ingest-host-probe"
  "trader:fhv:t4:record-checkout-identity"
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
Paths and arguments are passed via positional parameters (no shell interpolation).
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_fhv-t4-privilege-common.sh
source "${SCRIPT_DIR}/_fhv-t4-privilege-common.sh"

[[ -f "$ENVIRONMENT_FILE" ]] || { printf 'error: environment file missing\n' >&2; exit 2; }
[[ -d "$REPO_ROOT" ]] || { printf 'error: repo-root is not a directory\n' >&2; exit 2; }

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

# Reject secret-bearing argv flags before privilege transition.
for arg in "$@"; do
  case "$arg" in
    --command-secret|--tunnel-secret)
      printf 'error: secret flags are forbidden on argv\n' >&2
      exit 2
      ;;
  esac
done

fhv_t4_require_effective_root
fhv_t4_resolve_service_user_identity "$SERVICE_USER"

# Pass paths/script/args as positional parameters into a non-login bash.
# No untrusted values are interpolated into the executable shell text.
# Allowlist only non-secret machine-observation env vars from the parent shell.
PASS_ENV=(
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  "HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
  "USER=${SERVICE_USER}"
  "LOGNAME=${SERVICE_USER}"
  "LANG=${LANG:-C.UTF-8}"
)
for key in \
  FHV_T4_HOST_PROBE_JSON \
  FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON \
  FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON \
  FHV_T4_SYSTEMD_IDENTITY_JSON \
  FHV_T4_HOST_MONOTONIC_JSON \
  FHV_COREPACK_BIN
do
  if [[ -n "${!key:-}" ]]; then
    PASS_ENV+=("${key}=${!key}")
  fi
done

runuser -u "$SERVICE_USER" -- \
  env -i "${PASS_ENV[@]}" \
  bash --noprofile --norc -c '
set -euo pipefail
REPO_ROOT="$1"
ENVIRONMENT_FILE="$2"
SCRIPT="$3"
shift 3
cd "$REPO_ROOT"
set -a
# shellcheck disable=SC1090
source "$ENVIRONMENT_FILE"
set +a
COREPACK_BIN="${FHV_COREPACK_BIN:-corepack}"
exec "$COREPACK_BIN" pnpm@10 "$SCRIPT" "$@"
' bash "$REPO_ROOT" "$ENVIRONMENT_FILE" "$SCRIPT" "$@"
