#!/usr/bin/env bash
# Regression tests for release workflow identity prevention (DEE-417).
# Usage: ./scripts/github/test-release-workflow-identity.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/release.yml"
NOTES_SCRIPT="${ROOT}/scripts/github/generate-release-notes.sh"
chmod +x "$NOTES_SCRIPT"

fail=0

assert_contains() {
  local name="$1"
  local haystack="$2"
  local needle="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf 'PASS  %s\n' "$name"
  else
    printf 'FAIL  %s (missing: %s)\n' "$name" "$needle" >&2
    fail=1
  fi
}

assert_not_contains() {
  local name="$1"
  local haystack="$2"
  local needle="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf 'FAIL  %s (unexpected: %s)\n' "$name" "$needle" >&2
    fail=1
  else
    printf 'PASS  %s\n' "$name"
  fi
}

workflow="$(<"$WORKFLOW")"

assert_contains \
  "release workflow pins target_commitish to exact SHA" \
  "$workflow" \
  "target_commitish: \${{ steps.tag.outputs.target_sha }}"

assert_contains \
  "release workflow verifies tag peel" \
  "$workflow" \
  'git rev-parse "${TAG}^{commit}"'

assert_contains \
  "release workflow compares full workflow SHA" \
  "$workflow" \
  'if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then'

assert_contains \
  "release workflow fetches created tag" \
  "$workflow" \
  'git fetch --force origin "refs/tags/${TAG}:refs/tags/${TAG}"'

assert_not_contains \
  "stale draft release comment removed" \
  "$workflow" \
  "draft GitHub Release"

assert_contains \
  "release is Human workflow_dispatch only" \
  "$workflow" \
  "workflow_dispatch:"

assert_not_contains \
  "release has no automatic push-to-main trigger" \
  "$workflow" \
  "branches: [main]"

assert_contains \
  "release workflow creates GitHub Release" \
  "$workflow" \
  "Create GitHub Release"

assert_contains \
  "release workflow passes tag to notes script" \
  "$workflow" \
  "RELEASE_TAG: \${{ steps.tag.outputs.tag }}"

expected_sha="$(git -C "$ROOT" rev-parse HEAD)"
if [[ ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FAIL  worktree HEAD is not a full 40-character SHA" >&2
  exit 1
fi

notes_output="$(
  cd "$ROOT"
  RELEASE_TAG="v2099.01.01.deadbeef" "$NOTES_SCRIPT" "HEAD~5"
)"

assert_contains \
  "release notes include full release commit SHA" \
  "$notes_output" \
  "Release commit: \`${expected_sha}\`"

assert_contains \
  "release notes include human-readable tag" \
  "$notes_output" \
  "Release tag: \`v2099.01.01.deadbeef\`"

assert_contains \
  "release notes retain Linear-linked section" \
  "$notes_output" \
  "### Linear-linked changes"

assert_contains \
  "release notes retain all commits section" \
  "$notes_output" \
  "### All commits"

assert_contains \
  "release notes retain commit range" \
  "$notes_output" \
  "Range: \`"

if [[ "$fail" -ne 0 ]]; then
  echo "Some release workflow identity tests failed." >&2
  exit 1
fi

echo "All release workflow identity regression tests passed."
