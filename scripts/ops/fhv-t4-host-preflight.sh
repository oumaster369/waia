#!/usr/bin/env bash
# DEE-436 — dependency-free Execution Server host preflight (PRE_AUTHORIZED).
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

FHV_T4_MIN_FREE_KB="${FHV_T4_MIN_FREE_KB:-524288}"

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
  --systemctl-bin ABS_PATH \
  --systemd-analyze-bin ABS_PATH \
  --expected-legacy-container-name VALUE \
  --expected-legacy-container-image VALUE \
  [--output ABS_PATH]

Read-only unless --output is supplied (POST_AUTHORIZED immutable proof only).
Caller must be root. Docker inspection is privileged (not service-user).
EOF
}

declare -A SEEN_FLAGS=()

track_flag() {
  local flag="$1"
  if [[ -n "${SEEN_FLAGS[$flag]:-}" ]]; then
    printf 'error: duplicate flag: %s\n' "$flag" >&2
    exit 2
  fi
  SEEN_FLAGS[$flag]=1
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
SYSTEMCTL_BIN=""
SYSTEMD_ANALYZE_BIN=""
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
    --expected-hostname) track_flag "$1"; EXPECTED_HOSTNAME="${2:-}"; shift 2 ;;
    --expected-machine-id-sha256) track_flag "$1"; EXPECTED_MACHINE_ID_SHA256="${2:-}"; shift 2 ;;
    --service-user) track_flag "$1"; SERVICE_USER="${2:-}"; shift 2 ;;
    --environment-file) track_flag "$1"; ENVIRONMENT_FILE="${2:-}"; shift 2 ;;
    --artifact-root) track_flag "$1"; ARTIFACT_ROOT="${2:-}"; shift 2 ;;
    --checkout-parent) track_flag "$1"; CHECKOUT_PARENT="${2:-}"; shift 2 ;;
    --node-bin) track_flag "$1"; NODE_BIN="${2:-}"; shift 2 ;;
    --corepack-bin) track_flag "$1"; COREPACK_BIN="${2:-}"; shift 2 ;;
    --git-bin) track_flag "$1"; GIT_BIN="${2:-}"; shift 2 ;;
    --python-bin) track_flag "$1"; PYTHON_BIN="${2:-}"; shift 2 ;;
    --docker-bin) track_flag "$1"; DOCKER_BIN="${2:-}"; shift 2 ;;
    --systemctl-bin) track_flag "$1"; SYSTEMCTL_BIN="${2:-}"; shift 2 ;;
    --systemd-analyze-bin) track_flag "$1"; SYSTEMD_ANALYZE_BIN="${2:-}"; shift 2 ;;
    --expected-legacy-container-name) track_flag "$1"; EXPECTED_LEGACY_CONTAINER_NAME="${2:-}"; shift 2 ;;
    --expected-legacy-container-image) track_flag "$1"; EXPECTED_LEGACY_CONTAINER_IMAGE="${2:-}"; shift 2 ;;
    --output) track_flag "$1"; OUTPUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$EXPECTED_HOSTNAME" && -n "$EXPECTED_MACHINE_ID_SHA256" && -n "$SERVICE_USER" ]] || usage
require_abs "environment-file" "$ENVIRONMENT_FILE"
require_abs "artifact-root" "$ARTIFACT_ROOT"
require_abs "checkout-parent" "$CHECKOUT_PARENT"
case "$CHECKOUT_PARENT" in
  /home/*)
    fail "checkout-parent under /home is incompatible with ProtectHome=true systemd sandbox"
    ;;
esac
case "$ARTIFACT_ROOT" in
  /home/*)
    fail "artifact-root under /home is incompatible with ProtectHome=true systemd sandbox"
    ;;
esac
require_abs "node-bin" "$NODE_BIN"
require_abs "corepack-bin" "$COREPACK_BIN"
require_abs "git-bin" "$GIT_BIN"
require_abs "python-bin" "$PYTHON_BIN"
require_abs "docker-bin" "$DOCKER_BIN"
require_abs "systemctl-bin" "$SYSTEMCTL_BIN"
require_abs "systemd-analyze-bin" "$SYSTEMD_ANALYZE_BIN"
[[ -x "$SYSTEMCTL_BIN" ]] || fail "systemctl-bin not executable"
[[ -x "$SYSTEMD_ANALYZE_BIN" ]] || fail "systemd-analyze-bin not executable"
[[ -n "$EXPECTED_LEGACY_CONTAINER_NAME" && -n "$EXPECTED_LEGACY_CONTAINER_IMAGE" ]] || usage

fhv_t4_require_effective_root

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "host OS must be Linux"
fi

[[ -d /run/systemd/system ]] || fail "/run/systemd/system missing"
if [[ "$(readlink -f /proc/1/exe 2>/dev/null || true)" != *systemd* ]]; then
  fail "systemd must be the active init (PID 1)"
fi
if ! "$SYSTEMCTL_BIN" --version >/dev/null 2>&1; then
  fail "systemctl probe failed"
fi
if ! "$SYSTEMD_ANALYZE_BIN" critical-chain --no-pager systemd-journald.service >/dev/null 2>&1; then
  fail "systemd-analyze probe failed"
fi

ACTUAL_HOSTNAME="$(hostname)"
[[ "$ACTUAL_HOSTNAME" == "$EXPECTED_HOSTNAME" ]] || fail "hostname mismatch"

[[ -r /etc/machine-id ]] || fail "/etc/machine-id unreadable"
ACTUAL_MACHINE_ID_SHA256="$(sha256sum /etc/machine-id | awk '{print $1}')"
[[ "$ACTUAL_MACHINE_ID_SHA256" == "$EXPECTED_MACHINE_ID_SHA256" ]] || fail "machine-id digest mismatch"

fhv_t4_resolve_service_user_identity "$SERVICE_USER"

for bin in "$NODE_BIN" "$COREPACK_BIN" "$GIT_BIN" "$PYTHON_BIN" "$DOCKER_BIN"; do
  [[ -x "$bin" ]] || fail "executable missing or not executable: $bin"
done

[[ -r "$ENVIRONMENT_FILE" ]] || fail "environment file missing or unreadable"
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
if [[ ! -e "$ARTIFACT_ROOT" ]]; then
  ARTIFACT_WRITABLE_ROOT="$(dirname "$ARTIFACT_ROOT")"
fi
if ! runuser -u "$SERVICE_USER" -- test -w "$ARTIFACT_WRITABLE_ROOT"; then
  fail "artifact root or parent not writable by service user"
fi

FREE_KB="$(df -Pk "$ARTIFACT_WRITABLE_ROOT" "$CHECKOUT_PARENT" 2>/dev/null | tail -n +2 | awk '{print $4}' | sort -n | head -1)"
if [[ -z "$FREE_KB" || "$FREE_KB" -lt "$FHV_T4_MIN_FREE_KB" ]]; then
  fail "insufficient free disk space (minimum ${FHV_T4_MIN_FREE_KB} KiB required)"
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

if ! "$DOCKER_BIN" inspect "$EXPECTED_LEGACY_CONTAINER_NAME" >/dev/null 2>&1; then
  fail "legacy container not found"
fi
CONTAINER_STATE="$("$DOCKER_BIN" inspect -f '{{.State.Status}}' "$EXPECTED_LEGACY_CONTAINER_NAME")"
[[ "$CONTAINER_STATE" == "running" ]] || fail "legacy container not running"
CONTAINER_IMAGE="$("$DOCKER_BIN" inspect -f '{{.Config.Image}}' "$EXPECTED_LEGACY_CONTAINER_NAME")"
[[ "$CONTAINER_IMAGE" == "$EXPECTED_LEGACY_CONTAINER_IMAGE" ]] || fail "legacy container image mismatch"

MONOTONIC_JSON="$("$PYTHON_BIN" - <<'PY'
import json, pathlib, time
boot_id = pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()
print(json.dumps({
    "schemaVersion": "fhv-t4-host-monotonic-sample/v1",
    "clockSource": "CLOCK_BOOTTIME",
    "bootId": boot_id,
    "monotonicNs": str(time.clock_gettime_ns(time.CLOCK_BOOTTIME)),
}, separators=(",", ":")))
PY
)"
HOST_BOOT_ID="$(printf '%s' "$MONOTONIC_JSON" | "$PYTHON_BIN" -c 'import json,sys; print(json.load(sys.stdin)["bootId"])')"

export FHV_JSON_PAYLOAD
FHV_JSON_PAYLOAD="$(
  ACTUAL_HOSTNAME="$ACTUAL_HOSTNAME" \
  ACTUAL_MACHINE_ID_SHA256="$ACTUAL_MACHINE_ID_SHA256" \
  SERVICE_USER="$SERVICE_USER" \
  FHV_SERVICE_UID="$FHV_SERVICE_UID" \
  FHV_SERVICE_GID="$FHV_SERVICE_GID" \
  FHV_SERVICE_GROUP="$FHV_SERVICE_GROUP" \
  ENVIRONMENT_FILE="$ENVIRONMENT_FILE" \
  ARTIFACT_ROOT="$ARTIFACT_ROOT" \
  CHECKOUT_PARENT="$CHECKOUT_PARENT" \
  NODE_BIN="$NODE_BIN" \
  COREPACK_BIN="$COREPACK_BIN" \
  GIT_BIN="$GIT_BIN" \
  PYTHON_BIN="$PYTHON_BIN" \
  DOCKER_BIN="$DOCKER_BIN" \
  SYSTEMCTL_BIN="$SYSTEMCTL_BIN" \
  SYSTEMD_ANALYZE_BIN="$SYSTEMD_ANALYZE_BIN" \
  HOST_BOOT_ID="$HOST_BOOT_ID" \
  EXPECTED_LEGACY_CONTAINER_NAME="$EXPECTED_LEGACY_CONTAINER_NAME" \
  CONTAINER_IMAGE="$CONTAINER_IMAGE" \
  CONTAINER_STATE="$CONTAINER_STATE" \
  FREE_KB="$FREE_KB" \
  MIN_FREE_KB="$FHV_T4_MIN_FREE_KB" \
  MONOTONIC_JSON="$MONOTONIC_JSON" \
  "$PYTHON_BIN" - <<'PY'
import json, os
payload = {
    "schemaVersion": "fhv-t4-host-preflight/v2",
    "classification": "FHV_T4_HOST_PREFLIGHT_OK",
    "hostname": os.environ["ACTUAL_HOSTNAME"],
    "machineIdSha256": os.environ["ACTUAL_MACHINE_ID_SHA256"],
    "serviceUser": os.environ["SERVICE_USER"],
    "serviceUid": int(os.environ["FHV_SERVICE_UID"]),
    "serviceGid": int(os.environ["FHV_SERVICE_GID"]),
    "servicePrimaryGroup": os.environ["FHV_SERVICE_GROUP"],
    "environmentFile": os.environ["ENVIRONMENT_FILE"],
    "artifactRoot": os.environ["ARTIFACT_ROOT"],
    "checkoutParent": os.environ["CHECKOUT_PARENT"],
    "nodeBin": os.environ["NODE_BIN"],
    "corepackBin": os.environ["COREPACK_BIN"],
    "gitBin": os.environ["GIT_BIN"],
    "pythonBin": os.environ["PYTHON_BIN"],
    "dockerBin": os.environ["DOCKER_BIN"],
    "systemctlBin": os.environ["SYSTEMCTL_BIN"],
    "systemdAnalyzeBin": os.environ["SYSTEMD_ANALYZE_BIN"],
    "hostBootId": os.environ["HOST_BOOT_ID"],
    "legacyContainerName": os.environ["EXPECTED_LEGACY_CONTAINER_NAME"],
    "legacyContainerImage": os.environ["CONTAINER_IMAGE"],
    "legacyContainerState": os.environ["CONTAINER_STATE"],
    "minimumFreeKiB": int(os.environ["MIN_FREE_KB"]),
    "observedFreeKiB": int(os.environ["FREE_KB"]),
    "hostMonotonicSample": json.loads(os.environ["MONOTONIC_JSON"]),
}
print(json.dumps(payload, separators=(",", ":")))
PY
)"

printf '%s\n' "$FHV_JSON_PAYLOAD"
printf 'classification=FHV_T4_HOST_PREFLIGHT_OK\n'

if [[ -n "$OUTPUT" ]]; then
  require_abs "output" "$OUTPUT"
  printf 'error: --output proof write requires trader:fhv:t4:record-host-preflight after dependencies install\n' >&2
  exit 2
fi
