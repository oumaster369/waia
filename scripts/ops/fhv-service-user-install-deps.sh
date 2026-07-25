#!/usr/bin/env bash
# DEE-436 — frozen dependency installation as the FHV service user (no EnvironmentFile).
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: fhv-service-user-install-deps.sh \
  --service-user VALUE \
  --repo-root ABS_PATH \
  --corepack-bin ABS_PATH

Runs: cd REPO_ROOT && corepack pnpm@10 install --frozen-lockfile
Does not source EnvironmentFile.
EOF
}

SERVICE_USER=""
REPO_ROOT=""
COREPACK_BIN=""

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --repo-root) REPO_ROOT="${2:-}"; shift 2 ;;
    --corepack-bin) COREPACK_BIN="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$SERVICE_USER" && -n "$REPO_ROOT" && -n "$COREPACK_BIN" ]] || usage
[[ "$REPO_ROOT" = /* ]] || fail "repo-root must be absolute"
[[ -x "$COREPACK_BIN" ]] || fail "corepack-bin not executable"
[[ -d "$REPO_ROOT" ]] || fail "repo-root missing"

if [[ "$(id -u)" -eq 0 ]]; then
  fail "must not run as root"
fi
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  fail "service user does not exist"
fi

SERVICE_UID="$(id -u "$SERVICE_USER")"
CHECKOUT_UID="$(stat -c '%u' "$REPO_ROOT" 2>/dev/null || stat -f '%u' "$REPO_ROOT")"
if [[ "$CHECKOUT_UID" != "$SERVICE_UID" ]]; then
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
if [[ "$MODULES_UID" != "$SERVICE_UID" ]]; then
  fail "node_modules must be owned by service user"
fi

if [[ -n "$(runuser -u "$SERVICE_USER" -- git -C "$REPO_ROOT" status --porcelain=v1 -uno 2>/dev/null || true)" ]]; then
  fail "tracked tree must remain clean after install"
fi

python3 - <<PY
import json
print(json.dumps({
    "schemaVersion": "fhv-t4-service-user-install-deps/v1",
    "classification": "FHV_T4_SERVICE_USER_INSTALL_DEPS_OK",
    "repoRoot": """$REPO_ROOT""",
    "serviceUid": $SERVICE_UID,
}, separators=(",", ":")))
PY
printf 'classification=FHV_T4_SERVICE_USER_INSTALL_DEPS_OK\n'
