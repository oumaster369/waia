#!/usr/bin/env bash
# DEE-436 — capture waia-fhv-observer.service systemd identity fields.
set -euo pipefail

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

SYSTEMCTL=""
PYTHON_BIN=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --systemctl-bin) SYSTEMCTL="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    -*) fail "unknown flag: $1" ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]}"

UNIT="${1:-waia-fhv-observer.service}"

[[ -n "$SYSTEMCTL" && -x "$SYSTEMCTL" ]] || fail "--systemctl-bin required"
[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || fail "--python-bin required"

if [[ "$(uname -s)" != "Linux" ]]; then
  printf '{"error":"FHV_T4_OBSERVER_IDENTITY_LINUX_ONLY"}\n' >&2
  exit 2
fi

BOOT_ID="$(tr -d '\n' < /proc/sys/kernel/random/boot_id)"
INVOCATION_ID="$("$SYSTEMCTL" show "$UNIT" -p InvocationID --value 2>/dev/null || true)"
MAIN_PID="$("$SYSTEMCTL" show "$UNIT" -p MainPID --value 2>/dev/null || true)"
ACTIVE_STATE="$("$SYSTEMCTL" show "$UNIT" -p ActiveState --value 2>/dev/null || true)"
ACTIVE_ENTER="$("$SYSTEMCTL" show "$UNIT" -p ActiveEnterTimestampMonotonic --value 2>/dev/null || true)"

"$PYTHON_BIN" - <<PY
import json
print(json.dumps({
    "schemaVersion": "fhv-t4-observer-systemd-identity/v1",
    "unitName": "${UNIT}",
    "bootId": "${BOOT_ID}",
    "invocationId": "${INVOCATION_ID}",
    "mainPid": int("${MAIN_PID}" or "0"),
    "activeEnterTimestampMonotonicUs": "${ACTIVE_ENTER}",
    "activeState": "${ACTIVE_STATE}",
}, separators=(",", ":")))
PY
