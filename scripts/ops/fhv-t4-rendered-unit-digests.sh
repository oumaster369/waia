#!/usr/bin/env bash
# DEE-436 — compute rendered unit digests JSON for fhv-systemd-record-deploy.sh.
set -euo pipefail

RENDERED_DIR=""
PYTHON_BIN=""
CAMPAIGN="waia-fhv-campaign.service"
OBSERVER="waia-fhv-observer.service"

usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-rendered-unit-digests.sh --rendered-dir DIR --python-bin PATH

Prints JSON object: {"waia-fhv-campaign.service":"<sha256>","waia-fhv-observer.service":"<sha256>"}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rendered-dir) RENDERED_DIR="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ -n "$RENDERED_DIR" ]] || { usage; exit 2; }
[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || {
  printf 'error: --python-bin required and must be executable\n' >&2
  exit 2
}

for unit in "$CAMPAIGN" "$OBSERVER"; do
  [[ -f "${RENDERED_DIR}/${unit}" ]] || { printf 'error: missing rendered unit %s\n' "$unit" >&2; exit 2; }
done

export RENDERED_DIR CAMPAIGN OBSERVER
"$PYTHON_BIN" - <<'PY'
import hashlib, json, os, pathlib
rendered = pathlib.Path(os.environ["RENDERED_DIR"])
units = [os.environ["CAMPAIGN"], os.environ["OBSERVER"]]
out = {}
for unit in units:
    data = (rendered / unit).read_bytes()
    out[unit] = hashlib.sha256(data).hexdigest()
print(json.dumps(out, separators=(",", ":")))
PY
