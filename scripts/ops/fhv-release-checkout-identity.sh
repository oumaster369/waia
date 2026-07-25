#!/usr/bin/env bash
# DEE-436 — dependency-free Git checkout / release-tag identity verifier.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: fhv-release-checkout-identity.sh \
  --repo-path PATH \
  --target-sha FULL_SHA \
  --release-tag TAG \
  [--expected-origin URL] \
  [--output PATH]

Read-only unless --output is supplied (POST_AUTHORIZED immutable proof only).
EOF
}

REPO_PATH=""
TARGET_SHA=""
RELEASE_TAG=""
EXPECTED_ORIGIN="https://github.com/oumaster369/waia.git"
OUTPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-path) REPO_PATH="${2:-}"; shift 2 ;;
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --release-tag) RELEASE_TAG="${2:-}"; shift 2 ;;
    --expected-origin) EXPECTED_ORIGIN="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ -n "$REPO_PATH" && -n "$TARGET_SHA" && -n "$RELEASE_TAG" ]] || { usage; exit 2; }

TARGET_SHA="$(printf '%s' "$TARGET_SHA" | tr '[:upper:]' '[:lower:]')"
if ! [[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'error: target-sha must be 40-char hex\n' >&2
  exit 2
fi

if [[ "$EXPECTED_ORIGIN" != "https://github.com/oumaster369/waia.git" ]]; then
  printf 'error: expected-origin must be approved WAIA origin\n' >&2
  exit 2
fi

if ! git -C "$REPO_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'error: not a git worktree: %s\n' "$REPO_PATH" >&2
  exit 2
fi

if ! git -C "$REPO_PATH" cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  printf 'error: target-sha does not resolve\n' >&2
  exit 2
fi

HEAD_SHA="$(git -C "$REPO_PATH" rev-parse HEAD | tr '[:upper:]' '[:lower:]')"
if [[ "$HEAD_SHA" != "$TARGET_SHA" ]]; then
  printf 'error: HEAD %s != target %s\n' "$HEAD_SHA" "$TARGET_SHA" >&2
  exit 2
fi

if ! git -C "$REPO_PATH" rev-parse --verify "refs/tags/${RELEASE_TAG}" >/dev/null 2>&1; then
  printf 'error: release tag missing locally: %s\n' "$RELEASE_TAG" >&2
  exit 2
fi

TAG_PEEL_SHA="$(git -C "$REPO_PATH" rev-parse "${RELEASE_TAG}^{}" | tr '[:upper:]' '[:lower:]')"
if [[ "$TAG_PEEL_SHA" != "$TARGET_SHA" ]]; then
  printf 'error: tag peel %s != target %s\n' "$TAG_PEEL_SHA" "$TARGET_SHA" >&2
  exit 2
fi

if [[ -n "$(git -C "$REPO_PATH" status --porcelain=v1 -uno)" ]]; then
  printf 'error: tracked tree is not clean\n' >&2
  exit 2
fi

if [[ -n "$(git -C "$REPO_PATH" diff --cached --name-only)" ]]; then
  printf 'error: staged changes present\n' >&2
  exit 2
fi

if [[ -f "$REPO_PATH/.git/MERGE_HEAD" || -d "$REPO_PATH/.git/rebase-merge" || -d "$REPO_PATH/.git/rebase-apply" ]]; then
  printf 'error: merge/rebase in progress\n' >&2
  exit 2
fi

ORIGIN_URL="$(git -C "$REPO_PATH" remote get-url origin 2>/dev/null || true)"
if [[ "$ORIGIN_URL" != "$EXPECTED_ORIGIN" ]]; then
  printf 'error: origin %s != expected %s\n' "${ORIGIN_URL:-<missing>}" "$EXPECTED_ORIGIN" >&2
  exit 2
fi

JSON="$(python3 - <<PY
import json
print(json.dumps({
    "schemaVersion": "fhv-t4-checkout-identity-sample/v1",
    "repoPath": """$REPO_PATH""",
    "releaseSha": """$TARGET_SHA""",
    "releaseTag": """$RELEASE_TAG""",
    "headSha": """$HEAD_SHA""",
    "tagPeelSha": """$TAG_PEEL_SHA""",
    "originUrl": """$ORIGIN_URL""",
    "trackedTreeClean": True,
    "stagedChanges": False,
    "mergeInProgress": False,
    "classification": "FHV_T4_CHECKOUT_IDENTITY_OK",
}, separators=(",", ":")))
PY
)"

printf '%s\n' "$JSON"
printf 'classification=FHV_T4_CHECKOUT_IDENTITY_OK\n'

if [[ -n "$OUTPUT" ]]; then
  printf 'error: --output proof write requires trader:fhv:t4:record-checkout-identity after dependencies install\n' >&2
  exit 2
fi
