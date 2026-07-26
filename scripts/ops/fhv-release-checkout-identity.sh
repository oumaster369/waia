#!/usr/bin/env bash
# DEE-436 — dependency-free Git checkout / release-tag identity verifier.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: fhv-release-checkout-identity.sh \
  --repo-path PATH \
  --target-sha FULL_SHA \
  --release-tag TAG \
  --git-bin ABS_PATH \
  --python-bin ABS_PATH \
  [--expected-origin URL] \
  [--output PATH]

Read-only unless --output is supplied (POST_AUTHORIZED immutable proof only).
EOF
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

require_abs_safe_path() {
  local label="$1"
  local value="$2"
  [[ -n "$value" ]] || fail "${label} is required"
  [[ "$value" = /* ]] || fail "${label} must be absolute"
  case "$value" in
    *".."*) fail "${label} must not contain .." ;;
    *$'\n'*|*$'\r'*|*$'\t'*) fail "${label} must not contain control characters" ;;
    *'"'*) fail "${label} must not contain double quotes" ;;
  esac
  if printf '%s' "$value" | LC_ALL=C grep -q '[[:cntrl:]]'; then
    fail "${label} must not contain control characters"
  fi
}

REPO_PATH=""
TARGET_SHA=""
RELEASE_TAG=""
GIT_BIN=""
PYTHON_BIN=""
EXPECTED_ORIGIN="https://github.com/oumaster369/waia.git"
OUTPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-path) REPO_PATH="${2:-}"; shift 2 ;;
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --release-tag) RELEASE_TAG="${2:-}"; shift 2 ;;
    --git-bin) GIT_BIN="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    --expected-origin) EXPECTED_ORIGIN="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$REPO_PATH" && -n "$TARGET_SHA" && -n "$RELEASE_TAG" && -n "$GIT_BIN" && -n "$PYTHON_BIN" ]] || { usage; exit 2; }
require_abs_safe_path "repo-path" "$REPO_PATH"
require_abs_safe_path "git-bin" "$GIT_BIN"
[[ -x "$GIT_BIN" ]] || fail "git-bin not executable"
[[ -x "$PYTHON_BIN" ]] || fail "python-bin not executable"

TARGET_SHA="$(printf '%s' "$TARGET_SHA" | tr '[:upper:]' '[:lower:]')"
if ! [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  fail "target-sha must be 40-char hex"
fi

if [[ "$EXPECTED_ORIGIN" != "https://github.com/oumaster369/waia.git" ]]; then
  fail "expected-origin must be approved WAIA origin"
fi

# Command-scoped safe.directory for root verification of service-user-owned repos.
# No persistent system/global/user Git configuration is modified.
repo_git() {
  "$GIT_BIN" -c "safe.directory=${REPO_PATH}" -C "$REPO_PATH" "$@"
}

worktree_out=""
worktree_err=""
if ! worktree_out="$(repo_git rev-parse --is-inside-work-tree 2>&1)"; then
  if [[ -n "$worktree_out" ]]; then
    worktree_err="$worktree_out"
  else
    worktree_err="git rev-parse --is-inside-work-tree failed"
  fi
  printf 'error: git worktree check failed for %s: %s\n' "$REPO_PATH" "$worktree_err" >&2
  exit 2
fi
if [[ "$worktree_out" != "true" ]]; then
  printf 'error: not inside git worktree: %s (rev-parse returned: %s)\n' "$REPO_PATH" "$worktree_out" >&2
  exit 2
fi

if ! repo_git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  fail "target-sha does not resolve"
fi

HEAD_SHA="$(repo_git rev-parse HEAD | tr '[:upper:]' '[:lower:]')"
if [[ "$HEAD_SHA" != "$TARGET_SHA" ]]; then
  printf 'error: HEAD %s != target %s\n' "$HEAD_SHA" "$TARGET_SHA" >&2
  exit 2
fi

if ! repo_git rev-parse --verify "refs/tags/${RELEASE_TAG}" >/dev/null 2>&1; then
  printf 'error: release tag missing locally: %s\n' "$RELEASE_TAG" >&2
  exit 2
fi

TAG_PEEL_SHA="$(repo_git rev-parse "${RELEASE_TAG}^{}" | tr '[:upper:]' '[:lower:]')"
if [[ "$TAG_PEEL_SHA" != "$TARGET_SHA" ]]; then
  printf 'error: tag peel %s != target %s\n' "$TAG_PEEL_SHA" "$TARGET_SHA" >&2
  exit 2
fi

if [[ -n "$(repo_git status --porcelain=v1 -uno)" ]]; then
  fail "tracked tree is not clean"
fi

if [[ -n "$(repo_git diff --cached --name-only)" ]]; then
  fail "staged changes present"
fi

if [[ -f "$REPO_PATH/.git/MERGE_HEAD" || -d "$REPO_PATH/.git/rebase-merge" || -d "$REPO_PATH/.git/rebase-apply" ]]; then
  fail "merge/rebase in progress"
fi

ORIGIN_URL="$(repo_git remote get-url origin 2>/dev/null || true)"
if [[ "$ORIGIN_URL" != "$EXPECTED_ORIGIN" ]]; then
  printf 'error: origin %s != expected %s\n' "${ORIGIN_URL:-<missing>}" "$EXPECTED_ORIGIN" >&2
  exit 2
fi

export FHV_JSON_PAYLOAD
FHV_JSON_PAYLOAD="$(
  REPO_PATH="$REPO_PATH" TARGET_SHA="$TARGET_SHA" RELEASE_TAG="$RELEASE_TAG" ORIGIN_URL="$ORIGIN_URL" HEAD_SHA="$HEAD_SHA" TAG_PEEL_SHA="$TAG_PEEL_SHA" \
    "$PYTHON_BIN" - <<'PY'
import json, os
print(json.dumps({
    "schemaVersion": "fhv-t4-checkout-identity-sample/v1",
    "repoPath": os.environ["REPO_PATH"],
    "releaseSha": os.environ["TARGET_SHA"],
    "releaseTag": os.environ["RELEASE_TAG"],
    "headSha": os.environ["HEAD_SHA"],
    "tagPeelSha": os.environ["TAG_PEEL_SHA"],
    "originUrl": os.environ["ORIGIN_URL"],
    "trackedTreeClean": True,
    "stagedChanges": False,
    "mergeInProgress": False,
    "classification": "FHV_T4_CHECKOUT_IDENTITY_OK",
}, separators=(",", ":")))
PY
)"

printf '%s\n' "$FHV_JSON_PAYLOAD"
printf 'classification=FHV_T4_CHECKOUT_IDENTITY_OK\n'

if [[ -n "$OUTPUT" ]]; then
  fail "--output proof write requires trader:fhv:t4:record-checkout-identity after dependencies install"
fi
