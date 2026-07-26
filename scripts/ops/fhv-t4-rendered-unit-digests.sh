#!/usr/bin/env bash
# DEE-436 — compute rendered unit digests JSON for fhv-systemd-record-deploy.sh.
set -euo pipefail

RENDERED_DIR=""
usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-rendered-unit-digests.sh --rendered-dir DIR

Prints JSON object: {"waia-fhv-campaign.service":"<sha256>","waia-fhv-observer.service":"<sha256>"}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rendered-dir) RENDERED_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ -n "$RENDERED_DIR" ]] || { usage; exit 2; }

CAMPAIGN="waia-fhv-campaign.service"
OBSERVER="waia-fhv-observer.service"
for unit in "$CAMPAIGN" "$OBSERVER"; do
  [[ -f "${RENDERED_DIR}/${unit}" ]] || { printf 'error: missing rendered unit %s\n' "$unit" >&2; exit 2; }
done

python3 - <<PY
import hashlib, json, pathlib
rendered = pathlib.Path("${RENDERED_DIR}")
units = ["${CAMPAIGN}", "${OBSERVER}"]
out = {}
for unit in units:
    data = (rendered / unit).read_bytes()
    out[unit] = hashlib.sha256(data).hexdigest()
print(json.dumps(out, separators=(",", ":")))
PY
