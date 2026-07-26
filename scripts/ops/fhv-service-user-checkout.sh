#!/usr/bin/env bash
# DEE-436 — service-user fresh checkout wrapper (dependency-free; root caller).
set -euo pipefail

fhv_t4_require_effective_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    printf 'error: caller must have effective UID 0\n' >&2
    exit 2
  fi
}

fhv_t4_resolve_service_user_identity() {
  local service_user="$1"
  if ! id -u "$service_user" >/dev/null 2>&1; then
    printf 'error: service user does not exist: %s\n' "$service_user" >&2
    exit 2
  fi
  FHV_SERVICE_UID="$(id -u "$service_user")"
  FHV_SERVICE_GID="$(id -g "$service_user")"
  FHV_SERVICE_GROUP="$(id -gn "$service_user")"
  if [[ "$FHV_SERVICE_UID" -eq 0 ]]; then
    printf 'error: service user UID must be nonzero\n' >&2
    exit 2
  fi
}

fhv_t4_emit_json() {
  local python_bin="$1"
  shift
  "$python_bin" -c 'import json, os, sys; print(json.dumps(json.loads(os.environ["FHV_JSON_PAYLOAD"]), separators=(",", ":")))'
}

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
  --python-bin ABS_PATH \
  [--origin-url URL]

Root-only wrapper: delegates clone/checkout to the non-root FHV service user.
EOF
}

SERVICE_USER=""
CHECKOUT_PARENT=""
CHECKOUT_DIR=""
TARGET_SHA=""
RELEASE_TAG=""
GIT_BIN=""
PYTHON_BIN=""
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
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    --origin-url) ORIGIN_URL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$SERVICE_USER" && -n "$CHECKOUT_PARENT" && -n "$CHECKOUT_DIR" && -n "$TARGET_SHA" && -n "$RELEASE_TAG" && -n "$GIT_BIN" && -n "$PYTHON_BIN" ]] || usage
require_abs "checkout-parent" "$CHECKOUT_PARENT"
require_abs "git-bin" "$GIT_BIN"
require_abs "python-bin" "$PYTHON_BIN"

fhv_t4_require_effective_root
fhv_t4_resolve_service_user_identity "$SERVICE_USER"

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

[[ -d "$CHECKOUT_PARENT" ]] || fail "checkout parent missing"
if ! runuser -u "$SERVICE_USER" -- test -w "$CHECKOUT_PARENT"; then
  fail "checkout parent not writable by service user"
fi
[[ -x "$GIT_BIN" ]] || fail "git-bin not executable"
[[ -x "$PYTHON_BIN" ]] || fail "python-bin not executable"

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
if [[ "$CHECKOUT_UID" != "$FHV_SERVICE_UID" ]]; then
  fail "checkout not owned by service user"
fi

export FHV_JSON_PAYLOAD
FHV_JSON_PAYLOAD="$(
  CHECKOUT_PATH="$CHECKOUT_PATH" TARGET_SHA="$TARGET_SHA" RELEASE_TAG="$RELEASE_TAG" \
    FHV_SERVICE_UID="$FHV_SERVICE_UID" FHV_SERVICE_GID="$FHV_SERVICE_GID" FHV_SERVICE_GROUP="$FHV_SERVICE_GROUP" \
    "$PYTHON_BIN" - <<'PY'
import json, os
print(json.dumps({
    "schemaVersion": "fhv-t4-service-user-checkout/v1",
    "classification": "FHV_T4_SERVICE_USER_CHECKOUT_OK",
    "checkoutPath": os.environ["CHECKOUT_PATH"],
    "releaseSha": os.environ["TARGET_SHA"],
    "releaseTag": os.environ["RELEASE_TAG"],
    "originUrl": "https://github.com/oumaster369/waia.git",
    "serviceUid": int(os.environ["FHV_SERVICE_UID"]),
    "serviceGid": int(os.environ["FHV_SERVICE_GID"]),
    "servicePrimaryGroup": os.environ["FHV_SERVICE_GROUP"],
}, separators=(",", ":")))
PY
)"
printf '%s\n' "$FHV_JSON_PAYLOAD"
printf 'classification=FHV_T4_SERVICE_USER_CHECKOUT_OK\n'
