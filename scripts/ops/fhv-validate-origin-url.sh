#!/usr/bin/env bash
# DEE-436 — exact approved WAIA Git origin validator (dependency-free).
set -euo pipefail

APPROVED_ORIGIN="https://github.com/oumaster369/waia.git"

usage() {
  cat >&2 <<'EOF'
Usage: fhv-validate-origin-url.sh --origin-url URL

Accepts only the exact approved origin:
  https://github.com/oumaster369/waia.git

Rejects credentials, query strings, fragments, SSH, git://, and file paths.
EOF
}

ORIGIN_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --origin-url) ORIGIN_URL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ -n "$ORIGIN_URL" ]] || { usage; exit 2; }

# Reject control characters and whitespace.
case "$ORIGIN_URL" in
  *[![:print:]]*|*" "*|*"	"*) printf 'error: origin contains control characters or whitespace\n' >&2; exit 2 ;;
esac

# Reject embedded credentials (userinfo before @).
case "$ORIGIN_URL" in
  *://*@*) printf 'error: origin must not contain URL userinfo\n' >&2; exit 2 ;;
  *@*) printf 'error: origin must not contain @\n' >&2; exit 2 ;;
esac

# Reject query/fragment and non-https schemes.
case "$ORIGIN_URL" in
  *"?"*|*"#"*) printf 'error: origin must not contain query or fragment\n' >&2; exit 2 ;;
  git@*|ssh://*|git://*|file://*|ftp://*) printf 'error: origin scheme/host not approved\n' >&2; exit 2 ;;
esac

if [[ "$ORIGIN_URL" != "$APPROVED_ORIGIN" ]]; then
  printf 'error: origin must be exactly %s\n' "$APPROVED_ORIGIN" >&2
  exit 2
fi

python3 - <<'PY'
import json
print(json.dumps({
    "schemaVersion": "fhv-t4-origin-url-validation/v1",
    "approvedOrigin": "https://github.com/oumaster369/waia.git",
    "classification": "FHV_T4_ORIGIN_URL_OK",
}, separators=(",", ":")))
PY
printf 'classification=FHV_T4_ORIGIN_URL_OK\n'
