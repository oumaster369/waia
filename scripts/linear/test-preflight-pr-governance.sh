#!/usr/bin/env bash
# Regression tests for preflight-pr-governance.sh
# Usage: ./scripts/linear/test-preflight-pr-governance.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PREFLIGHT="${ROOT}/scripts/linear/preflight-pr-governance.sh"
chmod +x "$PREFLIGHT"

run_case() {
  local name="$1"
  local expect_exit="$2"
  shift 2
  local title="$1"
  local body="$2"
  local branch="$3"
  local base="${4:-dev}"

  set +e
  PR_TITLE="$title" PR_BODY="$body" PR_BRANCH="$branch" PR_BASE="$base" \
    "$PREFLIGHT" >/dev/null 2>&1
  local code=$?
  set -e

  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected exit %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    PR_TITLE="$title" PR_BODY="$body" PR_BRANCH="$branch" PR_BASE="$base" \
      "$PREFLIGHT" 2>&1 | sed 's/^/      /' >&2 || true
    return 1
  fi
}

fail=0

run_case "plain Tier rejected" 1 \
  "DEE-261 infra(governance): test" \
  "**Linear:** \`DEE-261\`
Tier: T1" \
  "dee-261-governance-pr-body-preflight" || fail=1

run_case "full valid body passes" 0 \
  "DEE-261 infra(governance): test" \
  "**Linear:** \`DEE-261\`
**Tier:** T1" \
  "dee-261-governance-pr-body-preflight" || fail=1

run_case "PR217 plain metadata pattern rejected" 1 \
  "DEE-260 feat(trader): add bar replay paper cycle runner" \
  "Linear: DEE-260
Parent: DEE-209
Tier: T2" \
  "dee-260-bar-replay" || fail=1

if [[ "$fail" -ne 0 ]]; then
  echo "Some preflight tests failed." >&2
  exit 1
fi

echo "All preflight regression tests passed."
