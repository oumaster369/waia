#!/usr/bin/env bash
# Regression tests for validate-pr-linear-id.sh (single-trunk main).
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
  local base="${4:-main}"

  set +e
  local output
  output="$(
    MODE=pr-governance PR_TITLE="$title" PR_BODY="$body" PR_BRANCH="$branch" PR_BASE="$base" \
      "$VALIDATOR" 2>&1
  )"
  local code=$?
  set -e

  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected exit %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    printf '%s\n' "$output" | sed 's/^/      /' >&2
    return 1
  fi
}

run_case_expect_stdout() {
  local name="$1"
  local expect_exit="$2"
  local expect_needle="$3"
  shift 3
  local title="$1"
  local body="$2"
  local branch="$3"
  local base="${4:-main}"

  set +e
  local output
  output="$(
    MODE=pr-governance PR_TITLE="$title" PR_BODY="$body" PR_BRANCH="$branch" PR_BASE="$base" \
      "$VALIDATOR" 2>&1
  )"
  local code=$?
  set -e

  if [[ "$code" -ne "$expect_exit" ]]; then
    printf 'FAIL  %s (expected exit %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    printf '%s\n' "$output" | sed 's/^/      /' >&2
    return 1
  fi
  if ! printf '%s\n' "$output" | grep -q "$expect_needle"; then
    printf 'FAIL  %s (missing stdout needle: %s)\n' "$name" "$expect_needle" >&2
    printf '%s\n' "$output" | sed 's/^/      /' >&2
    return 1
  fi
  printf 'PASS  %s (exit %s)\n' "$name" "$code"
}

run_linear_done_case() {
  local name="$1"
  local expect_exit="$2"
  local expect_skip_reason="${3:-}"
  shift 3
  local title="$1"
  local body="$2"
  local branch="$3"
  local base="${4:-main}"

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

run_train_case() {
  local name="$1"
  local expect_exit="$2"
  local body="$3"
  local head_sha="$4"
  local base_sha="$5"

  set +e
  local output
  output="$(
    MODE=pr-governance \
      PR_TITLE="DEE-999 feat(trader): integrate fixture train" \
      PR_BODY="$body" \
      PR_BRANCH="dee-999-validator-fixture" \
      PR_BASE="main" \
      PR_HEAD_SHA="$head_sha" \
      PR_BASE_SHA="$base_sha" \
      INTEGRATION_TRAIN_MANIFEST_ROOT="$TRAIN_REPO" \
      INTEGRATION_TRAIN_GIT_ROOT="$TRAIN_REPO" \
      "$VALIDATOR" 2>&1
  )"
  local code=$?
  set -e

  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected exit %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    printf '%s\n' "$output" | sed 's/^/      /' >&2
    return 1
  fi
}

run_train_done_case() {
  local name="$1"
  local expect_exit="$2"
  local body="$3"
  local head_sha="$4"
  local base_sha="$5"

  set +e
  MODE=linear-done \
    PR_TITLE="DEE-999 feat(trader): integrate fixture train" \
    PR_BODY="$body" \
    PR_BRANCH="dee-999-validator-fixture" \
    PR_BASE="main" \
    PR_HEAD_SHA="$head_sha" \
    PR_BASE_SHA="$base_sha" \
    INTEGRATION_TRAIN_MANIFEST_ROOT="$TRAIN_REPO" \
    INTEGRATION_TRAIN_GIT_ROOT="$TRAIN_REPO" \
    "$VALIDATOR" >/dev/null 2>&1
  local code=$?
  set -e

  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected exit %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    return 1
  fi
}

TRAIN_FIXTURE_REL="docs/plans/dee-999-validator-fixture.integration-train.json"
TRAIN_TMP="$(mktemp -d "${TMPDIR:-/tmp}/waia-pr-train.XXXXXX")"
TRAIN_REPO="${TRAIN_TMP}/repo"
TRAIN_FIXTURE="${TRAIN_REPO}/${TRAIN_FIXTURE_REL}"
TRAIN_TEMPLATE="${TRAIN_TMP}/frozen-template.json"
TRAIN_PLAN="${TRAIN_REPO}/docs/plans/dee-999-validator-fixture.md"
trap 'rm -rf "$TRAIN_TMP"' EXIT
mkdir -p "${TRAIN_REPO}/docs/plans"
git init -q "$TRAIN_REPO"
git -C "$TRAIN_REPO" config user.name "WAIA governance test"
git -C "$TRAIN_REPO" config user.email "governance-test@example.invalid"
printf 'fixture plan\n' >"$TRAIN_PLAN"
git -C "$TRAIN_REPO" add docs/plans/dee-999-validator-fixture.md
git -C "$TRAIN_REPO" commit -qm "base"
TRAIN_BASE="$(git -C "$TRAIN_REPO" rev-parse HEAD)"

jq -n '
{
  schemaVersion: "waia-trader-integration-train/v1",
  integrationIssue: "DEE-999",
  status: "frozen",
  riskTier: "T2",
  humanGatePolicy: "none",
  maxConcurrentImplementationTasks: 2,
  finalIntegrationMode: "serialized",
  mergeMode: "squash",
  splitRationale: null,
  includedChildren: [
    {
      issue: "DEE-701", deliveryStatus: "delivered", blocked: false,
      scope: "alpha", dependencies: [], dependencyEvidence: ["blockers Done"],
      expectedFileOrSchemaSurfaces: ["lib/alpha/**"], actualFiles: ["lib/alpha/a.ts"],
      riskTier: "T2", humanGate: {status: "none", evidence: "n/a"},
      expectedAcceptanceEvidence: ["AC must pass"], expectedTests: ["alpha test"],
      acceptanceEvidence: ["AC pass"], integratedCommits: [("1" * 40)], tests: ["alpha test"],
      execution: {wave: 1, mode: "parallel", parallelGroup: "wave-1", dependencyCompatible: true, overlap: "none", competingMigration: false, sharedCanonicalIdentity: false, sharedAuthoritySchema: false, mutualInvalidationRisk: false}
    },
    {
      issue: "DEE-702", deliveryStatus: "delivered", blocked: false,
      scope: "beta", dependencies: [], dependencyEvidence: ["blockers Done"],
      expectedFileOrSchemaSurfaces: ["lib/beta/**"], actualFiles: ["lib/beta/b.ts"],
      riskTier: "T2", humanGate: {status: "none", evidence: "n/a"},
      expectedAcceptanceEvidence: ["AC must pass"], expectedTests: ["beta test"],
      acceptanceEvidence: ["AC pass"], integratedCommits: [("2" * 40)], tests: ["beta test"],
      execution: {wave: 1, mode: "parallel", parallelGroup: "wave-1", dependencyCompatible: true, overlap: "none", competingMigration: false, sharedCanonicalIdentity: false, sharedAuthoritySchema: false, mutualInvalidationRisk: false}
    }
  ],
  deferredChildren: [{issue: "DEE-703", reason: "excluded before freeze", completionClaimed: false}],
  integrationEvidence: {
    preImplementationAdmission: {status: "pass", manifestDigest: ("a" * 64), manifestCommit: ("a" * 40), manifestPath: "docs/plans/dee-999-validator-fixture.integration-train.json", reviewer: "Human-ratified controller"},
    admissionReviews: [
      {issue: "DEE-701", status: "pass", reviewedCommits: [("1" * 40)], reviewedFiles: ["lib/alpha/a.ts"]},
      {issue: "DEE-702", status: "pass", reviewedCommits: [("2" * 40)], reviewedFiles: ["lib/beta/b.ts"]}
    ],
    cumulativeChecks: [
      {afterIssue: "DEE-701", status: "pass", commands: ["alpha test"]},
      {afterIssue: "DEE-702", status: "pass", commands: ["alpha and beta tests"]}
    ],
    fullDiffFrozen: true,
    finalAdversarialReviewRequired: true
  }
}' >"$TRAIN_TEMPLATE"

jq '
  .status = "admitted" |
  .includedChildren |= map(.deliveryStatus = "planned" | del(.actualFiles, .acceptanceEvidence, .integratedCommits, .tests)) |
  .integrationEvidence = {admissionEvidence: {status: "pass", reviewer: "Human-ratified controller"}}
' "$TRAIN_TEMPLATE" >"$TRAIN_FIXTURE"
git -C "$TRAIN_REPO" add "$TRAIN_FIXTURE_REL"
git -C "$TRAIN_REPO" commit -qm "admit train manifest"
TRAIN_ADMISSION="$(git -C "$TRAIN_REPO" rev-parse HEAD)"
TRAIN_ADMISSION_DIGEST="$(shasum -a 256 "$TRAIN_FIXTURE" | awk '{print $1}')"

mkdir -p "${TRAIN_REPO}/lib/alpha" "${TRAIN_REPO}/lib/beta"
printf 'alpha\n' >"${TRAIN_REPO}/lib/alpha/a.ts"
git -C "$TRAIN_REPO" add lib/alpha/a.ts
git -C "$TRAIN_REPO" commit -qm "DEE-701 child"
TRAIN_ALPHA="$(git -C "$TRAIN_REPO" rev-parse HEAD)"
printf 'beta\n' >"${TRAIN_REPO}/lib/beta/b.ts"
git -C "$TRAIN_REPO" add lib/beta/b.ts
git -C "$TRAIN_REPO" commit -qm "DEE-702 child"
TRAIN_BETA="$(git -C "$TRAIN_REPO" rev-parse HEAD)"

jq --arg admission "$TRAIN_ADMISSION" --arg admissionDigest "$TRAIN_ADMISSION_DIGEST" --arg alpha "$TRAIN_ALPHA" --arg beta "$TRAIN_BETA" '
  .integrationEvidence.preImplementationAdmission.manifestCommit = $admission |
  .integrationEvidence.preImplementationAdmission.manifestDigest = $admissionDigest |
  .includedChildren[0].integratedCommits = [$alpha] |
  .includedChildren[1].integratedCommits = [$beta] |
  .integrationEvidence.admissionReviews[0].reviewedCommits = [$alpha] |
  .integrationEvidence.admissionReviews[1].reviewedCommits = [$beta]
' "$TRAIN_TEMPLATE" >"$TRAIN_FIXTURE"
git -C "$TRAIN_REPO" add "$TRAIN_FIXTURE_REL"
git -C "$TRAIN_REPO" commit -qm "freeze train manifest"
TRAIN_HEAD="$(git -C "$TRAIN_REPO" rev-parse HEAD)"
TRAIN_DIGEST="$(shasum -a 256 "$TRAIN_FIXTURE" | awk '{print $1}')"

train_body() {
  local digest="$1"
  local declared_head="$2"
  local includes="$3"
  printf '%s\n' \
    '**Linear:** `DEE-999`' \
    '**Batch mode:** `integration-train`' \
    "**Includes:** ${includes}" \
    '**Deferred:** `DEE-703`' \
    "**Integration manifest:** \`${TRAIN_FIXTURE_REL}\`" \
    "**Manifest digest:** \`${digest}\`" \
    '**Manifest status:** `frozen`' \
    "**Manifest base SHA:** \`${TRAIN_BASE}\`" \
    "**Manifest head SHA:** \`${declared_head}\`" \
    '**Concurrency limit:** `2`' \
    '**Final integration:** `serialized`' \
    '**Independent review:** `pass`' \
    "**Independent review head:** \`${declared_head}\`" \
    '**Unresolved findings:** `0`' \
    '**DEE-653 admission:** `required-before-merge`' \
    '**Tier:** T2'
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

run_case "normal dee → main aligned metadata" 0 \
  "DEE-153 infra(governance): P0 Linear ID collision hardening" \
  "**Linear:** \`DEE-153\` https://linear.app/deepsense/issue/DEE-153
**Tier:** T1" \
  "dee-153-linear-id-governance-hardening" \
  "main" || fail=1

DEFAULT_TEMPLATE_BODY="$(sed 's/DEE-NN/DEE-153/g' "${ROOT}/.github/pull_request_template.md")"
run_case "completed default single-issue template ignores commented train example" 0 \
  "DEE-153 infra(governance): P0 Linear ID collision hardening" \
  "$DEFAULT_TEMPLATE_BODY" \
  "dee-153-linear-id-governance-hardening" \
  "main" || fail=1

run_case_expect_stdout "normal main PR emits squash merge strategy" 0 "MERGE_STRATEGY=squash" \
  "DEE-511 infra(governance): single-trunk main migration" \
  "**Linear:** \`DEE-511\`
**Tier:** T4" \
  "dee-511-waia-single-trunk-main" \
  "main" || fail=1

run_case "zero-pad id equivalence" 0 \
  "DEE-7 fix: something" \
  "**Linear:** \`DEE-7\`
**Tier:** T1" \
  "dee-07-something" \
  "main" || fail=1

run_case "legacy release promotion retired" 1 \
  "Release: promote dev to main for AT-E1 production activation" \
  "**Linear:** n/a (release promotion)
**Tier:** T3
Release drivers: DEE-225, DEE-192, DEE-226, DEE-227" \
  "dev" \
  "main" || fail=1

run_case "legacy release promotion missing linear still fails" 1 \
  "Release: promote dev to main" \
  "**Tier:** T3" \
  "dev" \
  "main" || fail=1

run_case "non-main base rejected" 1 \
  "DEE-231 chore(release): back-sync main into dev" \
  "**Linear:** \`DEE-231\`
**Tier:** T1" \
  "dee-231-release-back-sync-main-into-dev" \
  "dev" || fail=1

run_case "title/branch Linear mismatch fails" 1 \
  "DEE-999 infra(governance): mismatch" \
  "**Linear:** \`DEE-511\`
**Tier:** T4" \
  "dee-511-waia-single-trunk-main" \
  "main" || fail=1

run_case "plain Linear field rejected" 1 \
  "DEE-261 infra(governance): test" \
  "Linear: DEE-261
Parent: DEE-103
Tier: T1" \
  "dee-261-governance-pr-body-preflight" || fail=1

run_case "Includes field does not change resolved Linear id" 0 \
  "DEE-403 infra(governance): lifecycle integration boundary" \
  "**Linear:** \`DEE-403\`
**Includes:** \`DEE-402\`, \`DEE-401\`
**Tier:** T2" \
  "dee-403-devos-lifecycle-integration" \
  "main" || fail=1

VALID_TRAIN_BODY="$(train_body "$TRAIN_DIGEST" "$TRAIN_HEAD" '\`DEE-701\`, \`DEE-702\`')"
run_train_case "valid frozen Integration Train PR" 0 "$VALID_TRAIN_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1
run_train_done_case "valid train resolves only Integration Batch issue for linear-done" 0 "$VALID_TRAIN_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

DUPLICATE_MODE_BODY="$(printf '%s\n%s' '**Batch mode:** `single-issue`' "$VALID_TRAIN_BODY")"
run_train_case "duplicate or conflicting batch mode fails" 1 "$DUPLICATE_MODE_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

DUPLICATE_DIGEST_BODY="$(printf '%s\n%s' "$VALID_TRAIN_BODY" "**Manifest digest:** \`${TRAIN_DIGEST}\`")"
run_train_case "duplicate train metadata fails" 1 "$DUPLICATE_DIGEST_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

DUPLICATE_INCLUDES_BODY="$(printf '%s\n%s' "$VALID_TRAIN_BODY" '**Includes:** `DEE-701`, `DEE-702`')"
run_train_case "duplicate Includes field fails" 1 "$DUPLICATE_INCLUDES_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

DUPLICATE_LINEAR_BODY="$(printf '%s\n%s' "$VALID_TRAIN_BODY" '**Linear:** `DEE-998`')"
run_train_case "duplicate or conflicting Linear field fails" 1 "$DUPLICATE_LINEAR_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

TIER_MISMATCH_BODY="$(printf '%s' "$VALID_TRAIN_BODY" | sed 's/\*\*Tier:\*\* T2/**Tier:** T1/')"
run_train_case "PR tier differing from manifest risk tier fails" 1 "$TIER_MISMATCH_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

MISSING_CHILD_BODY="$(train_body "$TRAIN_DIGEST" "$TRAIN_HEAD" '\`DEE-701\`')"
run_train_case "missing or unlisted included child fails" 1 "$MISSING_CHILD_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

DRIFT_BODY="$(train_body "$(printf '0%.0s' {1..64})" "$TRAIN_HEAD" '\`DEE-701\`, \`DEE-702\`')"
run_train_case "manifest drift fails" 1 "$DRIFT_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

STALE_HEAD="$(printf 'c%.0s' {1..40})"
STALE_HEAD_BODY="$(train_body "$TRAIN_DIGEST" "$STALE_HEAD" '\`DEE-701\`, \`DEE-702\`')"
run_train_case "stale exact head fails" 1 "$STALE_HEAD_BODY" "$TRAIN_HEAD" "$TRAIN_BASE" || fail=1

run_train_case "stale exact base fails" 1 "$VALID_TRAIN_BODY" "$TRAIN_HEAD" "$STALE_HEAD" || fail=1

KEEP_OPEN_BODY='**Linear:** `DEE-416`
**Linear completion:** keep-open
**Linear completion reason:** DEE-416 remains active through T4, Historical Dataset Qualification, deterministic Control Replay, and Full Historical Validation.
**Tier:** T0'

run_case "valid aligned keep-open PR passes governance" 0 \
  "DEE-416 docs(plan): refresh release and back-sync state before T4" \
  "$KEEP_OPEN_BODY" \
  "dee-416-post-release-canonical-plan-refresh-20260722" \
  "main" || fail=1

run_linear_done_case "valid aligned keep-open PR skips linear-done" 2 explicit_keep_open \
  "DEE-416 docs(plan): refresh release and back-sync state before T4" \
  "$KEEP_OPEN_BODY" \
  "dee-416-post-release-canonical-plan-refresh-20260722" \
  "main" || fail=1

run_case "keep-open without reason fails governance" 1 \
  "DEE-416 docs(plan): refresh" \
  "**Linear:** \`DEE-416\`
**Linear completion:** keep-open
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" || fail=1

run_linear_done_case "ordinary aligned PR auto-closes on main" 0 "" \
  "DEE-416 docs(plan): sync" \
  "**Linear:** \`DEE-416\`
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" \
  "main" || fail=1

run_linear_done_case "legacy release promotion fails governance for linear-done" 2 governance_validation_failed \
  "Release: promote dev to main — 2026-07-22" \
  "**Linear:** n/a (release promotion)
**Tier:** T2" \
  "dev" \
  "main" || fail=1

run_case "Includes Active program and reason text do not replace explicit Linear id" 0 \
  "DEE-416 docs(plan): refresh" \
  "**Linear:** \`DEE-416\`
**Linear completion:** keep-open
**Linear completion reason:** DEE-424 and DEE-423 remain active under parent DEE-416.
**Active program:** DEE-416 — remains In Progress
**Includes:** \`DEE-424\`, \`DEE-423\`
**Tier:** T0" \
  "dee-416-post-release-canonical-plan-refresh-20260722" \
  "main" || fail=1

run_case "DEE-432 atomic governance issue passes governance" 0 \
  "DEE-432 fix(governance): add explicit Linear keep-open lifecycle" \
  "**Linear:** \`DEE-432\`
**Tier:** T0" \
  "dee-432-linear-keep-open-lifecycle-governance" \
  "main" || fail=1

run_linear_done_case "DEE-432 atomic governance issue auto-closes" 0 "" \
  "DEE-432 fix(governance): add explicit Linear keep-open lifecycle" \
  "**Linear:** \`DEE-432\`
**Tier:** T0" \
  "dee-432-linear-keep-open-lifecycle-governance" \
  "main" || fail=1

DEE536_KEEP_OPEN_BODY='**Linear:** `DEE-536`
**Linear completion:** keep-open
**Linear completion reason:** DEE-536 remains an active post-merge host qualification gate until the repaired qualifier release is Human-qualified on the Execution Server and the final HOST_QUALIFIED or exact blocked receipt exists.
**Tier:** T2'

run_case "DEE-536 qualifier repair keep-open passes governance" 0 \
  "DEE-536 fix(trader): repair throughput host qualification evidence" \
  "$DEE536_KEEP_OPEN_BODY" \
  "dee-536-throughput-qualifier-repair" \
  "main" || fail=1

run_linear_done_case "DEE-536 qualifier repair keep-open skips linear-done" 2 explicit_keep_open \
  "DEE-536 fix(trader): repair throughput host qualification evidence" \
  "$DEE536_KEEP_OPEN_BODY" \
  "dee-536-throughput-qualifier-repair" \
  "main" || fail=1

if [[ "$fail" -ne 0 ]]; then
  echo "Some tests failed." >&2
  exit 1
fi

echo "All validate-pr-linear-id regression tests passed."
