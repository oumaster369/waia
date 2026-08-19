#!/usr/bin/env bash
# Regression tests for validate-integration-train-manifest.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VALIDATOR="${ROOT}/scripts/linear/validate-integration-train-manifest.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/waia-integration-train.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

chmod +x "$VALIDATOR"

cat >"${TMP}/valid.json" <<'EOF'
{
  "schemaVersion": "waia-trader-integration-train/v1",
  "integrationIssue": "DEE-999",
  "status": "frozen",
  "riskTier": "T2",
  "humanGatePolicy": "none",
  "maxConcurrentImplementationTasks": 2,
  "finalIntegrationMode": "serialized",
  "mergeMode": "squash",
  "splitRationale": null,
  "includedChildren": [
    {
      "issue": "DEE-701",
      "deliveryStatus": "delivered",
      "blocked": false,
      "scope": "Implement isolated alpha surface.",
      "dependencies": [],
      "dependencyEvidence": ["All Linear blockers are Done."],
      "expectedFileOrSchemaSurfaces": ["lib/trader/alpha/**"],
      "actualFiles": ["lib/trader/alpha/index.ts"],
      "riskTier": "T2",
      "humanGate": {"status": "none", "evidence": "n/a"},
      "expectedAcceptanceEvidence": ["DEE-701 AC1 must pass."],
      "expectedTests": ["pnpm test -- alpha"],
      "acceptanceEvidence": ["DEE-701 AC1 passed."],
      "integratedCommits": ["1111111111111111111111111111111111111111"],
      "tests": ["pnpm test -- alpha"],
      "execution": {
        "wave": 1,
        "mode": "parallel",
        "parallelGroup": "wave-1",
        "dependencyCompatible": true,
        "overlap": "none",
        "competingMigration": false,
        "sharedCanonicalIdentity": false,
        "sharedAuthoritySchema": false,
        "mutualInvalidationRisk": false
      }
    },
    {
      "issue": "DEE-702",
      "deliveryStatus": "delivered",
      "blocked": false,
      "scope": "Implement isolated beta surface.",
      "dependencies": [],
      "dependencyEvidence": ["All Linear blockers are Done."],
      "expectedFileOrSchemaSurfaces": ["lib/trader/beta/**"],
      "actualFiles": ["lib/trader/beta/index.ts"],
      "riskTier": "T2",
      "humanGate": {"status": "none", "evidence": "n/a"},
      "expectedAcceptanceEvidence": ["DEE-702 AC1 must pass."],
      "expectedTests": ["pnpm test -- beta"],
      "acceptanceEvidence": ["DEE-702 AC1 passed."],
      "integratedCommits": ["2222222222222222222222222222222222222222"],
      "tests": ["pnpm test -- beta"],
      "execution": {
        "wave": 1,
        "mode": "parallel",
        "parallelGroup": "wave-1",
        "dependencyCompatible": true,
        "overlap": "none",
        "competingMigration": false,
        "sharedCanonicalIdentity": false,
        "sharedAuthoritySchema": false,
        "mutualInvalidationRisk": false
      }
    }
  ],
  "deferredChildren": [
    {"issue": "DEE-703", "reason": "Blocked independently; excluded before freeze.", "completionClaimed": false}
  ],
  "integrationEvidence": {
    "preImplementationAdmission": {
      "status": "pass",
      "manifestDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "manifestCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "manifestPath": "docs/plans/dee-999-validator-fixture.integration-train.json",
      "reviewer": "Human-ratified controller"
    },
    "admissionReviews": [
      {"issue": "DEE-701", "status": "pass", "reviewedCommits": ["1111111111111111111111111111111111111111"], "reviewedFiles": ["lib/trader/alpha/index.ts"]},
      {"issue": "DEE-702", "status": "pass", "reviewedCommits": ["2222222222222222222222222222222222222222"], "reviewedFiles": ["lib/trader/beta/index.ts"]}
    ],
    "cumulativeChecks": [
      {"afterIssue": "DEE-701", "status": "pass", "commands": ["pnpm test -- alpha"]},
      {"afterIssue": "DEE-702", "status": "pass", "commands": ["pnpm test -- alpha beta"]}
    ],
    "fullDiffFrozen": true,
    "finalAdversarialReviewRequired": true
  }
}
EOF

run_case() {
  local name="$1"
  local expect_exit="$2"
  local file="$3"
  set +e
  INTEGRATION_TRAIN_REQUIRE_GIT_PROVENANCE=0 "$VALIDATOR" "$file" DEE-999 >/dev/null 2>&1
  local code=$?
  set -e
  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    INTEGRATION_TRAIN_REQUIRE_GIT_PROVENANCE=0 "$VALIDATOR" "$file" DEE-999 2>&1 | sed 's/^/      /' >&2 || true
    return 1
  fi
}

run_phase_case() {
  local name="$1"
  local expect_exit="$2"
  local file="$3"
  local phase="$4"
  set +e
  INTEGRATION_TRAIN_REQUIRE_GIT_PROVENANCE=0 "$VALIDATOR" "$file" DEE-999 "$phase" >/dev/null 2>&1
  local code=$?
  set -e
  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    INTEGRATION_TRAIN_REQUIRE_GIT_PROVENANCE=0 "$VALIDATOR" "$file" DEE-999 "$phase" 2>&1 | sed 's/^/      /' >&2 || true
    return 1
  fi
}

fail=0
run_case "valid frozen multi-issue manifest" 0 "${TMP}/valid.json" || fail=1

jq '
  .status = "admitted" |
  .includedChildren |= map(
    .deliveryStatus = "planned" |
    del(.actualFiles, .acceptanceEvidence, .integratedCommits, .tests)
  ) |
  .integrationEvidence = {admissionEvidence: {status: "pass", reviewer: "Human-ratified controller"}}
' "${TMP}/valid.json" >"${TMP}/admitted.json"
run_phase_case "valid pre-implementation admission manifest" 0 "${TMP}/admitted.json" admission || fail=1
run_phase_case "canonical any-phase accepts admitted manifest" 0 "${TMP}/admitted.json" any || fail=1

jq '
  .includedChildren[0].execution = {wave: 1, mode: "serialized"} |
  .includedChildren[1].dependencies = ["DEE-701"] |
  .includedChildren[1].execution = {wave: 2, mode: "serialized"}
' "${TMP}/valid.json" >"${TMP}/valid-serialized-waves.json"
run_case "valid dependency-ordered serialized waves" 0 "${TMP}/valid-serialized-waves.json" || fail=1

jq '.includedChildren[0].blocked = true' "${TMP}/valid.json" >"${TMP}/blocked.json"
run_case "blocked child rejected" 1 "${TMP}/blocked.json" || fail=1

jq '.includedChildren[1].dependencies = ["DEE-701"]' "${TMP}/valid.json" >"${TMP}/dependent.json"
run_case "dependent concurrent child rejected" 1 "${TMP}/dependent.json" || fail=1

jq '.includedChildren[1].dependencies = ["DEE-703"]' "${TMP}/valid.json" >"${TMP}/depends-on-deferred.json"
run_case "delivered child depending on deferred child rejected" 1 "${TMP}/depends-on-deferred.json" || fail=1

jq '.includedChildren[1].expectedFileOrSchemaSurfaces = ["lib/trader/alpha/**"]' "${TMP}/valid.json" >"${TMP}/overlap.json"
run_case "overlapping concurrent child rejected" 1 "${TMP}/overlap.json" || fail=1

jq '.includedChildren[1].expectedFileOrSchemaSurfaces = ["lib/trader/alpha/nested/file.ts"]' "${TMP}/valid.json" >"${TMP}/prefix-overlap.json"
run_case "parent-glob concurrent surface overlap rejected" 1 "${TMP}/prefix-overlap.json" || fail=1

jq '.includedChildren[1].actualFiles = ["lib/trader/alpha/index.ts"]' "${TMP}/valid.json" >"${TMP}/actual-overlap.json"
run_case "overlapping actual file in parallel wave rejected" 1 "${TMP}/actual-overlap.json" || fail=1

jq '.includedChildren[1].execution.wave = 2' "${TMP}/valid.json" >"${TMP}/unordered-waves.json"
run_case "parallel declaration split across waves rejected" 1 "${TMP}/unordered-waves.json" || fail=1

jq '.includedChildren[].execution.wave = 2' "${TMP}/valid.json" >"${TMP}/missing-first-wave.json"
run_case "execution waves must start at one" 1 "${TMP}/missing-first-wave.json" || fail=1

jq '
  .includedChildren += [(.includedChildren[0] |
    .issue = "DEE-704" |
    .expectedFileOrSchemaSurfaces = ["lib/trader/gamma/**"] |
    .actualFiles = ["lib/trader/gamma/index.ts"] |
    .integratedCommits = [("4" * 40)]
  )] |
  .integrationEvidence.admissionReviews += [{issue: "DEE-704", status: "pass", reviewedCommits: [("4" * 40)], reviewedFiles: ["lib/trader/gamma/index.ts"]}] |
  .integrationEvidence.cumulativeChecks += [{afterIssue: "DEE-704", status: "pass", commands: ["gamma test"]}]
' "${TMP}/valid.json" >"${TMP}/three-concurrent.json"
run_case "more than two children in one wave rejected" 1 "${TMP}/three-concurrent.json" || fail=1

jq '.deferredChildren[0].completionClaimed = true' "${TMP}/valid.json" >"${TMP}/false-completion.json"
run_case "falsely completed deferred child rejected" 1 "${TMP}/false-completion.json" || fail=1

jq '.includedChildren[1].humanGate.status = "t3-scope-preauthorized"' "${TMP}/valid.json" >"${TMP}/mixed-human-gate.json"
run_case "prohibited Human-gate mixing rejected" 1 "${TMP}/mixed-human-gate.json" || fail=1

jq '.riskTier = "T4" | .includedChildren[].riskTier = "T4"' "${TMP}/valid.json" >"${TMP}/t4.json"
run_case "T4 train rejected" 1 "${TMP}/t4.json" || fail=1

run_provenance_case() {
  local name="$1"
  local expect_exit="$2"
  local file="$3"
  local head_sha="$4"
  local base_sha="$5"
  set +e
  PR_HEAD_SHA="$head_sha" PR_BASE_SHA="$base_sha" \
    INTEGRATION_TRAIN_GIT_ROOT="$PROVENANCE_REPO" \
    INTEGRATION_TRAIN_REQUIRE_GIT_PROVENANCE=1 \
    "$VALIDATOR" "$file" DEE-999 >/dev/null 2>&1
  local code=$?
  set -e
  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    PR_HEAD_SHA="$head_sha" PR_BASE_SHA="$base_sha" \
      INTEGRATION_TRAIN_GIT_ROOT="$PROVENANCE_REPO" \
      INTEGRATION_TRAIN_REQUIRE_GIT_PROVENANCE=1 \
      "$VALIDATOR" "$file" DEE-999 2>&1 | sed 's/^/      /' >&2 || true
    return 1
  fi
}

PROVENANCE_REPO="${TMP}/provenance-repo"
PROVENANCE_PATH="docs/plans/dee-999-validator-fixture.integration-train.json"
mkdir -p "${PROVENANCE_REPO}/docs/plans"
git init -q "$PROVENANCE_REPO"
git -C "$PROVENANCE_REPO" config user.name "WAIA governance test"
git -C "$PROVENANCE_REPO" config user.email "governance-test@example.invalid"
printf 'base\n' >"${PROVENANCE_REPO}/README.md"
git -C "$PROVENANCE_REPO" add README.md
git -C "$PROVENANCE_REPO" commit -qm "base"
PROVENANCE_BASE="$(git -C "$PROVENANCE_REPO" rev-parse HEAD)"

cp "${TMP}/admitted.json" "${PROVENANCE_REPO}/${PROVENANCE_PATH}"
git -C "$PROVENANCE_REPO" add "$PROVENANCE_PATH"
git -C "$PROVENANCE_REPO" commit -qm "admit manifest before implementation"
PROVENANCE_ADMISSION="$(git -C "$PROVENANCE_REPO" rev-parse HEAD)"
PROVENANCE_ADMISSION_DIGEST="$(shasum -a 256 "${PROVENANCE_REPO}/${PROVENANCE_PATH}" | awk '{print $1}')"

mkdir -p "${PROVENANCE_REPO}/lib/trader/alpha" "${PROVENANCE_REPO}/lib/trader/beta"
printf 'alpha\n' >"${PROVENANCE_REPO}/lib/trader/alpha/index.ts"
git -C "$PROVENANCE_REPO" add lib/trader/alpha/index.ts
git -C "$PROVENANCE_REPO" commit -qm "DEE-701 child"
PROVENANCE_ALPHA="$(git -C "$PROVENANCE_REPO" rev-parse HEAD)"
printf 'beta\n' >"${PROVENANCE_REPO}/lib/trader/beta/index.ts"
git -C "$PROVENANCE_REPO" add lib/trader/beta/index.ts
git -C "$PROVENANCE_REPO" commit -qm "DEE-702 child"
PROVENANCE_BETA="$(git -C "$PROVENANCE_REPO" rev-parse HEAD)"

jq \
  --arg admission "$PROVENANCE_ADMISSION" \
  --arg digest "$PROVENANCE_ADMISSION_DIGEST" \
  --arg alpha "$PROVENANCE_ALPHA" \
  --arg beta "$PROVENANCE_BETA" '
  .integrationEvidence.preImplementationAdmission.manifestCommit = $admission |
  .integrationEvidence.preImplementationAdmission.manifestDigest = $digest |
  .includedChildren[0].integratedCommits = [$alpha] |
  .includedChildren[1].integratedCommits = [$beta] |
  .integrationEvidence.admissionReviews[0].reviewedCommits = [$alpha] |
  .integrationEvidence.admissionReviews[1].reviewedCommits = [$beta]
' "${TMP}/valid.json" >"${PROVENANCE_REPO}/${PROVENANCE_PATH}"
git -C "$PROVENANCE_REPO" add "$PROVENANCE_PATH"
git -C "$PROVENANCE_REPO" commit -qm "freeze manifest"
PROVENANCE_HEAD="$(git -C "$PROVENANCE_REPO" rev-parse HEAD)"
cp "${PROVENANCE_REPO}/${PROVENANCE_PATH}" "${TMP}/provenance-frozen.json"

run_provenance_case "valid Git-proven frozen manifest" 0 "${PROVENANCE_REPO}/${PROVENANCE_PATH}" "$PROVENANCE_HEAD" "$PROVENANCE_BASE" || fail=1

jq '.integrationEvidence.preImplementationAdmission.manifestDigest = ("f" * 64)' "${TMP}/provenance-frozen.json" >"${PROVENANCE_REPO}/${PROVENANCE_PATH}"
run_provenance_case "forged admitted predecessor digest rejected" 1 "${PROVENANCE_REPO}/${PROVENANCE_PATH}" "$PROVENANCE_HEAD" "$PROVENANCE_BASE" || fail=1

jq '.includedChildren[0].integratedCommits = [("f" * 40)] | .integrationEvidence.admissionReviews[0].reviewedCommits = [("f" * 40)]' "${TMP}/provenance-frozen.json" >"${PROVENANCE_REPO}/${PROVENANCE_PATH}"
run_provenance_case "nonexistent delivered commit rejected" 1 "${PROVENANCE_REPO}/${PROVENANCE_PATH}" "$PROVENANCE_HEAD" "$PROVENANCE_BASE" || fail=1

jq --arg base "$PROVENANCE_BASE" '.includedChildren[0].integratedCommits = [$base] | .integrationEvidence.admissionReviews[0].reviewedCommits = [$base]' "${TMP}/provenance-frozen.json" >"${PROVENANCE_REPO}/${PROVENANCE_PATH}"
run_provenance_case "pre-admission out-of-range delivered commit rejected" 1 "${PROVENANCE_REPO}/${PROVENANCE_PATH}" "$PROVENANCE_HEAD" "$PROVENANCE_BASE" || fail=1

jq '.includedChildren[0].actualFiles = ["lib/trader/alpha/not-changed.ts"] | .integrationEvidence.admissionReviews[0].reviewedFiles = ["lib/trader/alpha/not-changed.ts"]' "${TMP}/provenance-frozen.json" >"${PROVENANCE_REPO}/${PROVENANCE_PATH}"
run_provenance_case "false delivered-child file mapping rejected" 1 "${PROVENANCE_REPO}/${PROVENANCE_PATH}" "$PROVENANCE_HEAD" "$PROVENANCE_BASE" || fail=1

cp "${TMP}/provenance-frozen.json" "${PROVENANCE_REPO}/${PROVENANCE_PATH}"

git -C "$PROVENANCE_REPO" checkout -qb rogue-diff "$PROVENANCE_HEAD"
mkdir -p "${PROVENANCE_REPO}/lib/trader/rogue"
printf 'rogue\n' >"${PROVENANCE_REPO}/lib/trader/rogue/index.ts"
git -C "$PROVENANCE_REPO" add lib/trader/rogue/index.ts
git -C "$PROVENANCE_REPO" commit -qm "unlisted implementation"
PROVENANCE_ROGUE_HEAD="$(git -C "$PROVENANCE_REPO" rev-parse HEAD)"
run_provenance_case "unlisted implementation diff and commit rejected" 1 "${PROVENANCE_REPO}/${PROVENANCE_PATH}" "$PROVENANCE_ROGUE_HEAD" "$PROVENANCE_BASE" || fail=1

git -C "$PROVENANCE_REPO" checkout -qb outside-surface "$PROVENANCE_HEAD"
mkdir -p "${PROVENANCE_REPO}/db"
printf 'schema\n' >"${PROVENANCE_REPO}/db/schema.ts"
git -C "$PROVENANCE_REPO" add db/schema.ts
git -C "$PROVENANCE_REPO" commit -qm "DEE-701 outside admitted surface"
PROVENANCE_OUTSIDE_COMMIT="$(git -C "$PROVENANCE_REPO" rev-parse HEAD)"
jq --arg commit "$PROVENANCE_OUTSIDE_COMMIT" '
  .includedChildren[0].integratedCommits = [$commit] |
  .includedChildren[0].actualFiles = ["db/schema.ts"] |
  .integrationEvidence.admissionReviews[0].reviewedCommits = [$commit] |
  .integrationEvidence.admissionReviews[0].reviewedFiles = ["db/schema.ts"]
' "${TMP}/provenance-frozen.json" >"${PROVENANCE_REPO}/${PROVENANCE_PATH}"
git -C "$PROVENANCE_REPO" add "$PROVENANCE_PATH"
git -C "$PROVENANCE_REPO" commit -qm "freeze outside admitted surface"
PROVENANCE_OUTSIDE_HEAD="$(git -C "$PROVENANCE_REPO" rev-parse HEAD)"
run_provenance_case "delivered file outside admitted expected surface rejected" 1 "${PROVENANCE_REPO}/${PROVENANCE_PATH}" "$PROVENANCE_OUTSIDE_HEAD" "$PROVENANCE_BASE" || fail=1

if [[ "$fail" -ne 0 ]]; then
  echo "Some Integration Train manifest tests failed." >&2
  exit 1
fi

echo "All Integration Train manifest regression tests passed."
