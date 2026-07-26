#!/usr/bin/env bash
# DEE-436 — bounded wait until waia-fhv-observer.service is active.
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
TIMEOUT_MS="${2:-60000}"

[[ -n "$SYSTEMCTL" && -x "$SYSTEMCTL" ]] || fail "--systemctl-bin required"
[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || fail "--python-bin required"

if [[ "$(uname -s)" != "Linux" ]]; then
  printf '{"error":"FHV_T4_OBSERVER_WAIT_LINUX_ONLY"}\n' >&2
  exit 2
fi

deadline=$(( $(date +%s%3N) + TIMEOUT_MS ))
while true; do
  state="$("$SYSTEMCTL" is-active "$UNIT" 2>/dev/null || true)"
  if [[ "$state" == "active" ]]; then
    "$PYTHON_BIN" - <<PY
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
