#!/usr/bin/env bash
# DEE-436 — service-user fresh checkout wrapper (dependency-free).
set -euo pipefail

APPROVED_ORIGIN="https://github.com/oumaster369/waia.git"

usage() {
  cat >&2 <<'EOF'
Usage: fhv-service-user-checkout.sh \
  --service-user VALUE \
  --checkout-parent ABS_PATH \
  --checkout-dir NAME \
  --target-sha FULL_SHA \
  --release-tag TAG \
  --git-bin ABS_PATH \
  [--origin-url URL]

Creates a fresh detached checkout owned by the service user.
EOF
}

SERVICE_USER=""
CHECKOUT_PARENT=""
CHECKOUT_DIR=""
TARGET_SHA=""
RELEASE_TAG=""
GIT_BIN=""
ORIGIN_URL="$APPROVED_ORIGIN"

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

require_abs() {
  local label="$1"
  local value="$2"
  [[ -n "$value" ]] || fail "${label} is required"
  [[ "$value" = /* ]] || fail "${label} must be absolute"
  case "$value" in
    *".."*) fail "${label} must not contain .." ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --checkout-parent) CHECKOUT_PARENT="${2:-}"; shift 2 ;;
    --checkout-dir) CHECKOUT_DIR="${2:-}"; shift 2 ;;
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --release-tag) RELEASE_TAG="${2:-}"; shift 2 ;;
    --git-bin) GIT_BIN="${2:-}"; shift 2 ;;
    --origin-url) ORIGIN_URL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$SERVICE_USER" && -n "$CHECKOUT_PARENT" && -n "$CHECKOUT_DIR" && -n "$TARGET_SHA" && -n "$RELEASE_TAG" && -n "$GIT_BIN" ]] || usage
require_abs "checkout-parent" "$CHECKOUT_PARENT"
require_abs "git-bin" "$GIT_BIN"

if [[ "$(id -u)" -eq 0 ]]; then
  fail "must not run as root"
fi

TARGET_SHA="$(printf '%s' "$TARGET_SHA" | tr '[:upper:]' '[:lower:]')"
if ! [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  fail "target-sha must be 40-char hex"
fi

if [[ "$ORIGIN_URL" != "$APPROVED_ORIGIN" ]]; then
  fail "origin-url must be approved WAIA origin"
fi

case "$CHECKOUT_DIR" in
  */*|..*|*..*) fail "checkout-dir must be a single safe directory name" ;;
esac

CHECKOUT_PATH="${CHECKOUT_PARENT%/}/${CHECKOUT_DIR}"
[[ ! -e "$CHECKOUT_PATH" ]] || fail "checkout path already exists"

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  fail "service user does not exist"
fi
if [[ "$(id -u "$SERVICE_USER")" -eq 0 ]]; then
  fail "service user UID must be nonzero"
fi
[[ -d "$CHECKOUT_PARENT" ]] || fail "checkout parent missing"
if ! runuser -u "$SERVICE_USER" -- test -w "$CHECKOUT_PARENT"; then
  fail "checkout parent not writable by service user"
fi
[[ -x "$GIT_BIN" ]] || fail "git-bin not executable"

runuser -u "$SERVICE_USER" -- "$GIT_BIN" clone --depth 1 --branch "$RELEASE_TAG" "$ORIGIN_URL" "$CHECKOUT_PATH"
runuser -u "$SERVICE_USER" -- "$GIT_BIN" -C "$CHECKOUT_PATH" fetch --depth 1 origin "$TARGET_SHA"
runuser -u "$SERVICE_USER" -- "$GIT_BIN" -C "$CHECKOUT_PATH" checkout --detach "$TARGET_SHA"

HEAD_SHA="$(runuser -u "$SERVICE_USER" -- "$GIT_BIN" -C "$CHECKOUT_PATH" rev-parse HEAD | tr '[:upper:]' '[:lower:]')"
if [[ "$HEAD_SHA" != "$TARGET_SHA" ]]; then
  fail "HEAD after checkout != target sha"
fi

TAG_PEEL_SHA="$(runuser -u "$SERVICE_USER" -- "$GIT_BIN" -C "$CHECKOUT_PATH" rev-parse "${RELEASE_TAG}^{}" | tr '[:upper:]' '[:lower:]')"
if [[ "$TAG_PEEL_SHA" != "$TARGET_SHA" ]]; then
  fail "release tag peel != target sha"
fi

if [[ -n "$(runuser -u "$SERVICE_USER" -- "$GIT_BIN" -C "$CHECKOUT_PATH" status --porcelain=v1 -uno)" ]]; then
  fail "tracked tree not clean after checkout"
fi

ORIGIN_REMOTE="$(runuser -u "$SERVICE_USER" -- "$GIT_BIN" -C "$CHECKOUT_PATH" remote get-url origin)"
if [[ "$ORIGIN_REMOTE" != "$APPROVED_ORIGIN" ]]; then
  fail "origin remote mismatch"
fi

CHECKOUT_UID="$(stat -c '%u' "$CHECKOUT_PATH" 2>/dev/null || stat -f '%u' "$CHECKOUT_PATH")"
SERVICE_UID="$(id -u "$SERVICE_USER")"
if [[ "$CHECKOUT_UID" != "$SERVICE_UID" ]]; then
  fail "checkout not owned by service user"
fi

python3 - <<PY
import json
print(json.dumps({
    "schemaVersion": "fhv-t4-service-user-checkout/v1",
    "classification": "FHV_T4_SERVICE_USER_CHECKOUT_OK",
    "checkoutPath": """$CHECKOUT_PATH""",
    "releaseSha": """$TARGET_SHA""",
    "releaseTag": """$RELEASE_TAG""",
    "originUrl": """$APPROVED_ORIGIN""",
    "serviceUid": $SERVICE_UID,
}, separators=(",", ":")))
PY
printf 'classification=FHV_T4_SERVICE_USER_CHECKOUT_OK\n'
