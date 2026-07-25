#!/usr/bin/env bash
# DEE-436 — dependency-free Execution Server host preflight (PRE_AUTHORIZED).
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-host-preflight.sh \
  --expected-hostname VALUE \
  --expected-machine-id-sha256 VALUE \
  --service-user VALUE \
  --environment-file ABS_PATH \
  --artifact-root ABS_PATH \
  --checkout-parent ABS_PATH \
  --node-bin ABS_PATH \
  --corepack-bin ABS_PATH \
  --git-bin ABS_PATH \
  --python-bin ABS_PATH \
  --docker-bin ABS_PATH \
  --expected-legacy-container-name VALUE \
  --expected-legacy-container-image VALUE \
  [--output ABS_PATH]

Read-only unless --output is supplied (POST_AUTHORIZED immutable proof only).
EOF
}

EXPECTED_HOSTNAME=""
EXPECTED_MACHINE_ID_SHA256=""
SERVICE_USER=""
ENVIRONMENT_FILE=""
ARTIFACT_ROOT=""
CHECKOUT_PARENT=""
NODE_BIN=""
COREPACK_BIN=""
GIT_BIN=""
PYTHON_BIN=""
DOCKER_BIN=""
EXPECTED_LEGACY_CONTAINER_NAME=""
EXPECTED_LEGACY_CONTAINER_IMAGE=""
OUTPUT=""

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

require_abs() {
  local label="$1"
  local value="$2"
  [[ -n "$value" ]] || fail "${label} is required"
  [[ "$value" = /* ]] || fail "${label} must be absolute"
  case "$value" in
    *".."*) fail "${label} must not contain .." ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-hostname) EXPECTED_HOSTNAME="${2:-}"; shift 2 ;;
    --expected-machine-id-sha256) EXPECTED_MACHINE_ID_SHA256="${2:-}"; shift 2 ;;
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --environment-file) ENVIRONMENT_FILE="${2:-}"; shift 2 ;;
    --artifact-root) ARTIFACT_ROOT="${2:-}"; shift 2 ;;
    --checkout-parent) CHECKOUT_PARENT="${2:-}"; shift 2 ;;
    --node-bin) NODE_BIN="${2:-}"; shift 2 ;;
    --corepack-bin) COREPACK_BIN="${2:-}"; shift 2 ;;
    --git-bin) GIT_BIN="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    --docker-bin) DOCKER_BIN="${2:-}"; shift 2 ;;
    --expected-legacy-container-name) EXPECTED_LEGACY_CONTAINER_NAME="${2:-}"; shift 2 ;;
    --expected-legacy-container-image) EXPECTED_LEGACY_CONTAINER_IMAGE="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$EXPECTED_HOSTNAME" && -n "$EXPECTED_MACHINE_ID_SHA256" && -n "$SERVICE_USER" ]] || usage
require_abs "environment-file" "$ENVIRONMENT_FILE"
require_abs "artifact-root" "$ARTIFACT_ROOT"
require_abs "checkout-parent" "$CHECKOUT_PARENT"
require_abs "node-bin" "$NODE_BIN"
require_abs "corepack-bin" "$COREPACK_BIN"
require_abs "git-bin" "$GIT_BIN"
require_abs "python-bin" "$PYTHON_BIN"
require_abs "docker-bin" "$DOCKER_BIN"
[[ -n "$EXPECTED_LEGACY_CONTAINER_NAME" && -n "$EXPECTED_LEGACY_CONTAINER_IMAGE" ]] || usage

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "host OS must be Linux"
fi

if ! command -v systemctl >/dev/null 2>&1; then
  fail "systemd runtime required"
fi

ACTUAL_HOSTNAME="$(hostname)"
if [[ "$ACTUAL_HOSTNAME" != "$EXPECTED_HOSTNAME" ]]; then
  fail "hostname mismatch"
fi

if [[ ! -r /etc/machine-id ]]; then
  fail "/etc/machine-id unreadable"
fi
ACTUAL_MACHINE_ID_SHA256="$(sha256sum /etc/machine-id | awk '{print $1}')"
if [[ "$ACTUAL_MACHINE_ID_SHA256" != "$EXPECTED_MACHINE_ID_SHA256" ]]; then
  fail "machine-id digest mismatch"
fi

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  fail "service user does not exist"
fi
SERVICE_UID="$(id -u "$SERVICE_USER")"
if [[ "$SERVICE_UID" -eq 0 ]]; then
  fail "service user UID must be nonzero"
fi
SERVICE_GID="$(id -g "$SERVICE_USER")"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

for bin in "$NODE_BIN" "$COREPACK_BIN" "$GIT_BIN" "$PYTHON_BIN" "$DOCKER_BIN"; do
  [[ -x "$bin" ]] || fail "executable missing or not executable: $bin"
done

if [[ ! -r "$ENVIRONMENT_FILE" ]]; then
  fail "environment file missing or unreadable"
fi
if ! runuser -u "$SERVICE_USER" -- test -r "$ENVIRONMENT_FILE"; then
  fail "environment file not readable by service user"
fi
grep -q '^FHV_HOST_OS_QUALIFIED=true$' "$ENVIRONMENT_FILE" || fail "FHV_HOST_OS_QUALIFIED=true missing"
grep -q '^FHV_COMMAND_ENFORCEMENT_ENABLED=true$' "$ENVIRONMENT_FILE" || fail "FHV_COMMAND_ENFORCEMENT_ENABLED=true missing"

[[ -d "$CHECKOUT_PARENT" ]] || fail "checkout parent missing"
if ! runuser -u "$SERVICE_USER" -- test -w "$CHECKOUT_PARENT"; then
  fail "checkout parent not writable by service user"
fi

ARTIFACT_WRITABLE_ROOT="$ARTIFACT_ROOT"
if [[ -e "$ARTIFACT_ROOT" ]]; then
  ARTIFACT_WRITABLE_ROOT="$ARTIFACT_ROOT"
else
  ARTIFACT_WRITABLE_ROOT="$(dirname "$ARTIFACT_ROOT")"
fi
if ! runuser -u "$SERVICE_USER" -- test -w "$ARTIFACT_WRITABLE_ROOT"; then
  fail "artifact root or parent not writable by service user"
fi

if ! runuser -u "$SERVICE_USER" -- "$NODE_BIN" -e 'process.exit(0)'; then
  fail "node cannot execute as service user"
fi
if ! runuser -u "$SERVICE_USER" -- "$COREPACK_BIN" --version >/dev/null; then
  fail "corepack cannot execute as service user"
fi
if ! runuser -u "$SERVICE_USER" -- "$GIT_BIN" --version >/dev/null; then
  fail "git cannot execute as service user"
fi
if ! runuser -u "$SERVICE_USER" -- "$PYTHON_BIN" -c 'import sys; sys.exit(0)'; then
  fail "python cannot execute as service user"
fi
if ! runuser -u "$SERVICE_USER" -- "$DOCKER_BIN" version >/dev/null; then
  fail "docker cannot execute as service user"
fi

DISK_INFO="$(df -Pk "$ARTIFACT_WRITABLE_ROOT" "$CHECKOUT_PARENT" 2>/dev/null | tail -n +2 | awk '{print $1":"$4}' | paste -sd, -)"

if ! runuser -u "$SERVICE_USER" -- "$DOCKER_BIN" inspect "$EXPECTED_LEGACY_CONTAINER_NAME" >/dev/null 2>&1; then
  fail "legacy container not found"
fi
CONTAINER_STATE="$(runuser -u "$SERVICE_USER" -- "$DOCKER_BIN" inspect -f '{{.State.Status}}' "$EXPECTED_LEGACY_CONTAINER_NAME")"
if [[ "$CONTAINER_STATE" != "running" ]]; then
  fail "legacy container not running"
fi
CONTAINER_IMAGE="$(runuser -u "$SERVICE_USER" -- "$DOCKER_BIN" inspect -f '{{.Config.Image}}' "$EXPECTED_LEGACY_CONTAINER_NAME")"
if [[ "$CONTAINER_IMAGE" != "$EXPECTED_LEGACY_CONTAINER_IMAGE" ]]; then
  fail "legacy container image mismatch"
fi

BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)"

JSON="$(python3 - <<PY
import json
print(json.dumps({
    "schemaVersion": "fhv-t4-host-preflight/v1",
    "classification": "FHV_T4_HOST_PREFLIGHT_OK",
    "hostname": """$ACTUAL_HOSTNAME""",
    "machineIdSha256": """$ACTUAL_MACHINE_ID_SHA256""",
    "bootId": """$BOOT_ID""",
    "serviceUser": """$SERVICE_USER""",
    "serviceUid": $SERVICE_UID,
    "serviceGid": $SERVICE_GID,
    "servicePrimaryGroup": """$SERVICE_GROUP""",
    "environmentFile": """$ENVIRONMENT_FILE""",
    "artifactRoot": """$ARTIFACT_ROOT""",
    "checkoutParent": """$CHECKOUT_PARENT""",
    "nodeBin": """$NODE_BIN""",
    "corepackBin": """$COREPACK_BIN""",
    "gitBin": """$GIT_BIN""",
    "pythonBin": """$PYTHON_BIN""",
    "dockerBin": """$DOCKER_BIN""",
    "legacyContainerName": """$EXPECTED_LEGACY_CONTAINER_NAME""",
    "legacyContainerImage": """$CONTAINER_IMAGE""",
    "legacyContainerState": """$CONTAINER_STATE""",
    "diskAvailability": """$DISK_INFO""",
}, separators=(",", ":")))
PY
)"

printf '%s\n' "$JSON"
printf 'classification=FHV_T4_HOST_PREFLIGHT_OK\n'

if [[ -n "$OUTPUT" ]]; then
  require_abs "output" "$OUTPUT"
  printf 'error: --output proof write requires trader:fhv:t4:record-host-preflight after dependencies install\n' >&2
  exit 2
fi
