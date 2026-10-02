#!/bin/bash
# Цикл 24/7. По умолчанию бумага и счёт small. Реальные ордера — только AUTOEXEC_LIVE=1.
cd "$(dirname "$0")"
export PYTHONPATH="$(pwd)${PYTHONPATH:+:$PYTHONPATH}"
ROOT="${AUTOEXEC_ROOT:-/workspace/committee/exec}"
mkdir -p "$ROOT/state"
ARGS=(--root "$ROOT" --account "${AUTOEXEC_ACCOUNT:-small}")
if [[ -n "${AUTOEXEC_CONFIG:-}" ]]; then
  ARGS+=(--config "$AUTOEXEC_CONFIG")
fi
if [[ "${AUTOEXEC_LIVE:-0}" == "1" ]]; then
  ARGS+=(--live)
else
  ARGS+=(--dry-run)
fi
if [[ -n "${AUTOEXEC_DECISION:-}" ]]; then
  ARGS+=(--decision "$AUTOEXEC_DECISION")
fi
while true; do
  python3 -m autoexec "${ARGS[@]}" run --once >> "$ROOT/state/autoexec.log" 2>&1 || true
  sleep "${AUTOEXEC_INTERVAL:-30}"
done
