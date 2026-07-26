#!/usr/bin/env bash
# DEE-436 — frozen dependency installation as the FHV service user (root caller).
set -euo pipefail

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

fhv_t4_emit_json() {
  local python_bin="$1"
  shift
  "$python_bin" -c 'import json, os, sys; print(json.dumps(json.loads(os.environ["FHV_JSON_PAYLOAD"]), separators=(",", ":")))'
}

usage() {
  cat >&2 <<'EOF'
Usage: fhv-service-user-install-deps.sh \
  --service-user VALUE \
  --repo-root ABS_PATH \
  --node-bin ABS_PATH \
  --corepack-bin ABS_PATH \
  --git-bin ABS_PATH \
  --python-bin ABS_PATH

Root-only wrapper: runs frozen lockfile install as the service user.
Does not source EnvironmentFile.
EOF
}

SERVICE_USER=""
REPO_ROOT=""
NODE_BIN=""
COREPACK_BIN=""
GIT_BIN=""
PYTHON_BIN=""

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --repo-root) REPO_ROOT="${2:-}"; shift 2 ;;
    --node-bin) NODE_BIN="${2:-}"; shift 2 ;;
    --corepack-bin) COREPACK_BIN="${2:-}"; shift 2 ;;
    --git-bin) GIT_BIN="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$SERVICE_USER" && -n "$REPO_ROOT" && -n "$NODE_BIN" && -n "$COREPACK_BIN" && -n "$GIT_BIN" && -n "$PYTHON_BIN" ]] || usage
[[ "$REPO_ROOT" = /* ]] || fail "repo-root must be absolute"
[[ "$NODE_BIN" = /* ]] || fail "node-bin must be absolute"
[[ -x "$NODE_BIN" ]] || fail "node-bin not executable"
[[ -x "$COREPACK_BIN" ]] || fail "corepack-bin not executable"
[[ -x "$GIT_BIN" ]] || fail "git-bin not executable"
[[ -x "$PYTHON_BIN" ]] || fail "python-bin not executable"
[[ -d "$REPO_ROOT" ]] || fail "repo-root missing"

fhv_t4_require_effective_root
fhv_t4_resolve_service_user_identity "$SERVICE_USER"

CHECKOUT_UID="$(stat -c '%u' "$REPO_ROOT" 2>/dev/null || stat -f '%u' "$REPO_ROOT")"
if [[ "$CHECKOUT_UID" != "$FHV_SERVICE_UID" ]]; then
  fail "repo-root must be owned by service user"
fi

runuser -u "$SERVICE_USER" -- env -i \
  "PATH=$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  "HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)" \
  "USER=${SERVICE_USER}" \
  "LOGNAME=${SERVICE_USER}" \
  "LANG=${LANG:-C.UTF-8}" \
  bash --noprofile --norc -c '
set -euo pipefail
cd "$1"
shift
RESOLVED_NODE="$1"
shift
COREPACK_BIN="$1"
shift
if [[ "$(command -v node)" != "$RESOLVED_NODE" ]]; then
  printf "error: node resolution drift\n" >&2
  exit 2
fi
exec "$COREPACK_BIN" pnpm@10 install --frozen-lockfile
' bash "$REPO_ROOT" "$NODE_BIN" "$COREPACK_BIN"

[[ -x "${REPO_ROOT}/node_modules/.bin/tsx" ]] || fail "tsx missing after install"

MODULES_UID="$(stat -c '%u' "${REPO_ROOT}/node_modules" 2>/dev/null || stat -f '%u' "${REPO_ROOT}/node_modules")"
if [[ "$MODULES_UID" != "$FHV_SERVICE_UID" ]]; then
  fail "node_modules must be owned by service user"
fi

if [[ -n "$(runuser -u "$SERVICE_USER" -- "$GIT_BIN" -C "$REPO_ROOT" status --porcelain=v1 -uno 2>/dev/null || true)" ]]; then
  fail "tracked tree must remain clean after install"
fi

export FHV_JSON_PAYLOAD
FHV_JSON_PAYLOAD="$(
  REPO_ROOT="$REPO_ROOT" FHV_SERVICE_UID="$FHV_SERVICE_UID" FHV_SERVICE_GID="$FHV_SERVICE_GID" FHV_SERVICE_GROUP="$FHV_SERVICE_GROUP" \
    "$PYTHON_BIN" - <<'PY'
import json, os
print(json.dumps({
    "schemaVersion": "fhv-t4-service-user-install-deps/v1",
    "classification": "FHV_T4_SERVICE_USER_INSTALL_DEPS_OK",
    "repoRoot": os.environ["REPO_ROOT"],
    "serviceUid": int(os.environ["FHV_SERVICE_UID"]),
    "serviceGid": int(os.environ["FHV_SERVICE_GID"]),
    "servicePrimaryGroup": os.environ["FHV_SERVICE_GROUP"],
}, separators=(",", ":")))
PY
)"
printf '%s\n' "$FHV_JSON_PAYLOAD"
printf 'classification=FHV_T4_SERVICE_USER_INSTALL_DEPS_OK\n'
