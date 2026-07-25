#!/usr/bin/env bash
# DEE-436 — identity-aware bounded wait for completed inactive/success campaign unit.
set -euo pipefail

UNIT="${1:-waia-fhv-campaign.service}"
TIMEOUT_MS="${2:-120000}"
RUN_ROOT="${3:-}"
EXPECTED_TERMINAL="${4:-REHEARSAL_OK}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

[[ -n "$RUN_ROOT" ]] || fail "run-root required"
[[ "$RUN_ROOT" = /* ]] || fail "run-root must be absolute"

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "linux only"
fi

normalize_boot_id() {
  local raw="$1"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '\n')"
  if [[ "$raw" =~ ^[0-9a-f]{32}$ ]]; then
    printf '%s-%s-%s-%s-%s' \
      "${raw:0:8}" "${raw:8:4}" "${raw:12:4}" "${raw:16:4}" "${raw:20:12}"
    return 0
  fi
  printf '%s' "$raw"
}

START_BOOT_ID="$(normalize_boot_id "$(tr -d '\n' < /proc/sys/kernel/random/boot_id)")"
PYTHON_BIN="${PYTHON_BIN:-python3}"
EXPECTED_INVOCATION=""
EXPECTED_N_RESTARTS=""
RESUME_PROOF="${RUN_ROOT}/control/fhv-t4-resume-enforcement-proof.v1.json"
if [[ -f "$RESUME_PROOF" ]]; then
  EXPECTED_INVOCATION="$(
    "$PYTHON_BIN" -c 'import json,sys; print(json.load(open(sys.argv[1]))["newInvocationId"])' "$RESUME_PROOF" 2>/dev/null || true
  )"
  EXPECTED_N_RESTARTS="$(
    "$PYTHON_BIN" -c 'import json,sys; print(json.load(open(sys.argv[1]))["nRestarts"])' "$RESUME_PROOF" 2>/dev/null || true
  )"
fi

deadline=$(( $(date +%s%3N) + TIMEOUT_MS ))

read_unit_field() {
  local field="$1"
  "$SYSTEMCTL" show "$UNIT" -p "$field" --value 2>/dev/null || true
}

while true; do
  CURRENT_BOOT_ID="$(normalize_boot_id "$(tr -d '\n' < /proc/sys/kernel/random/boot_id)")"
  if [[ "$CURRENT_BOOT_ID" != "$START_BOOT_ID" ]]; then
    fail "host reboot detected during campaign wait"
  fi

  ACTIVE_STATE="$(read_unit_field ActiveState)"
  SUB_STATE="$(read_unit_field SubState)"
  RESULT="$(read_unit_field Result)"
  INVOCATION_ID="$(read_unit_field InvocationID)"
  EXEC_MAIN_PID="$(read_unit_field ExecMainPID)"
  N_RESTARTS="$(read_unit_field NRestarts)"
  TERMINAL_FILE="${RUN_ROOT}/fhv-rehearsal-terminal.v1.json"
  TERMINAL_CLASS=""
  if [[ -f "$TERMINAL_FILE" ]]; then
    TERMINAL_CLASS="$(grep -o '"classification"[[:space:]]*:[[:space:]]*"[^"]*"' "$TERMINAL_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
  fi

  if [[ -n "$EXPECTED_INVOCATION" && -n "$INVOCATION_ID" && "$INVOCATION_ID" != "$EXPECTED_INVOCATION" ]]; then
    if [[ "$ACTIVE_STATE" == "active" || "$ACTIVE_STATE" == "activating" || "$ACTIVE_STATE" == "deactivating" ]]; then
      fail "campaign invocation changed during wait"
    fi
  fi

  if [[ -n "$EXPECTED_N_RESTARTS" && -n "$N_RESTARTS" && "$N_RESTARTS" -gt "$EXPECTED_N_RESTARTS" ]]; then
    fail "campaign restart count increased during wait"
  fi

  if [[ "$ACTIVE_STATE" == "active" || "$ACTIVE_STATE" == "activating" || "$ACTIVE_STATE" == "deactivating" ]]; then
    if [[ -n "$EXPECTED_INVOCATION" && -n "$INVOCATION_ID" && "$INVOCATION_ID" == "$EXPECTED_INVOCATION" ]]; then
      : # same invocation unwinding — continue polling
    elif [[ -z "$EXPECTED_INVOCATION" ]]; then
      fail "campaign became active under a new invocation"
    fi
  fi

  if [[ "$ACTIVE_STATE" == "inactive" && "$RESULT" == "success" && "$TERMINAL_CLASS" == "$EXPECTED_TERMINAL" ]]; then
    if [[ -f "${RUN_ROOT}/fhv-t4-campaign-runtime.v1.json" ]]; then
      if [[ -n "$EXPECTED_INVOCATION" && -n "$INVOCATION_ID" && "$INVOCATION_ID" != "$EXPECTED_INVOCATION" ]]; then
        fail "completed invocation mismatch"
      fi
      bash "${SCRIPT_DIR}/fhv-t4-campaign-systemd-identity-read.sh" "$UNIT" >/dev/null
      printf 'classification=FHV_T4_CAMPAIGN_COMPLETED_WAIT_OK\n'
      exit 0
    fi
  fi

  if [[ "$RESULT" == "exit-code" || "$RESULT" == "failed" ]]; then
    fail "campaign unit failed"
  fi

  now=$(date +%s%3N)
  if (( now >= deadline )); then
    fail "timed out waiting for completed campaign unit"
  fi
  sleep 1
done
