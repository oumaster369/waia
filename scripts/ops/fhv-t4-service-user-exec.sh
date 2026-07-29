#!/usr/bin/env bash
# DEE-436 — execute one allowlisted FHV T4 package command as the service user.
set -euo pipefail

SERVICE_USER=""
ENVIRONMENT_FILE=""
REPO_ROOT=""
NODE_BIN=""
COREPACK_BIN=""
ALLOWLIST=(
  "trader:fhv:rehearsal"
  "trader:fhv:t4:arm-pause"
  "trader:fhv:t4:resume"
  "trader:fhv:t4:status"
  "trader:fhv:t4:write-observer-qualification-proof"
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

fhv_t4_require_effective_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    printf 'error: caller must have effective UID 0\n' >&2
    exit 2
  fi
}

fhv_t4_resolve_service_user_identity() {
  local service_user="$1"
  if ! id -u "$service_user" >/dev/null 2>&1; then
    printf 'error: service user does not exist: %s\n' "$service_user" >&2
    exit 2
  fi
  FHV_SERVICE_UID="$(id -u "$service_user")"
  FHV_SERVICE_GID="$(id -g "$service_user")"
  FHV_SERVICE_GROUP="$(id -gn "$service_user")"
  if [[ "$FHV_SERVICE_UID" -eq 0 ]]; then
    printf 'error: service user UID must be nonzero\n' >&2
    exit 2
  fi
}

usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-service-user-exec.sh \
  --service-user USER \
  --environment-file PATH \
  --repo-root PATH \
  --node-bin ABS_PATH \
  --corepack-bin ABS_PATH \
  -- package-script [args...]

Runs: cd REPO_ROOT && corepack pnpm@10 <package-script> [args...]
EnvironmentFile keys are loaded via strict parser (never shell source).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --environment-file) ENVIRONMENT_FILE="${2:-}"; shift 2 ;;
    --repo-root) REPO_ROOT="${2:-}"; shift 2 ;;
    --node-bin) NODE_BIN="${2:-}"; shift 2 ;;
    --corepack-bin) COREPACK_BIN="${2:-}"; shift 2 ;;
    --) shift; break ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ -n "$SERVICE_USER" && -n "$ENVIRONMENT_FILE" && -n "$REPO_ROOT" && -n "$NODE_BIN" && -n "$COREPACK_BIN" ]] || { usage; exit 2; }
[[ $# -ge 1 ]] || { usage; exit 2; }

[[ "$NODE_BIN" = /* ]] || { printf 'error: node-bin must be absolute\n' >&2; exit 2; }
[[ "$COREPACK_BIN" = /* ]] || { printf 'error: corepack-bin must be absolute\n' >&2; exit 2; }
[[ -x "$NODE_BIN" ]] || { printf 'error: node-bin not executable\n' >&2; exit 2; }
[[ -x "$COREPACK_BIN" ]] || { printf 'error: corepack-bin not executable\n' >&2; exit 2; }
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

if ! runuser -u "$SERVICE_USER" -- "$NODE_BIN" -e 'process.exit(0)'; then
  printf 'error: node-bin not executable by service user\n' >&2
  exit 2
fi
if ! runuser -u "$SERVICE_USER" -- "$COREPACK_BIN" --version >/dev/null; then
  printf 'error: corepack-bin not executable by service user\n' >&2
  exit 2
fi

NODE_DIR="$(dirname "$NODE_BIN")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSE_HELPER="${SCRIPT_DIR}/fhv-t4-parse-environment-file.ts"
if [[ ! -f "$PARSE_HELPER" ]]; then
  printf 'error: environment parser helper missing\n' >&2
  exit 2
fi

mapfile -t PARSED_ENV < <(
  cd "$REPO_ROOT"
  WAIA_TRADER_CLI=1 "$NODE_BIN" --import tsx "$PARSE_HELPER" --path "$ENVIRONMENT_FILE" --format env
)

PASS_ENV=(
  "PATH=${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  "HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
  "USER=${SERVICE_USER}"
  "LOGNAME=${SERVICE_USER}"
  "LANG=${LANG:-C.UTF-8}"
  "FHV_COREPACK_BIN=${COREPACK_BIN}"
  "FHV_NODE_BIN=${NODE_BIN}"
)
PASS_ENV+=("${PARSED_ENV[@]}")
for key in \
  FHV_T4_HOST_PROBE_JSON \
  FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON \
  FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON \
  FHV_T4_SYSTEMD_IDENTITY_JSON \
  FHV_T4_HOST_MONOTONIC_JSON
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
SCRIPT="$2"
shift 2
cd "$REPO_ROOT"
RESOLVED_NODE="${FHV_NODE_BIN:?}"
RESOLVED_NODE_DIR="$(dirname "$RESOLVED_NODE")"
ACTUAL_NODE="$(command -v node)"
if [[ "$ACTUAL_NODE" != "$RESOLVED_NODE" ]]; then
  printf "error: node resolution drift: expected %s got %s\n" "$RESOLVED_NODE" "$ACTUAL_NODE" >&2
  exit 2
fi
exec "${FHV_COREPACK_BIN:?}" pnpm@10 "$SCRIPT" "$@"
' bash "$REPO_ROOT" "$SCRIPT" "$@"
