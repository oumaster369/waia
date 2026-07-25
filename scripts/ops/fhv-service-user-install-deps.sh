#!/usr/bin/env bash
# DEE-436 — frozen dependency installation as the FHV service user (root caller).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_fhv-t4-privilege-common.sh
source "${SCRIPT_DIR}/_fhv-t4-privilege-common.sh"

usage() {
  cat >&2 <<'EOF'
Usage: fhv-service-user-install-deps.sh \
  --service-user VALUE \
  --repo-root ABS_PATH \
  --corepack-bin ABS_PATH \
  --git-bin ABS_PATH \
  --python-bin ABS_PATH

Root-only wrapper: runs frozen lockfile install as the service user.
Does not source EnvironmentFile.
EOF
}

SERVICE_USER=""
REPO_ROOT=""
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
    --corepack-bin) COREPACK_BIN="${2:-}"; shift 2 ;;
    --git-bin) GIT_BIN="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$SERVICE_USER" && -n "$REPO_ROOT" && -n "$COREPACK_BIN" && -n "$GIT_BIN" && -n "$PYTHON_BIN" ]] || usage
[[ "$REPO_ROOT" = /* ]] || fail "repo-root must be absolute"
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
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  "HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)" \
  "USER=${SERVICE_USER}" \
  "LOGNAME=${SERVICE_USER}" \
  "LANG=${LANG:-C.UTF-8}" \
  bash --noprofile --norc -c '
set -euo pipefail
cd "$1"
shift
exec "$@"
' bash "$REPO_ROOT" "$COREPACK_BIN" pnpm@10 install --frozen-lockfile

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
