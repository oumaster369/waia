#!/usr/bin/env bash
# DEE-436 — capture completed waia-fhv-campaign.service systemd identity fields.
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

UNIT="${1:-waia-fhv-campaign.service}"

[[ -n "$SYSTEMCTL" && -x "$SYSTEMCTL" ]] || fail "--systemctl-bin required"
[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || fail "--python-bin required"

if [[ "$(uname -s)" != "Linux" ]]; then
  printf '{"error":"FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_LINUX_ONLY"}\n' >&2
  exit 2
fi

BOOT_ID="$(tr -d '\n' < /proc/sys/kernel/random/boot_id)"
INVOCATION_ID="$("$SYSTEMCTL" show "$UNIT" -p InvocationID --value 2>/dev/null || true)"
ACTIVE_STATE="$("$SYSTEMCTL" show "$UNIT" -p ActiveState --value 2>/dev/null || true)"
SUB_STATE="$("$SYSTEMCTL" show "$UNIT" -p SubState --value 2>/dev/null || true)"
RESULT="$("$SYSTEMCTL" show "$UNIT" -p Result --value 2>/dev/null || true)"
EXEC_MAIN_PID="$("$SYSTEMCTL" show "$UNIT" -p ExecMainPID --value 2>/dev/null || true)"
EXEC_MAIN_START="$("$SYSTEMCTL" show "$UNIT" -p ExecMainStartTimestampMonotonic --value 2>/dev/null || true)"
EXEC_MAIN_EXIT="$("$SYSTEMCTL" show "$UNIT" -p ExecMainExitTimestampMonotonic --value 2>/dev/null || true)"
EXEC_MAIN_CODE="$("$SYSTEMCTL" show "$UNIT" -p ExecMainCode --value 2>/dev/null || true)"
EXEC_MAIN_STATUS="$("$SYSTEMCTL" show "$UNIT" -p ExecMainStatus --value 2>/dev/null || true)"
N_RESTARTS="$("$SYSTEMCTL" show "$UNIT" -p NRestarts --value 2>/dev/null || true)"

export FHV_JSON_PAYLOAD
FHV_JSON_PAYLOAD="$(
  UNIT="$UNIT" BOOT_ID="$BOOT_ID" INVOCATION_ID="$INVOCATION_ID" ACTIVE_STATE="$ACTIVE_STATE" SUB_STATE="$SUB_STATE" RESULT="$RESULT" \
  EXEC_MAIN_PID="$EXEC_MAIN_PID" EXEC_MAIN_START="$EXEC_MAIN_START" EXEC_MAIN_EXIT="$EXEC_MAIN_EXIT" \
  EXEC_MAIN_CODE="$EXEC_MAIN_CODE" EXEC_MAIN_STATUS="$EXEC_MAIN_STATUS" N_RESTARTS="$N_RESTARTS" \
  "$PYTHON_BIN" - <<'PY'
import json, os
from hashlib import sha256
payload = {
    "schemaVersion": "fhv-t4-completed-campaign-systemd-identity/v1",
    "unitName": os.environ["UNIT"],
    "bootId": os.environ["BOOT_ID"],
    "activeState": os.environ["ACTIVE_STATE"],
    "subState": os.environ["SUB_STATE"],
    "result": os.environ["RESULT"],
    "invocationId": os.environ["INVOCATION_ID"],
    "execMainPid": int(os.environ["EXEC_MAIN_PID"] or "0"),
    "execMainStartTimestampMonotonic": os.environ["EXEC_MAIN_START"],
    "execMainExitTimestampMonotonic": os.environ["EXEC_MAIN_EXIT"],
    "execMainCode": int(os.environ["EXEC_MAIN_CODE"] or "0"),
    "execMainStatus": int(os.environ["EXEC_MAIN_STATUS"] or "0"),
    "nRestarts": int(os.environ["N_RESTARTS"] or "0"),
}
# Digest must match Node computePayloadDigest(JSON.stringify) — insertion order, no sort_keys.
digest = sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()
payload["contentDigest"] = digest
print(json.dumps(payload, separators=(",", ":")))
PY
)"
printf '%s\n' "$FHV_JSON_PAYLOAD"
