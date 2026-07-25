#!/usr/bin/env bash
# DEE-436 — bounded wait for completed inactive/success campaign unit.
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

BOOT_ID="$(tr -d '\n' < /proc/sys/kernel/random/boot_id)"
START_BOOT_ID="$BOOT_ID"
deadline=$(( $(date +%s%3N) + TIMEOUT_MS ))

while true; do
  CURRENT_BOOT_ID="$(tr -d '\n' < /proc/sys/kernel/random/boot_id)"
  if [[ "$CURRENT_BOOT_ID" != "$START_BOOT_ID" ]]; then
    fail "host reboot detected during campaign wait"
  fi

  ACTIVE_STATE="$("$SYSTEMCTL" show "$UNIT" -p ActiveState --value 2>/dev/null || true)"
  RESULT="$("$SYSTEMCTL" show "$UNIT" -p Result --value 2>/dev/null || true)"
  TERMINAL_FILE="${RUN_ROOT}/fhv-rehearsal-terminal.v1.json"
  TERMINAL_CLASS=""
  if [[ -f "$TERMINAL_FILE" ]]; then
    TERMINAL_CLASS="$(grep -o '"classification"[[:space:]]*:[[:space:]]*"[^"]*"' "$TERMINAL_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
  fi

  if [[ "$ACTIVE_STATE" == "active" ]]; then
    fail "campaign became active under a new invocation"
  fi

  if [[ "$ACTIVE_STATE" == "inactive" && "$RESULT" == "success" && "$TERMINAL_CLASS" == "$EXPECTED_TERMINAL" ]]; then
    if [[ -f "${RUN_ROOT}/fhv-t4-campaign-runtime.v1.json" ]]; then
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
