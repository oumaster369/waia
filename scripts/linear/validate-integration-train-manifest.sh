#!/usr/bin/env bash
# Validate a frozen AI-TRADER Integration Train manifest.
# Usage: ./scripts/linear/validate-integration-train-manifest.sh <manifest.json> [DEE-NN] [frozen|admission|any]

set -euo pipefail

MANIFEST_PATH="${1:-}"
EXPECTED_INTEGRATION_ISSUE="${2:-}"
VALIDATION_PHASE="${3:-frozen}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GIT_ROOT="${INTEGRATION_TRAIN_GIT_ROOT:-$ROOT}"
REQUIRE_GIT_PROVENANCE="${INTEGRATION_TRAIN_REQUIRE_GIT_PROVENANCE:-1}"

if [[ -z "$MANIFEST_PATH" ]]; then
  echo "usage: $0 <manifest.json> [DEE-NN] [frozen|admission|any]" >&2
  exit 2
fi

if [[ "$VALIDATION_PHASE" != "frozen" && "$VALIDATION_PHASE" != "admission" && "$VALIDATION_PHASE" != "any" ]]; then
  echo "validation phase must be frozen, admission, or any" >&2
  exit 2
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Integration Train manifest not found: ${MANIFEST_PATH}" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Integration Train manifest validation requires jq." >&2
  exit 1
fi

if ! jq -e . "$MANIFEST_PATH" >/dev/null 2>&1; then
  echo "Integration Train manifest is not valid JSON: ${MANIFEST_PATH}" >&2
  exit 1
fi

failures=()
add_failure() { failures+=("$1"); }

jq_ok() {
  jq -e "$1" "$MANIFEST_PATH" >/dev/null 2>&1
}

sha256_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    return 1
  fi
}

surface_root() {
  local value="$1"
  value="${value%%\**}"
  value="${value%%\?*}"
  value="${value%/}"
  printf '%s' "$value"
}

surfaces_overlap() {
  local left right left_root right_root
  left="$1"
  right="$2"
  left_root="$(surface_root "$left")"
  right_root="$(surface_root "$right")"
  [[ "$left" == "$right" ]] && return 0
  [[ -n "$left_root" && -n "$right_root" ]] || return 1
  [[ "$left_root" == "$right_root" ]] && return 0
  [[ "$left_root" == "$right_root/"* || "$right_root" == "$left_root/"* ]]
}

file_matches_surface() {
  local file="$1"
  local surface="$2"
  if [[ "$surface" == *"*"* || "$surface" == *"?"* ]]; then
    [[ "$file" == $surface ]]
    return
  fi
  [[ "$file" == "$surface" || "$file" == "$surface/"* ]]
}

integration_issue="$(jq -r '.integrationIssue // empty' "$MANIFEST_PATH")"
risk_tier="$(jq -r '.riskTier // empty' "$MANIFEST_PATH")"
human_gate_policy="$(jq -r '.humanGatePolicy // empty' "$MANIFEST_PATH")"
manifest_status="$(jq -r '.status // empty' "$MANIFEST_PATH")"
included_count="$(jq -r 'if (.includedChildren | type) == "array" then (.includedChildren | length) else 0 end' "$MANIFEST_PATH")"

if [[ "$VALIDATION_PHASE" == "any" ]]; then
  if [[ "$manifest_status" == "admitted" ]]; then
    VALIDATION_PHASE="admission"
  else
    VALIDATION_PHASE="frozen"
  fi
fi

[[ "$(jq -r '.schemaVersion // empty' "$MANIFEST_PATH")" == "waia-trader-integration-train/v1" ]] \
  || add_failure 'schemaVersion must be `waia-trader-integration-train/v1`.'
[[ "$integration_issue" =~ ^DEE-[0-9]+$ ]] \
  || add_failure 'integrationIssue must be a DEE-NN identifier.'
if [[ -n "$EXPECTED_INTEGRATION_ISSUE" && "$integration_issue" != "$EXPECTED_INTEGRATION_ISSUE" ]]; then
  add_failure "integrationIssue ${integration_issue:-missing} does not match expected ${EXPECTED_INTEGRATION_ISSUE}."
fi
if [[ "$VALIDATION_PHASE" == "admission" ]]; then
  [[ "$manifest_status" == "admitted" ]] \
    || add_failure 'status must be `admitted` for pre-implementation admission.'
else
  [[ "$manifest_status" == "frozen" ]] \
    || add_failure 'status must be `frozen` before PR publication.'
fi
[[ "$risk_tier" =~ ^T[0-3]$ ]] \
  || add_failure 'riskTier must be T0–T3; T4 is never train-eligible.'
[[ "$(jq -r '.maxConcurrentImplementationTasks // empty' "$MANIFEST_PATH")" == "2" ]] \
  || add_failure 'maxConcurrentImplementationTasks must be exactly 2.'
[[ "$(jq -r '.finalIntegrationMode // empty' "$MANIFEST_PATH")" == "serialized" ]] \
  || add_failure 'finalIntegrationMode must be `serialized`.'
[[ "$(jq -r '.mergeMode // empty' "$MANIFEST_PATH")" == "squash" ]] \
  || add_failure 'mergeMode must be `squash`.'

if [[ "$included_count" -lt 2 ]]; then
  add_failure 'Integration Train manifests require at least two included children; use single-issue mode otherwise.'
fi
if [[ "$included_count" -gt 5 ]] && ! jq_ok '(.splitRationale | type) == "string" and (.splitRationale | length) > 0'; then
  add_failure 'More than five included children requires a non-empty splitRationale under the existing reviewability policy.'
fi

if [[ "$risk_tier" == "T3" ]]; then
  [[ "$human_gate_policy" == "t3-scope-preauthorized" ]] \
    || add_failure 'T3 trains require humanGatePolicy `t3-scope-preauthorized`.'
else
  [[ "$human_gate_policy" == "none" ]] \
    || add_failure 'T0–T2 trains require humanGatePolicy `none`; Human-gated work must split.'
fi

jq_ok '(.includedChildren | type) == "array" and (.deferredChildren | type) == "array" and (.integrationEvidence | type) == "object"' \
  || add_failure 'includedChildren, deferredChildren, and integrationEvidence must have the required array/object shapes.'

jq_ok '([.includedChildren[].issue] | length) == ([.includedChildren[].issue] | unique | length)' \
  || add_failure 'includedChildren contains duplicate issue identifiers.'
jq_ok '([.deferredChildren[].issue] | length) == ([.deferredChildren[].issue] | unique | length)' \
  || add_failure 'deferredChildren contains duplicate issue identifiers.'
jq_ok '([.includedChildren[].issue] + [.deferredChildren[].issue] | length) == ([.includedChildren[].issue] + [.deferredChildren[].issue] | unique | length)' \
  || add_failure 'An issue cannot be both included and deferred.'

if ! jq -e --arg integrationIssue "$integration_issue" \
  'all((.includedChildren + .deferredChildren)[]; .issue != $integrationIssue)' \
  "$MANIFEST_PATH" >/dev/null 2>&1; then
  add_failure 'The Integration Batch issue cannot also be an included or deferred child.'
fi

if [[ "$VALIDATION_PHASE" == "admission" ]]; then
  if ! jq -e --arg tier "$risk_tier" --arg gate "$human_gate_policy" '
    all(.includedChildren[];
      (.issue | type) == "string" and (.issue | test("^DEE-[0-9]+$")) and
      .deliveryStatus == "planned" and .blocked == false and
      (.scope | type) == "string" and (.scope | length) > 0 and
      (.dependencies | type) == "array" and all(.dependencies[]; type == "string" and test("^DEE-[0-9]+$")) and
      (.dependencyEvidence | type) == "array" and (.dependencyEvidence | length) > 0 and all(.dependencyEvidence[]; type == "string" and length > 0) and
      (.expectedFileOrSchemaSurfaces | type) == "array" and (.expectedFileOrSchemaSurfaces | length) > 0 and all(.expectedFileOrSchemaSurfaces[]; type == "string" and length > 0) and
      .riskTier == $tier and
      (.humanGate | type) == "object" and .humanGate.status == $gate and
      (.humanGate.evidence | type) == "string" and (.humanGate.evidence | length) > 0 and
      (.expectedAcceptanceEvidence | type) == "array" and (.expectedAcceptanceEvidence | length) > 0 and all(.expectedAcceptanceEvidence[]; type == "string" and length > 0) and
      (.expectedTests | type) == "array" and (.expectedTests | length) > 0 and all(.expectedTests[]; type == "string" and length > 0) and
      (.execution | type) == "object" and
      (.execution.wave | type) == "number" and (.execution.wave | floor) == .execution.wave and .execution.wave >= 1 and
      (.execution.mode == "serialized" or .execution.mode == "parallel")
    ) and
    .integrationEvidence.admissionEvidence.status == "pass" and
    (.integrationEvidence.admissionEvidence.reviewer | type) == "string" and
    (.integrationEvidence.admissionEvidence.reviewer | length) > 0
    ' "$MANIFEST_PATH" >/dev/null 2>&1; then
    add_failure 'Admission manifests must pre-enumerate every planned child with dependency/scope/surface/tier/gate/expected-evidence/test data and a passing admission review.'
  fi
fi

if [[ "$VALIDATION_PHASE" == "frozen" ]] && ! jq -e --arg tier "$risk_tier" --arg gate "$human_gate_policy" '
  all(.includedChildren[];
    (.issue | type) == "string" and (.issue | test("^DEE-[0-9]+$")) and
    .deliveryStatus == "delivered" and .blocked == false and
    (.scope | type) == "string" and (.scope | length) > 0 and
    (.dependencies | type) == "array" and all(.dependencies[]; type == "string" and test("^DEE-[0-9]+$")) and
    (.dependencyEvidence | type) == "array" and (.dependencyEvidence | length) > 0 and all(.dependencyEvidence[]; type == "string" and length > 0) and
    (.expectedFileOrSchemaSurfaces | type) == "array" and (.expectedFileOrSchemaSurfaces | length) > 0 and all(.expectedFileOrSchemaSurfaces[]; type == "string" and length > 0) and
    (.actualFiles | type) == "array" and (.actualFiles | length) > 0 and all(.actualFiles[]; type == "string" and length > 0) and
    .riskTier == $tier and
    (.humanGate | type) == "object" and .humanGate.status == $gate and
    (.humanGate.evidence | type) == "string" and (.humanGate.evidence | length) > 0 and
    (.expectedAcceptanceEvidence | type) == "array" and (.expectedAcceptanceEvidence | length) > 0 and all(.expectedAcceptanceEvidence[]; type == "string" and length > 0) and
    (.expectedTests | type) == "array" and (.expectedTests | length) > 0 and all(.expectedTests[]; type == "string" and length > 0) and
    (.acceptanceEvidence | type) == "array" and (.acceptanceEvidence | length) > 0 and all(.acceptanceEvidence[]; type == "string" and length > 0) and
    (.integratedCommits | type) == "array" and (.integratedCommits | length) > 0 and
    all(.integratedCommits[]; type == "string" and test("^[0-9a-f]{40}$")) and
    (.tests | type) == "array" and (.tests | length) > 0 and all(.tests[]; type == "string" and length > 0) and
    (.execution | type) == "object" and
    (.execution.wave | type) == "number" and (.execution.wave | floor) == .execution.wave and .execution.wave >= 1 and
    (.execution.mode == "serialized" or .execution.mode == "parallel")
  )' "$MANIFEST_PATH" >/dev/null 2>&1; then
  add_failure 'Every included child must be delivered, unblocked, tier/gate coherent, and carry complete dependency/scope/surface/commit/acceptance/test evidence.'
fi

if ! jq -e '
  all(.deferredChildren[];
    (.issue | type) == "string" and (.issue | test("^DEE-[0-9]+$")) and
    (.reason | type) == "string" and (.reason | length) > 0 and
    .completionClaimed == false
  )' "$MANIFEST_PATH" >/dev/null 2>&1; then
  add_failure 'Every deferred child requires a reason and completionClaimed=false.'
fi

if [[ "$VALIDATION_PHASE" == "frozen" ]]; then
  jq_ok '[.includedChildren[].integratedCommits[]] | length == (unique | length)' \
    || add_failure 'Integrated commits must map to exactly one included child.'
fi

if ! jq -e '
  ([.includedChildren[].execution.wave] | unique | sort) as $waves |
  ($waves | length) > 0 and $waves == [range(1; (($waves | max) + 1))]
' "$MANIFEST_PATH" >/dev/null 2>&1; then
  add_failure 'Execution waves must be contiguous positive integers starting at 1.'
fi

if ! jq -e '
  .includedChildren as $children |
  all($children[];
    . as $child |
    all($child.dependencies[];
      . as $dependency |
      ([ $children[] | select(.issue == $dependency) | .execution.wave ][0] // -1) < $child.execution.wave
    )
  )
' "$MANIFEST_PATH" >/dev/null 2>&1; then
  add_failure 'Every included-child dependency must be scheduled in an earlier execution wave.'
fi

if ! jq -e '
  [.deferredChildren[].issue] as $deferred |
  all(.includedChildren[];
    all(.dependencies[]; . as $dependency | ($deferred | index($dependency)) == null)
  )
' "$MANIFEST_PATH" >/dev/null 2>&1; then
  add_failure 'A delivered child cannot depend on a deferred or removed child.'
fi

execution_waves="$(jq -r '[.includedChildren[].execution.wave] | unique | sort[]?' "$MANIFEST_PATH")"
while IFS= read -r wave; do
  [[ -z "$wave" ]] && continue
  wave_count="$(jq -r --argjson wave "$wave" '[.includedChildren[] | select(.execution.wave == $wave)] | length' "$MANIFEST_PATH")"
  if [[ "$wave_count" -gt 2 ]]; then
    add_failure "Execution wave ${wave} exceeds the two-task concurrency limit."
    continue
  fi
  if [[ "$wave_count" -eq 1 ]]; then
    if ! jq -e --argjson wave "$wave" '
      all(.includedChildren[] | select(.execution.wave == $wave);
        .execution.mode == "serialized" and ((.execution.parallelGroup // null) == null)
      )
    ' "$MANIFEST_PATH" >/dev/null 2>&1; then
      add_failure "Single-child execution wave ${wave} must be serialized without a parallel group."
    fi
    continue
  fi

  if ! jq -e --argjson wave "$wave" '
    [.includedChildren[] | select(.execution.wave == $wave)] as $children |
    ([ $children[].execution.parallelGroup ] | unique | length) == 1 and
    all($children[];
      .execution.mode == "parallel" and
      (.execution.parallelGroup | type) == "string" and (.execution.parallelGroup | length) > 0 and
      .execution.dependencyCompatible == true and
      .execution.overlap == "none" and
      .execution.competingMigration == false and
      .execution.sharedCanonicalIdentity == false and
      .execution.sharedAuthoritySchema == false and
      .execution.mutualInvalidationRisk == false
    )
  ' "$MANIFEST_PATH" >/dev/null 2>&1; then
    add_failure "Two-child execution wave ${wave} must be one dependency-compatible parallel group with every collision/invalidation flag fail-closed."
  fi

  left_issue="$(jq -r --argjson wave "$wave" '[.includedChildren[] | select(.execution.wave == $wave) | .issue][0] // empty' "$MANIFEST_PATH")"
  right_issue="$(jq -r --argjson wave "$wave" '[.includedChildren[] | select(.execution.wave == $wave) | .issue][1] // empty' "$MANIFEST_PATH")"
  if [[ -n "$left_issue" && -n "$right_issue" ]]; then
    while IFS= read -r left; do
      while IFS= read -r right; do
        if surfaces_overlap "$left" "$right"; then
          add_failure "Execution wave ${wave} declares overlapping expected file/schema surfaces: ${left} <> ${right}."
        fi
      done < <(jq -r --arg issue "$right_issue" '.includedChildren[] | select(.issue == $issue) | .expectedFileOrSchemaSurfaces[]' "$MANIFEST_PATH")
    done < <(jq -r --arg issue "$left_issue" '.includedChildren[] | select(.issue == $issue) | .expectedFileOrSchemaSurfaces[]' "$MANIFEST_PATH")
    if [[ "$VALIDATION_PHASE" == "frozen" ]]; then
      while IFS= read -r left; do
        while IFS= read -r right; do
          if surfaces_overlap "$left" "$right"; then
            add_failure "Execution wave ${wave} contains overlapping actual files: ${left} <> ${right}."
          fi
        done < <(jq -r --arg issue "$right_issue" '.includedChildren[] | select(.issue == $issue) | .actualFiles[]' "$MANIFEST_PATH")
      done < <(jq -r --arg issue "$left_issue" '.includedChildren[] | select(.issue == $issue) | .actualFiles[]' "$MANIFEST_PATH")
    fi
  fi
done <<<"$execution_waves"

if [[ "$VALIDATION_PHASE" == "frozen" ]] && ! jq -e '
  .includedChildren as $children |
  [$children[].issue] as $ids |
  .integrationEvidence.admissionReviews as $reviews |
  .integrationEvidence.cumulativeChecks as $checks |
  ([$reviews[].issue] | sort) == ($ids | sort) and
  all($reviews[];
    .status == "pass" and
    (.reviewedCommits | type) == "array" and (.reviewedCommits | length) > 0 and
    (.reviewedFiles | type) == "array" and (.reviewedFiles | length) > 0
  ) and
  all($children[];
    . as $child |
    ([$reviews[] | select(.issue == $child.issue)][0]) as $review |
    ($review.reviewedCommits | sort) == ($child.integratedCommits | sort) and
    ($review.reviewedFiles | sort) == ($child.actualFiles | sort)
  ) and
  ([$checks[].afterIssue] | sort) == ($ids | sort) and
  all($checks[];
    .status == "pass" and (.commands | type) == "array" and (.commands | length) > 0
  ) and
  .integrationEvidence.preImplementationAdmission.status == "pass" and
  (.integrationEvidence.preImplementationAdmission.manifestDigest | type) == "string" and
  (.integrationEvidence.preImplementationAdmission.manifestDigest | test("^[0-9a-f]{64}$")) and
  (.integrationEvidence.preImplementationAdmission.manifestCommit | type) == "string" and
  (.integrationEvidence.preImplementationAdmission.manifestCommit | test("^[0-9a-f]{40}$")) and
  (.integrationEvidence.preImplementationAdmission.manifestPath | type) == "string" and
  (.integrationEvidence.preImplementationAdmission.manifestPath | test("^docs/plans/dee-[0-9]+-[a-z0-9-]+\\.integration-train\\.json$")) and
  (.integrationEvidence.preImplementationAdmission.reviewer | type) == "string" and
  (.integrationEvidence.preImplementationAdmission.reviewer | length) > 0 and
  .integrationEvidence.fullDiffFrozen == true and
  .integrationEvidence.finalAdversarialReviewRequired == true
  ' "$MANIFEST_PATH" >/dev/null 2>&1; then
  add_failure 'Integration evidence must prove pre-implementation admission, map reviewed diffs and cumulative passing checks to every included child, and freeze the full diff for final review.'
fi

if [[ "$VALIDATION_PHASE" == "frozen" && "$REQUIRE_GIT_PROVENANCE" == "1" ]]; then
  admission_commit="$(jq -r '.integrationEvidence.preImplementationAdmission.manifestCommit // empty' "$MANIFEST_PATH")"
  admission_path="$(jq -r '.integrationEvidence.preImplementationAdmission.manifestPath // empty' "$MANIFEST_PATH")"
  admission_digest="$(jq -r '.integrationEvidence.preImplementationAdmission.manifestDigest // empty' "$MANIFEST_PATH")"
  effective_head="${PR_HEAD_SHA:-$(git -C "$GIT_ROOT" rev-parse HEAD 2>/dev/null || true)}"
  manifest_relative_path=""
  case "$MANIFEST_PATH" in
    "$GIT_ROOT"/*) manifest_relative_path="${MANIFEST_PATH#"$GIT_ROOT"/}" ;;
  esac

  if [[ -z "$effective_head" || ! "$effective_head" =~ ^[0-9a-f]{40}$ ]]; then
    add_failure 'Git provenance validation requires a resolvable exact head commit.'
  elif ! git -C "$GIT_ROOT" cat-file -e "${effective_head}^{commit}" 2>/dev/null; then
    add_failure "Exact head ${effective_head} is not a commit in the validation repository."
  elif [[ -n "${PR_HEAD_SHA:-}" && "$(git -C "$GIT_ROOT" rev-parse HEAD 2>/dev/null || true)" != "$PR_HEAD_SHA" ]]; then
    add_failure 'Checked-out HEAD does not equal PR_HEAD_SHA for Integration Train provenance validation.'
  fi

  if [[ -z "$manifest_relative_path" || "$admission_path" != "$manifest_relative_path" ]]; then
    add_failure 'Pre-implementation admission manifestPath must equal the current repository-relative manifest path.'
  fi

  if [[ ! "$admission_commit" =~ ^[0-9a-f]{40}$ ]] || ! git -C "$GIT_ROOT" cat-file -e "${admission_commit}^{commit}" 2>/dev/null; then
    add_failure 'Pre-implementation admission manifestCommit is missing or not present in Git history.'
  elif [[ -n "$effective_head" ]] && ! git -C "$GIT_ROOT" merge-base --is-ancestor "$admission_commit" "$effective_head" 2>/dev/null; then
    add_failure 'Pre-implementation admission manifestCommit is not an ancestor of the exact head.'
  fi

  if [[ -n "${PR_BASE_SHA:-}" ]]; then
    if [[ ! "$PR_BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || ! git -C "$GIT_ROOT" cat-file -e "${PR_BASE_SHA}^{commit}" 2>/dev/null; then
      add_failure 'PR_BASE_SHA is not a commit in the validation repository.'
    elif [[ -n "$admission_commit" ]] && ! git -C "$GIT_ROOT" merge-base --is-ancestor "$PR_BASE_SHA" "$admission_commit" 2>/dev/null; then
      add_failure 'The admitted manifest commit is outside the current PR base→head history.'
    fi
  fi

  admitted_tmp="$(mktemp "${TMPDIR:-/tmp}/waia-admitted-manifest.XXXXXX")"
  if [[ -z "$admission_commit" || -z "$admission_path" ]] || ! git -C "$GIT_ROOT" show "${admission_commit}:${admission_path}" >"$admitted_tmp" 2>/dev/null; then
    add_failure 'The admitted predecessor manifest does not exist at manifestCommit:manifestPath.'
  else
    actual_admission_digest="$(sha256_file "$admitted_tmp" 2>/dev/null || true)"
    [[ -n "$actual_admission_digest" && "$actual_admission_digest" == "$admission_digest" ]] \
      || add_failure 'The admitted predecessor manifest digest is forged or stale.'

    if ! INTEGRATION_TRAIN_REQUIRE_GIT_PROVENANCE=0 "$0" "$admitted_tmp" "$integration_issue" admission >/dev/null 2>&1; then
      add_failure 'The historical predecessor file is not a valid admitted manifest.'
    fi

    admitted_inventory="$(jq -S -c '([.includedChildren[].issue] + [.deferredChildren[].issue]) | sort' "$admitted_tmp" 2>/dev/null || true)"
    frozen_inventory="$(jq -S -c '([.includedChildren[].issue] + [.deferredChildren[].issue]) | sort' "$MANIFEST_PATH" 2>/dev/null || true)"
    [[ -n "$admitted_inventory" && "$admitted_inventory" == "$frozen_inventory" ]] \
      || add_failure 'Frozen child inventory must exactly partition the pre-enumerated admitted inventory; children may move to deferred but may not appear or disappear.'

    admitted_policy="$(jq -S -c '{integrationIssue,riskTier,humanGatePolicy,maxConcurrentImplementationTasks,finalIntegrationMode,mergeMode}' "$admitted_tmp" 2>/dev/null || true)"
    frozen_policy="$(jq -S -c '{integrationIssue,riskTier,humanGatePolicy,maxConcurrentImplementationTasks,finalIntegrationMode,mergeMode}' "$MANIFEST_PATH" 2>/dev/null || true)"
    [[ -n "$admitted_policy" && "$admitted_policy" == "$frozen_policy" ]] \
      || add_failure 'Frozen train policy identity drifted from the admitted predecessor.'

    while IFS= read -r child_issue; do
      [[ -z "$child_issue" ]] && continue
      admitted_child="$(jq -S -c --arg issue "$child_issue" '
        [.includedChildren[] | select(.issue == $issue) |
          {issue,scope,dependencies,dependencyEvidence,expectedFileOrSchemaSurfaces,riskTier,humanGate,expectedAcceptanceEvidence,expectedTests,execution}
        ][0] // null
      ' "$admitted_tmp" 2>/dev/null || true)"
      frozen_child="$(jq -S -c --arg issue "$child_issue" '
        [.includedChildren[] | select(.issue == $issue) |
          {issue,scope,dependencies,dependencyEvidence,expectedFileOrSchemaSurfaces,riskTier,humanGate,expectedAcceptanceEvidence,expectedTests,execution}
        ][0] // null
      ' "$MANIFEST_PATH" 2>/dev/null || true)"
      [[ "$admitted_child" != "null" && "$admitted_child" == "$frozen_child" ]] \
        || add_failure "Delivered child ${child_issue} was not pre-enumerated with the same admitted scope/dependencies/surfaces/tier/gate/tests/order."
    done < <(jq -r '.includedChildren[].issue' "$MANIFEST_PATH")
  fi
  rm -f "$admitted_tmp"

  while IFS= read -r child_issue; do
    [[ -z "$child_issue" ]] && continue
    child_files_tmp="$(mktemp "${TMPDIR:-/tmp}/waia-child-files.XXXXXX")"
    : >"$child_files_tmp"
    while IFS= read -r child_commit; do
      [[ -z "$child_commit" ]] && continue
      if ! git -C "$GIT_ROOT" cat-file -e "${child_commit}^{commit}" 2>/dev/null; then
        add_failure "Delivered child ${child_issue} references nonexistent commit ${child_commit}."
        continue
      fi
      if [[ "$child_commit" == "$admission_commit" ]] || ! git -C "$GIT_ROOT" merge-base --is-ancestor "$admission_commit" "$child_commit" 2>/dev/null; then
        add_failure "Delivered child ${child_issue} commit ${child_commit} is not after pre-implementation admission."
      fi
      if [[ -n "$effective_head" ]] && ! git -C "$GIT_ROOT" merge-base --is-ancestor "$child_commit" "$effective_head" 2>/dev/null; then
        add_failure "Delivered child ${child_issue} commit ${child_commit} is outside the exact head history."
      fi
      if [[ -n "${PR_BASE_SHA:-}" ]] && ! git -C "$GIT_ROOT" merge-base --is-ancestor "$PR_BASE_SHA" "$child_commit" 2>/dev/null; then
        add_failure "Delivered child ${child_issue} commit ${child_commit} is outside the current PR base→head history."
      fi
      git -C "$GIT_ROOT" diff-tree --root --no-commit-id --name-only -r "$child_commit" 2>/dev/null >>"$child_files_tmp" || true
    done < <(jq -r --arg issue "$child_issue" '.includedChildren[] | select(.issue == $issue) | .integratedCommits[]' "$MANIFEST_PATH")

    actual_commit_files="$(sort -u "$child_files_tmp" | sed '/^$/d')"
    declared_child_files="$(jq -r --arg issue "$child_issue" '.includedChildren[] | select(.issue == $issue) | .actualFiles[]' "$MANIFEST_PATH" | sort -u)"
    [[ -n "$actual_commit_files" && "$actual_commit_files" == "$declared_child_files" ]] \
      || add_failure "Delivered child ${child_issue} actualFiles does not exactly match its integrated commit diff."

    while IFS= read -r actual_file; do
      [[ -z "$actual_file" ]] && continue
      matched_surface=0
      while IFS= read -r expected_surface; do
        if file_matches_surface "$actual_file" "$expected_surface"; then
          matched_surface=1
          break
        fi
      done < <(jq -r --arg issue "$child_issue" '.includedChildren[] | select(.issue == $issue) | .expectedFileOrSchemaSurfaces[]' "$MANIFEST_PATH")
      [[ "$matched_surface" -eq 1 ]] \
        || add_failure "Delivered child ${child_issue} file ${actual_file} is outside every admitted expected file/schema surface."
    done <<<"$declared_child_files"
    rm -f "$child_files_tmp"
  done < <(jq -r '.includedChildren[].issue' "$MANIFEST_PATH")

  if [[ -n "${PR_BASE_SHA:-}" && -n "$effective_head" && -n "$admission_commit" && -n "$manifest_relative_path" ]]; then
    integration_plan_path="${manifest_relative_path%.integration-train.json}.md"
    integration_files_tmp="$(mktemp "${TMPDIR:-/tmp}/waia-integration-files.XXXXXX")"
    child_files_union_tmp="$(mktemp "${TMPDIR:-/tmp}/waia-child-files-union.XXXXXX")"
    pr_diff_files_tmp="$(mktemp "${TMPDIR:-/tmp}/waia-pr-diff-files.XXXXXX")"
    mapped_commits_tmp="$(mktemp "${TMPDIR:-/tmp}/waia-mapped-commits.XXXXXX")"
    unexpected_files_tmp="$(mktemp "${TMPDIR:-/tmp}/waia-unexpected-files.XXXXXX")"

    printf '%s\n%s\n' "$integration_plan_path" "$manifest_relative_path" | sort -u >"$integration_files_tmp"
    jq -r '.includedChildren[].actualFiles[]' "$MANIFEST_PATH" | sort -u >"$child_files_union_tmp"
    jq -r '.includedChildren[].integratedCommits[]' "$MANIFEST_PATH" | sort -u >"$mapped_commits_tmp"
    git -C "$GIT_ROOT" diff --name-only "${PR_BASE_SHA}...${effective_head}" | sort -u >"$pr_diff_files_tmp"

    cat "$integration_files_tmp" "$child_files_union_tmp" | sort -u >"${unexpected_files_tmp}.allowed"
    comm -23 "$pr_diff_files_tmp" "${unexpected_files_tmp}.allowed" >"$unexpected_files_tmp"
    if [[ -s "$unexpected_files_tmp" ]]; then
      add_failure "PR diff contains files outside all delivered children and the integration-owned plan/manifest set: $(tr '\n' ' ' <"$unexpected_files_tmp" | sed 's/[[:space:]]*$//')."
    fi

    comm -23 "$child_files_union_tmp" "$pr_diff_files_tmp" >"$unexpected_files_tmp"
    if [[ -s "$unexpected_files_tmp" ]]; then
      add_failure 'One or more child actualFiles are absent from the exact PR base→head diff.'
    fi

    git -C "$GIT_ROOT" diff --name-only "${PR_BASE_SHA}...${admission_commit}" | sort -u >"${unexpected_files_tmp}.before-admission"
    comm -23 "${unexpected_files_tmp}.before-admission" "$integration_files_tmp" >"$unexpected_files_tmp"
    if [[ -s "$unexpected_files_tmp" ]]; then
      add_failure 'Pre-admission PR changes may contain only the integration-owned plan and admitted manifest.'
    fi

    while IFS= read -r range_commit; do
      [[ -z "$range_commit" ]] && continue
      if grep -qx "$range_commit" "$mapped_commits_tmp"; then
        continue
      fi
      git -C "$GIT_ROOT" diff-tree -m --root --no-commit-id --name-only -r "$range_commit" 2>/dev/null | sort -u >"${unexpected_files_tmp}.commit"
      comm -23 "${unexpected_files_tmp}.commit" "$integration_files_tmp" >"$unexpected_files_tmp"
      if [[ -s "$unexpected_files_tmp" ]]; then
        add_failure "Post-admission commit ${range_commit} is not mapped to a delivered child and changes non-integration files."
      fi
    done < <(git -C "$GIT_ROOT" rev-list --reverse "${admission_commit}..${effective_head}")

    rm -f "$integration_files_tmp" "$child_files_union_tmp" "$pr_diff_files_tmp" "$mapped_commits_tmp" "$unexpected_files_tmp" \
      "${unexpected_files_tmp}.allowed" "${unexpected_files_tmp}.before-admission" "${unexpected_files_tmp}.commit"
  fi
fi

if [[ ${#failures[@]} -gt 0 ]]; then
  printf 'Integration Train manifest failures:\n' >&2
  for failure in "${failures[@]}"; do
    printf '  - %s\n' "$failure" >&2
  done
  exit 1
fi

printf 'PASS: %s Integration Train manifest is valid (%s; %s included child issue(s))\n' "$VALIDATION_PHASE" "$integration_issue" "$included_count"
