#!/usr/bin/env bash
# Shared helpers for DEE-511 single-trunk cutover / rollback / verify.
# Sourced by scripts/github/*-single-trunk-cutover.sh — not executed directly.

# shellcheck disable=SC2034

EXPECTED_REPO="oumaster369/waia"
EXPECTED_PRECUTOVER_DEFAULT_BRANCH="dev"
MIGRATION_PR_NUMBER="456"
MIGRATION_PR_HEAD="dee-511-waia-single-trunk-main"
MIGRATION_PR_BASE="main"
CANONICAL_RULESET_NAME="WAIA main protection"
LEGACY_RULESET_NAMES=("WAIA dev + main protection" "dev" "main")

# Operator-local state (never commit). Override with WAIA_CUTOVER_STATE_DIR.
waia_cutover_state_dir() {
  printf '%s' "${WAIA_CUTOVER_STATE_DIR:-${HOME}/.waia/single-trunk-cutover}"
}

waia_cutover_snapshot_path() {
  printf '%s/pre-cutover-state.json' "$(waia_cutover_state_dir)"
}

waia_cutover_cloudflare_preflight_path() {
  printf '%s/cloudflare-preflight.json' "$(waia_cutover_state_dir)"
}

# Strip read-only GitHub Ruleset GET fields into a POST/PUT-acceptable body.
# stdin: full ruleset JSON → stdout: restore body
strip_ruleset_for_restore() {
  jq '{
    name: .name,
    target: .target,
    enforcement: .enforcement,
    conditions: .conditions,
    rules: .rules,
    bypass_actors: (.bypass_actors // [])
  }'
}

# Compare two ruleset restore bodies for meaningful equality (ignore id/timestamps).
ruleset_bodies_equivalent() {
  local a="$1"
  local b="$2"
  local norm_a norm_b
  norm_a="$(printf '%s' "$a" | jq -S '{name,target,enforcement,conditions,rules,bypass_actors:(.bypass_actors//[])}')"
  norm_b="$(printf '%s' "$b" | jq -S '{name,target,enforcement,conditions,rules,bypass_actors:(.bypass_actors//[])}')"
  [[ "$norm_a" == "$norm_b" ]]
}

require_cmd() {
  local c="$1"
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "error: required command not found: $c" >&2
    return 1
  fi
}

# Preflight result accumulators (caller resets before use).
PRECUTOVER_FAIL=0
preflight_pass() { printf 'PASS  %s\n' "$1"; }
preflight_fail() { printf 'FAIL  %s\n' "$1" >&2; PRECUTOVER_FAIL=$((PRECUTOVER_FAIL + 1)); }

# Authoritative fail-closed preflight for initial GitHub cutover.
# Sets globals: REPO, AUTH_LOGIN, REPO_JSON, DEFAULT_BRANCH, MERGE_*, MAIN_SHA, DEV_SHA,
# OPEN_PRS_JSON, RULESETS_LIST_JSON, RULESET_DETAILS_JSON (object keyed by name),
# MIGRATION_MERGE_SHA, ADMIN_OK
#
# Does NOT mutate GitHub. Always prints PASS/FAIL lines.
# Returns 0 only when every required precondition passes.
run_single_trunk_cutover_preflight() {
  local root="$1"
  PRECUTOVER_FAIL=0

  require_cmd gh || return 1
  require_cmd jq || return 1
  require_cmd git || return 1

  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  if [[ "$REPO" == "$EXPECTED_REPO" ]]; then
    preflight_pass "repo identity is ${EXPECTED_REPO}"
  else
    preflight_fail "repo identity is '${REPO:-empty}' (want ${EXPECTED_REPO})"
  fi

  AUTH_LOGIN="$(gh api user --jq .login 2>/dev/null || true)"
  if [[ -n "$AUTH_LOGIN" ]]; then
    preflight_pass "gh authenticated as ${AUTH_LOGIN}"
  else
    preflight_fail "gh authentication / user login unavailable"
  fi

  REPO_JSON="$(gh api "repos/${EXPECTED_REPO}" 2>/dev/null || true)"
  if [[ -z "$REPO_JSON" ]]; then
    preflight_fail "cannot read repository API for ${EXPECTED_REPO}"
    ADMIN_OK=false
    REPO_JSON='{}'
  else
    local admin
    admin="$(printf '%s' "$REPO_JSON" | jq -r '.permissions.admin // false')"
    if [[ "$admin" == "true" ]]; then
      preflight_pass "authenticated principal has repository admin=true"
      ADMIN_OK=true
    else
      preflight_fail "authenticated principal lacks repository admin (admin=${admin})"
      ADMIN_OK=false
    fi
  fi

  if ! git -C "$root" fetch origin --prune; then
    preflight_fail "git fetch origin --prune failed"
  else
    preflight_pass "git fetch origin --prune succeeded"
  fi

  # Resolve live refs only after fetch (prefer ls-remote, then refreshed origin/*).
  MAIN_SHA="$(git -C "$root" ls-remote origin refs/heads/main | awk '{print $1}')"
  DEV_SHA="$(git -C "$root" ls-remote origin refs/heads/dev | awk '{print $1}')"
  if [[ -n "$MAIN_SHA" && "$MAIN_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    preflight_pass "refs/heads/main exists (${MAIN_SHA})"
  else
    preflight_fail "refs/heads/main missing or not a full SHA (${MAIN_SHA:-empty})"
  fi
  if [[ -n "$DEV_SHA" && "$DEV_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    preflight_pass "refs/heads/dev still exists for initial cutover (${DEV_SHA})"
  else
    preflight_fail "refs/heads/dev missing during initial cutover (${DEV_SHA:-empty})"
  fi

  # Refresh local origin refs for ancestry checks without trusting stale values.
  git -C "$root" update-ref "refs/remotes/origin/main" "$MAIN_SHA" 2>/dev/null || true
  git -C "$root" update-ref "refs/remotes/origin/dev" "$DEV_SHA" 2>/dev/null || true

  DEFAULT_BRANCH="$(printf '%s' "$REPO_JSON" | jq -r '.default_branch // empty')"
  if [[ "$DEFAULT_BRANCH" == "$EXPECTED_PRECUTOVER_DEFAULT_BRANCH" ]]; then
    preflight_pass "GitHub default_branch is pre-cutover '${EXPECTED_PRECUTOVER_DEFAULT_BRANCH}'"
  else
    preflight_fail "GitHub default_branch is '${DEFAULT_BRANCH:-empty}' (want ${EXPECTED_PRECUTOVER_DEFAULT_BRANCH})"
  fi

  # Merge settings readable
  ALLOW_SQUASH="$(printf '%s' "$REPO_JSON" | jq -r '.allow_squash_merge')"
  ALLOW_MERGE="$(printf '%s' "$REPO_JSON" | jq -r '.allow_merge_commit')"
  ALLOW_REBASE="$(printf '%s' "$REPO_JSON" | jq -r '.allow_rebase_merge')"
  ALLOW_AUTO="$(printf '%s' "$REPO_JSON" | jq -r '.allow_auto_merge')"
  DELETE_ON_MERGE="$(printf '%s' "$REPO_JSON" | jq -r '.delete_branch_on_merge')"
  if [[ -n "$ALLOW_SQUASH" && "$ALLOW_SQUASH" != "null" ]]; then
    preflight_pass "merge settings readable (squash=${ALLOW_SQUASH} merge_commit=${ALLOW_MERGE} rebase=${ALLOW_REBASE} auto_merge=${ALLOW_AUTO} delete_on_merge=${DELETE_ON_MERGE})"
  else
    preflight_fail "repository merge settings unreadable"
  fi

  # Migration PR merged into main
  local pr_json
  pr_json="$(gh pr view "$MIGRATION_PR_NUMBER" --repo "$EXPECTED_REPO" --json number,state,mergedAt,baseRefName,headRefName,mergeCommit 2>/dev/null || true)"
  if [[ -z "$pr_json" ]]; then
    preflight_fail "cannot read migration PR #${MIGRATION_PR_NUMBER}"
    MIGRATION_MERGE_SHA=""
  else
    local pr_base pr_head pr_state merge_sha
    pr_base="$(printf '%s' "$pr_json" | jq -r .baseRefName)"
    pr_head="$(printf '%s' "$pr_json" | jq -r .headRefName)"
    pr_state="$(printf '%s' "$pr_json" | jq -r .state)"
    merge_sha="$(printf '%s' "$pr_json" | jq -r '.mergeCommit.oid // empty')"
    MIGRATION_MERGE_SHA="$merge_sha"

    if [[ "$pr_base" == "$MIGRATION_PR_BASE" ]]; then
      preflight_pass "PR #${MIGRATION_PR_NUMBER} base is ${MIGRATION_PR_BASE}"
    else
      preflight_fail "PR #${MIGRATION_PR_NUMBER} base is '${pr_base}' (want ${MIGRATION_PR_BASE})"
    fi
    if [[ "$pr_head" == "$MIGRATION_PR_HEAD" ]]; then
      preflight_pass "PR #${MIGRATION_PR_NUMBER} head is ${MIGRATION_PR_HEAD}"
    else
      preflight_fail "PR #${MIGRATION_PR_NUMBER} head is '${pr_head}' (want ${MIGRATION_PR_HEAD})"
    fi
    if [[ "$pr_state" == "MERGED" && -n "$merge_sha" ]]; then
      preflight_pass "PR #${MIGRATION_PR_NUMBER} is MERGED (merge/squash commit ${merge_sha})"
    else
      preflight_fail "PR #${MIGRATION_PR_NUMBER} is not MERGED (state=${pr_state}, mergeCommit=${merge_sha:-empty})"
    fi

    if [[ -n "$merge_sha" && -n "$MAIN_SHA" ]]; then
      if git -C "$root" merge-base --is-ancestor "$merge_sha" "$MAIN_SHA" 2>/dev/null; then
        preflight_pass "PR #${MIGRATION_PR_NUMBER} merge commit is contained in origin/main"
      else
        # Fetch the merge commit object if needed
        git -C "$root" fetch origin "$merge_sha" 2>/dev/null || true
        if git -C "$root" merge-base --is-ancestor "$merge_sha" "$MAIN_SHA" 2>/dev/null; then
          preflight_pass "PR #${MIGRATION_PR_NUMBER} merge commit is contained in origin/main"
        else
          preflight_fail "PR #${MIGRATION_PR_NUMBER} merge commit ${merge_sha} is NOT an ancestor of origin/main ${MAIN_SHA}"
        fi
      fi
    fi
  fi

  OPEN_PRS_JSON="$(gh pr list --repo "$EXPECTED_REPO" --state open --json number,title,baseRefName,headRefName 2>/dev/null || echo '[]')"
  local open_dev_count open_ambiguous
  open_dev_count="$(printf '%s' "$OPEN_PRS_JSON" | jq '[.[] | select(.baseRefName=="dev")] | length')"
  open_ambiguous="$(printf '%s' "$OPEN_PRS_JSON" | jq --arg head "$MIGRATION_PR_HEAD" '[.[] | select(.headRefName==$head or (.title|test("single-trunk|cutover";"i")))] | length')"
  if [[ "$open_dev_count" == "0" ]]; then
    preflight_pass "zero open PRs targeting base=dev"
  else
    preflight_fail "open PRs still target base=dev (count=${open_dev_count})"
  fi
  if [[ "$open_ambiguous" == "0" ]]; then
    preflight_pass "no ambiguous open migration/cutover PRs"
  else
    preflight_fail "ambiguous open migration/cutover PRs still present (count=${open_ambiguous})"
  fi

  RULESETS_LIST_JSON="$(gh api "repos/${EXPECTED_REPO}/rulesets" --paginate 2>/dev/null || echo '[]')"
  RULESET_DETAILS_JSON='{}'
  local name count ids detail restore_body
  for name in "${LEGACY_RULESET_NAMES[@]}"; do
    count="$(printf '%s' "$RULESETS_LIST_JSON" | jq -r --arg n "$name" '[.[] | select(.name==$n)] | length')"
    if [[ "$count" != "1" ]]; then
      preflight_fail "legacy ruleset '${name}' must exist exactly once (found ${count})"
      continue
    fi
    ids="$(printf '%s' "$RULESETS_LIST_JSON" | jq -r --arg n "$name" '.[] | select(.name==$n) | .id')"
    detail="$(gh api "repos/${EXPECTED_REPO}/rulesets/${ids}" 2>/dev/null || true)"
    if [[ -z "$detail" ]]; then
      preflight_fail "cannot fetch full ruleset detail for '${name}' id=${ids}"
      continue
    fi
    restore_body="$(printf '%s' "$detail" | strip_ruleset_for_restore)"
    if ! printf '%s' "$restore_body" | jq -e '.name and .target and .enforcement and .conditions and .rules' >/dev/null; then
      preflight_fail "restore body incomplete for '${name}'"
      continue
    fi
    RULESET_DETAILS_JSON="$(
      jq -n --argjson acc "$RULESET_DETAILS_JSON" --arg name "$name" --argjson detail "$detail" --argjson restore "$restore_body" \
        '$acc + {($name): {id: $detail.id, detail: $detail, restore_body: $restore}}'
    )"
    preflight_pass "legacy ruleset '${name}' discoverable exactly once with full detail (id=${ids})"
  done

  local canon_count
  canon_count="$(printf '%s' "$RULESETS_LIST_JSON" | jq -r --arg n "$CANONICAL_RULESET_NAME" '[.[] | select(.name==$n)] | length')"
  if [[ "$canon_count" == "0" ]]; then
    preflight_pass "canonical '${CANONICAL_RULESET_NAME}' not yet present (expected pre-cutover)"
  else
    preflight_fail "canonical '${CANONICAL_RULESET_NAME}' already present (count=${canon_count}) — refuse ambiguous cutover"
  fi

  if [[ "$PRECUTOVER_FAIL" -eq 0 ]]; then
    return 0
  fi
  return 1
}
