#!/usr/bin/env bash
# Regression tests for validate-pr-linear-id.sh
# Usage: ./scripts/linear/test-validate-pr-linear-id.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VALIDATOR="${ROOT}/scripts/linear/validate-pr-linear-id.sh"
chmod +x "$VALIDATOR"

run_case() {
  local name="$1"
  local expect_exit="$2"
  shift 2
  local title="$1"
  local body="$2"
  local branch="$3"
  local base="${4:-}"

  set +e
  MODE=pr-governance PR_TITLE="$title" PR_BODY="$body" PR_BRANCH="$branch" PR_BASE="$base" \
    "$VALIDATOR" >/dev/null 2>&1
  local code=$?
  set -e

  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected exit %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    MODE=pr-governance PR_TITLE="$title" PR_BODY="$body" PR_BRANCH="$branch" PR_BASE="$base" \
      "$VALIDATOR" 2>&1 | sed 's/^/      /' >&2 || true
    return 1
  fi
}

fail=0

run_case "PR165 collision" 1 \
  "DEE-150 infra(dev-os): implement WAIA DEV OS optimization roadmap" \
  "**Linear:** _create infra issue — do NOT use DEE-150 (latency scope)_
**Tier:** T1" \
  "dee-150-dev-os-optimization-roadmap" || fail=1

run_case "missing explicit Linear" 1 \
  "DEE-153 foo" \
  "**Tier:** T1" \
  "dee-153-foo" || fail=1

run_case "PR166 aligned metadata" 0 \
  "DEE-153 infra(governance): P0 Linear ID collision hardening" \
  "**Linear:** \`DEE-153\` https://linear.app/deepsense/issue/DEE-153
**Tier:** T1" \
  "dee-153-linear-id-governance-hardening" || fail=1

run_case "zero-pad id equivalence" 0 \
  "DEE-7 fix: something" \
  "**Linear:** \`DEE-7\`
**Tier:** T1" \
  "dee-07-something" || fail=1

run_case "release promotion with n/a linear" 0 \
  "Release: promote dev to main for AT-E1 production activation" \
  "**Linear:** n/a (release promotion)
**Tier:** T3
Release drivers: DEE-225, DEE-192, DEE-226, DEE-227" \
  "dev" \
  "main" || fail=1

run_case "release promotion missing linear" 1 \
  "Release: promote dev to main" \
  "**Tier:** T3" \
  "dev" \
  "main" || fail=1

run_case "dev branch to dev base still requires dee branch" 1 \
  "Release: promote dev to main" \
  "**Linear:** n/a (release promotion)
**Tier:** T3" \
  "dev" \
  "dev" || fail=1

# Option C (DEE-231): release/back-sync PRs are still validated as normal dee PRs
# (explicit Linear + dee branch). The merge-strategy hint is stdout-only and must not
# change exit behavior.
run_case "release back-sync PR to dev passes" 0 \
  "DEE-231 chore(release): back-sync main into dev" \
  "**Linear:** \`DEE-231\`
**Tier:** T1" \
  "dee-231-release-back-sync-main-into-dev" \
  "dev" || fail=1

run_case "release-promote dee branch to main passes" 0 \
  "DEE-231 chore(release): promote dev to main" \
  "**Linear:** \`DEE-231\`
**Tier:** T2" \
  "dee-231-release-promote-trader" \
  "main" || fail=1

if [[ "$fail" -ne 0 ]]; then
  echo "Some tests failed." >&2
  exit 1
fi

echo "All regression tests passed."
