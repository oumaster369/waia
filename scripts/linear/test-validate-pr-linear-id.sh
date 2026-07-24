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

run_linear_done_case() {
  local name="$1"
  local expect_exit="$2"
  local expect_skip_reason="${3:-}"
  shift 3
  local title="$1"
  local body="$2"
  local branch="$3"
  local base="${4:-dev}"

  set +e
  local output
  output="$(
    MODE=linear-done PR_TITLE="$title" PR_BODY="$body" PR_BRANCH="$branch" PR_BASE="$base" \
      "$VALIDATOR" 2>&1
  )"
  local code=$?
  set -e

  if [[ "$code" -ne "$expect_exit" ]]; then
    printf 'FAIL  %s (expected exit %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    printf '%s\n' "$output" | sed 's/^/      /' >&2
    return 1
  fi

  if [[ -n "$expect_skip_reason" ]]; then
    if ! printf '%s\n' "$output" | grep -q "SKIP_REASON=${expect_skip_reason}"; then
      printf 'FAIL  %s (missing SKIP_REASON=%s)\n' "$name" "$expect_skip_reason" >&2
      printf '%s\n' "$output" | sed 's/^/      /' >&2
      return 1
    fi
  fi

  if [[ "$expect_exit" -eq 0 ]]; then
    if ! printf '%s\n' "$output" | grep -q '^RESOLVED_DEE_ID='; then
      printf 'FAIL  %s (missing RESOLVED_DEE_ID)\n' "$name" >&2
      printf '%s\n' "$output" | sed 's/^/      /' >&2
      return 1
    fi
  fi

  printf 'PASS  %s (exit %s)\n' "$name" "$code"
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

run_case "plain Linear field rejected" 1 \
  "DEE-261 infra(governance): test" \
  "Linear: DEE-261
Parent: DEE-103
Tier: T1" \
  "dee-261-governance-pr-body-preflight" || fail=1

run_case "plain Linear with bold Tier still fails Linear" 1 \
  "DEE-261 infra(governance): test" \
  "Linear: DEE-261
**Tier:** T1" \
  "dee-261-governance-pr-body-preflight" || fail=1

run_case "Includes field does not change resolved Linear id" 0 \
  "DEE-403 infra(governance): lifecycle integration boundary" \
  "**Linear:** \`DEE-403\`
**Includes:** \`DEE-402\`, \`DEE-401\`
**Tier:** T2" \
  "dee-403-devos-lifecycle-integration" || fail=1

KEEP_OPEN_BODY='**Linear:** `DEE-416`
**Linear completion:** keep-open
**Linear completion reason:** DEE-416 remains active through T4, Historical Dataset Qualification, deterministic Control Replay, and Full Historical Validation.
**Tier:** T0'

run_case "valid aligned keep-open PR passes governance" 0 \
  "DEE-416 docs(plan): refresh release and back-sync state before T4" \
  "$KEEP_OPEN_BODY" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_linear_done_case "valid aligned keep-open PR skips linear-done" 2 explicit_keep_open \
  "DEE-416 docs(plan): refresh release and back-sync state before T4" \
  "$KEEP_OPEN_BODY" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_case "keep-open without reason fails governance" 1 \
  "DEE-416 docs(plan): refresh" \
  "**Linear:** \`DEE-416\`
**Linear completion:** keep-open
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_case "keep-open without explicit Linear ID fails governance" 1 \
  "DEE-416 docs(plan): refresh" \
  "**Linear completion:** keep-open
**Linear completion reason:** parent remains active
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_case "title branch Linear mismatch with keep-open fails" 1 \
  "DEE-424 docs(plan): refresh" \
  "**Linear:** \`DEE-416\`
**Linear completion:** keep-open
**Linear completion reason:** parent remains active
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_case "non-release n/a line with DEE in prose fails governance" 1 \
  "DEE-416 docs(plan): refresh" \
  "**Linear:** n/a (post-release canonical-state reconciliation; DEE-416 remains In Progress)
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_linear_done_case "ordinary aligned PR auto-closes" 0 "" \
  "DEE-416 docs(plan): sync" \
  "**Linear:** \`DEE-416\`
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_linear_done_case "release promotion n/a skips linear-done" 2 release_promotion_pr \
  "Release: promote dev to main — 2026-07-22" \
  "**Linear:** n/a (release promotion)
**Tier:** T2" \
  "dev" \
  "main" || fail=1

run_case "duplicate conflicting completion fields fail governance" 1 \
  "DEE-416 docs(plan): refresh" \
  "**Linear:** \`DEE-416\`
**Linear completion:** keep-open
**Linear completion:** auto-close
**Linear completion reason:** parent remains active
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_case "Includes Active program and reason text do not replace explicit Linear id" 0 \
  "DEE-416 docs(plan): refresh" \
  "**Linear:** \`DEE-416\`
**Linear completion:** keep-open
**Linear completion reason:** DEE-424 and DEE-423 remain active under parent DEE-416.
**Active program:** DEE-416 — remains In Progress
**Includes:** \`DEE-424\`, \`DEE-423\`
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_case "DEE-432 atomic governance issue passes governance" 0 \
  "DEE-432 fix(governance): add explicit Linear keep-open lifecycle" \
  "**Linear:** \`DEE-432\`
**Tier:** T0" \
  "dee-432-linear-keep-open-lifecycle-governance" || fail=1

run_linear_done_case "DEE-432 atomic governance issue auto-closes" 0 "" \
  "DEE-432 fix(governance): add explicit Linear keep-open lifecycle" \
  "**Linear:** \`DEE-432\`
**Tier:** T0" \
  "dee-432-linear-keep-open-lifecycle-governance" || fail=1

if [[ "$fail" -ne 0 ]]; then
  echo "Some tests failed." >&2
  exit 1
fi

echo "All regression tests passed."
