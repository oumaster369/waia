#!/usr/bin/env bash
# DEE-436 — capture completed waia-fhv-campaign.service systemd identity fields.
set -euo pipefail

UNIT="${1:-waia-fhv-campaign.service}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"

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

python3 - <<PY
import json
from hashlib import sha256

payload = {
    "schemaVersion": "fhv-t4-completed-campaign-systemd-identity/v1",
    "unitName": "${UNIT}",
    "bootId": "${BOOT_ID}",
    "activeState": "${ACTIVE_STATE}",
    "subState": "${SUB_STATE}",
    "result": "${RESULT}",
    "invocationId": "${INVOCATION_ID}",
    "execMainPid": int("${EXEC_MAIN_PID}" or "0"),
    "execMainStartTimestampMonotonic": "${EXEC_MAIN_START}",
    "execMainExitTimestampMonotonic": "${EXEC_MAIN_EXIT}",
    "execMainCode": int("${EXEC_MAIN_CODE}" or "0"),
    "execMainStatus": int("${EXEC_MAIN_STATUS}" or "0"),
    "nRestarts": int("${N_RESTARTS}" or "0"),
}
digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
payload["contentDigest"] = digest
print(json.dumps(payload, separators=(",", ":")))
PY
