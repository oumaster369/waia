#!/usr/bin/env bash
# DEE-436 — Linux host monotonic clock sample (CLOCK_BOOTTIME + boot_id).
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  printf '{"error":"FHV_T4_HOST_MONOTONIC_LINUX_ONLY"}\n' >&2
  exit 2
fi

python3 - <<'PY'
import json
import pathlib
import time

boot_id = pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()
monotonic_ns = time.clock_gettime_ns(time.CLOCK_BOOTTIME)
print(json.dumps({
    "schemaVersion": "fhv-t4-host-monotonic-sample/v1",
    "clockSource": "CLOCK_BOOTTIME",
    "bootId": boot_id,
    "monotonicNs": str(monotonic_ns),
}, separators=(",", ":")))
PY
