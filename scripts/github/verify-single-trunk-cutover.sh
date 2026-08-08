#!/usr/bin/env bash
# Read-only verification of post-cutover single-trunk GitHub repository state.
#
# Usage:
#   ./scripts/github/verify-single-trunk-cutover.sh
#
# Exit 0 only when all target invariants hold.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RULESET_FILE="${ROOT}/.github/rulesets/main-protection.json"
CANONICAL_RULESET_NAME="WAIA main protection"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
repo_json="$(gh api "repos/${REPO}")"
rulesets="$(gh api "repos/${REPO}/rulesets" --paginate)"

fail=0
pass() { printf 'PASS  %s\n' "$1"; }
fail_msg() { printf 'FAIL  %s\n' "$1" >&2; fail=1; }

default_branch="$(printf '%s' "$repo_json" | jq -r .default_branch)"
[[ "$default_branch" == "main" ]] && pass "default_branch=main" || fail_msg "default_branch=${default_branch} (want main)"

[[ "$(printf '%s' "$repo_json" | jq -r .allow_squash_merge)" == "true" ]] \
  && pass "allow_squash_merge=true" || fail_msg "allow_squash_merge must be true"
[[ "$(printf '%s' "$repo_json" | jq -r .allow_merge_commit)" == "false" ]] \
  && pass "allow_merge_commit=false" || fail_msg "allow_merge_commit must be false"
[[ "$(printf '%s' "$repo_json" | jq -r .allow_rebase_merge)" == "false" ]] \
  && pass "allow_rebase_merge=false" || fail_msg "allow_rebase_merge must be false"
[[ "$(printf '%s' "$repo_json" | jq -r .allow_auto_merge)" == "false" ]] \
  && pass "allow_auto_merge=false" || fail_msg "allow_auto_merge must be false"
[[ "$(printf '%s' "$repo_json" | jq -r .delete_branch_on_merge)" == "true" ]] \
  && pass "delete_branch_on_merge=true" || fail_msg "delete_branch_on_merge must be true"

canonical_count="$(
  printf '%s\n' "$rulesets" \
    | jq -r --arg name "$CANONICAL_RULESET_NAME" '[.[] | select(.name == $name)] | length'
)"
[[ "$canonical_count" -eq 1 ]] \
  && pass "exactly one '${CANONICAL_RULESET_NAME}' ruleset" \
  || fail_msg "expected exactly one '${CANONICAL_RULESET_NAME}' (found ${canonical_count})"

if [[ "$canonical_count" -eq 1 ]]; then
  cid="$(printf '%s\n' "$rulesets" | jq -r --arg name "$CANONICAL_RULESET_NAME" '.[] | select(.name == $name) | .id')"
  detail="$(gh api "repos/${REPO}/rulesets/${cid}")"
  includes="$(printf '%s' "$detail" | jq -c '.conditions.ref_name.include')"
  [[ "$includes" == '["refs/heads/main"]' ]] \
    && pass "canonical ruleset targets refs/heads/main only" \
    || fail_msg "canonical ruleset include=${includes}"

  for ctx in lint typecheck "unit tests" build "e2e tests" "PR governance"; do
    if printf '%s' "$detail" | jq -e --arg c "$ctx" '
      .rules[] | select(.type=="required_status_checks") |
      .parameters.required_status_checks[] | select(.context==$c)
    ' >/dev/null; then
      pass "required check: ${ctx}"
    else
      fail_msg "missing required check: ${ctx}"
    fi
  done

  if printf '%s' "$detail" | jq -e '
    .rules[] | select(.type=="deletion")
  ' >/dev/null; then
    pass "deletion protection present"
  else
    fail_msg "deletion protection missing"
  fi
  if printf '%s' "$detail" | jq -e '
    .rules[] | select(.type=="non_fast_forward")
  ' >/dev/null; then
    pass "non-fast-forward protection present"
  else
    fail_msg "non-fast-forward protection missing"
  fi
  if printf '%s' "$detail" | jq -e '
    .rules[] | select(.type=="pull_request")
  ' >/dev/null; then
    pass "pull_request requirement present"
  else
    fail_msg "pull_request requirement missing"
  fi
fi

for obsolete in "WAIA dev + main protection" "dev"; do
  oc="$(printf '%s\n' "$rulesets" | jq -r --arg name "$obsolete" '[.[] | select(.name == $name)] | length')"
  [[ "$oc" -eq 0 ]] && pass "obsolete ruleset absent: ${obsolete}" \
    || fail_msg "obsolete ruleset still present: ${obsolete} (count=${oc})"
done

# Legacy short-name "main" ruleset (not the canonical "WAIA main protection") must be gone.
legacy_main_count="$(
  printf '%s\n' "$rulesets" \
    | jq -r '[.[] | select(.name == "main")] | length'
)"
[[ "$legacy_main_count" -eq 0 ]] \
  && pass "legacy short-name ruleset 'main' absent" \
  || fail_msg "legacy short-name ruleset 'main' still present (count=${legacy_main_count})"

# `dev` branch may still exist (frozen); do not require deletion.
if git -C "$ROOT" ls-remote --heads origin dev | grep -q .; then
  pass "frozen legacy branch refs/heads/dev still exists (expected during retirement window)"
else
  pass "refs/heads/dev already deleted (post-retirement)"
fi

# Tracked ruleset file exists
[[ -f "$RULESET_FILE" ]] && pass "tracked ruleset file present" || fail_msg "missing ${RULESET_FILE}"

echo
if [[ "$fail" -ne 0 ]]; then
  echo "verify-single-trunk-cutover: FAILED" >&2
  exit 1
fi
echo "verify-single-trunk-cutover: OK"
exit 0
