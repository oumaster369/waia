#!/usr/bin/env bash
# DEE-436 — bounded wait until waia-fhv-observer.service is active.
set -euo pipefail

UNIT="${1:-waia-fhv-observer.service}"
TIMEOUT_MS="${2:-60000}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"

if [[ "$(uname -s)" != "Linux" ]]; then
  printf '{"error":"FHV_T4_OBSERVER_WAIT_LINUX_ONLY"}\n' >&2
  exit 2
fi

deadline=$(( $(date +%s%3N) + TIMEOUT_MS ))
while true; do
  state="$("$SYSTEMCTL" is-active "$UNIT" 2>/dev/null || true)"
  if [[ "$state" == "active" ]]; then
    python3 - <<PY
import json
print(json.dumps({
    "schemaVersion": "fhv-t4-observer-wait-active/v1",
    "classification": "FHV_T4_OBSERVER_ACTIVE",
    "unitName": "${UNIT}",
    "activeState": "active",
}, separators=(",", ":")))
PY
    printf 'classification=FHV_T4_OBSERVER_ACTIVE\n'
    exit 0
  fi
  now=$(date +%s%3N)
  if (( now >= deadline )); then
    printf 'error: observer not active within %sms\n' "$TIMEOUT_MS" >&2
    exit 2
  fi
  sleep 1
done
