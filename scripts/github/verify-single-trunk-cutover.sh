#!/usr/bin/env bash
# Read-only verification of post-cutover single-trunk GitHub repository state.
#
# Usage:
#   ./scripts/github/verify-single-trunk-cutover.sh
#   ./scripts/github/verify-single-trunk-cutover.sh --github-only
#
# Exit 0 only when GitHub target invariants hold AND (unless --github-only)
# the Cloudflare Human preflight record is present with an Architect contract A|B.
#
# Cloudflare Git integration is known-active for Worker waia-app; this script does
# NOT mutate Cloudflare — it only checks the operator-local recorded preflight.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/single-trunk-cutover-lib.sh
source "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh"

RULESET_FILE="${ROOT}/.github/rulesets/main-protection.json"
GITHUB_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --github-only) GITHUB_ONLY=true ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

require_cmd gh
require_cmd jq

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
if [[ "$REPO" != "$EXPECTED_REPO" ]]; then
  echo "error: repo '${REPO}' != ${EXPECTED_REPO}" >&2
  exit 1
fi

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

REQUIRED_CHECKS=(
  "lint"
  "typecheck"
  "unit tests"
  "build"
  "e2e tests"
  "PR governance"
  "tenant isolation gate"
)

if [[ "$canonical_count" -eq 1 ]]; then
  cid="$(printf '%s\n' "$rulesets" | jq -r --arg name "$CANONICAL_RULESET_NAME" '.[] | select(.name == $name) | .id')"
  detail="$(gh api "repos/${REPO}/rulesets/${cid}")"
  includes="$(printf '%s' "$detail" | jq -c '.conditions.ref_name.include')"
  [[ "$includes" == '["refs/heads/main"]' ]] \
    && pass "canonical ruleset targets refs/heads/main only" \
    || fail_msg "canonical ruleset include=${includes}"

  for ctx in "${REQUIRED_CHECKS[@]}"; do
    if printf '%s' "$detail" | jq -e --arg c "$ctx" '
      .rules[] | select(.type=="required_status_checks") |
      .parameters.required_status_checks[] | select(.context==$c)
    ' >/dev/null; then
      pass "required check: ${ctx}"
    else
      fail_msg "missing required check: ${ctx}"
    fi
  done

  if printf '%s' "$detail" | jq -e '.rules[] | select(.type=="deletion")' >/dev/null; then
    pass "deletion protection present"
  else
    fail_msg "deletion protection missing"
  fi
  if printf '%s' "$detail" | jq -e '.rules[] | select(.type=="non_fast_forward")' >/dev/null; then
    pass "non-fast-forward protection present"
  else
    fail_msg "non-fast-forward protection missing"
  fi
  if printf '%s' "$detail" | jq -e '.rules[] | select(.type=="pull_request")' >/dev/null; then
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

legacy_main_count="$(
  printf '%s\n' "$rulesets" \
    | jq -r '[.[] | select(.name == "main")] | length'
)"
[[ "$legacy_main_count" -eq 0 ]] \
  && pass "legacy short-name ruleset 'main' absent" \
  || fail_msg "legacy short-name ruleset 'main' still present (count=${legacy_main_count})"

if git ls-remote --heads origin dev | grep -q .; then
  pass "frozen legacy branch refs/heads/dev still exists (expected during retirement window)"
else
  pass "refs/heads/dev already deleted (post-retirement)"
fi

[[ -f "$RULESET_FILE" ]] && pass "tracked ruleset file present" || fail_msg "missing ${RULESET_FILE}"

# Tracked file must require tenant isolation gate
if jq -e '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[] | select(.context=="tenant isolation gate")' "$RULESET_FILE" >/dev/null; then
  pass "tracked main-protection.json requires tenant isolation gate"
else
  fail_msg "tracked main-protection.json missing tenant isolation gate"
fi

echo
echo "=== Cloudflare Human gate ==="
CF_FILE="$(waia_cutover_cloudflare_preflight_path)"
if [[ "$GITHUB_ONLY" == true ]]; then
  echo "CLOUDFLARE_HUMAN_GATE=skipped (--github-only)"
else
  if [[ ! -f "$CF_FILE" ]]; then
    fail_msg "CLOUDFLARE_HUMAN_GATE=unresolved — missing ${CF_FILE}"
    echo "Record Cloudflare Dashboard → Workers & Pages → waia-app → Settings → Builds values before cutover is complete." >&2
    echo "See docs/ops/SINGLE-TRUNK-CUTOVER.md" >&2
  else
    contract="$(jq -r '.architect_contract // empty' "$CF_FILE")"
    prod_branch="$(jq -r '.production_branch // empty' "$CF_FILE")"
    if [[ "$contract" == "A" || "$contract" == "B" ]] \
      && [[ -n "$prod_branch" ]] \
      && jq -e 'has("non_production_branch_builds_enabled") and has("production_deploy_command") and has("non_production_branch_deploy_command")' "$CF_FILE" >/dev/null; then
      pass "CLOUDFLARE_HUMAN_GATE=recorded (contract=${contract}, production_branch=${prod_branch})"
    else
      fail_msg "CLOUDFLARE_HUMAN_GATE=incomplete in ${CF_FILE} (need architect_contract A|B and branch/build fields)"
    fi
  fi
fi

echo
if [[ "$fail" -ne 0 ]]; then
  echo "verify-single-trunk-cutover: FAILED" >&2
  exit 1
fi
echo "verify-single-trunk-cutover: OK"
exit 0
