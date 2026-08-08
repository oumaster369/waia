#!/usr/bin/env bash
# Human-run single-trunk cutover for WAIA.
#
# DEFAULT: read-only dry-run. Prints current state, target state, and exact
# mutations that would be performed. Does NOT change live GitHub settings.
#
# Mutation requires explicit: --confirm
#
# Usage:
#   ./scripts/github/apply-single-trunk-cutover.sh
#   ./scripts/github/apply-single-trunk-cutover.sh --confirm
#
# Does NOT: delete `dev`, merge PRs, deploy Cloudflare, mutate Execution Server,
# rewrite protected branch history, or alter GitHub secrets.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RULESET_FILE="${ROOT}/.github/rulesets/main-protection.json"
CANONICAL_RULESET_NAME="WAIA main protection"
PRECUTOVER_STATE_DIR="${ROOT}/scripts/github/fixtures/single-trunk-cutover"
PRECUTOVER_SNAPSHOT="${PRECUTOVER_STATE_DIR}/pre-cutover-state.json"
CONFIRM=false

for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM=true ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $arg (only --confirm is supported)" >&2
      exit 2
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi
if [[ ! -f "$RULESET_FILE" ]]; then
  echo "error: missing ruleset file: $RULESET_FILE" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
AUTH_LOGIN="$(gh api user --jq .login 2>/dev/null || echo "(unauthenticated)")"

repo_json="$(gh api "repos/${REPO}")"
default_branch="$(printf '%s' "$repo_json" | jq -r .default_branch)"
allow_squash="$(printf '%s' "$repo_json" | jq -r .allow_squash_merge)"
allow_merge="$(printf '%s' "$repo_json" | jq -r .allow_merge_commit)"
allow_rebase="$(printf '%s' "$repo_json" | jq -r .allow_rebase_merge)"
allow_auto="$(printf '%s' "$repo_json" | jq -r .allow_auto_merge)"
delete_on_merge="$(printf '%s' "$repo_json" | jq -r .delete_branch_on_merge)"

main_sha="$(git -C "$ROOT" rev-parse origin/main 2>/dev/null || git -C "$ROOT" ls-remote origin refs/heads/main | awk '{print $1}')"
dev_sha="$(git -C "$ROOT" rev-parse origin/dev 2>/dev/null || git -C "$ROOT" ls-remote origin refs/heads/dev | awk '{print $1}')"
main_tree="$(git -C "$ROOT" rev-parse "origin/main^{tree}" 2>/dev/null || echo "(unavailable)")"
dev_tree="$(git -C "$ROOT" rev-parse "origin/dev^{tree}" 2>/dev/null || echo "(unavailable)")"

open_prs="$(gh pr list --repo "$REPO" --state open --json number,title,baseRefName,headRefName)"
rulesets_raw="$(gh api "repos/${REPO}/rulesets" --paginate)"

echo "=== WAIA single-trunk cutover (apply) ==="
echo "repo:              ${REPO}"
echo "gh user:           ${AUTH_LOGIN}"
echo "mode:              $([[ "$CONFIRM" == true ]] && echo MUTATING || echo READ-ONLY dry-run)"
echo "default_branch:    ${default_branch}"
echo "main HEAD:         ${main_sha}"
echo "main tree:         ${main_tree}"
echo "dev HEAD:          ${dev_sha}"
echo "dev tree:          ${dev_tree}"
echo "open PRs:          $(printf '%s' "$open_prs" | jq 'length')"
printf '%s\n' "$open_prs" | jq -r '.[] | "  #\(.number) \(.headRefName) → \(.baseRefName): \(.title)"' 2>/dev/null || true
echo
echo "=== Active rulesets ==="
printf '%s\n' "$rulesets_raw" | jq -r '.[] | "  id=\(.id) name=\(.name) enforcement=\(.enforcement)"'
echo
echo "=== Current merge settings ==="
echo "  allow_squash_merge=${allow_squash}"
echo "  allow_merge_commit=${allow_merge}"
echo "  allow_rebase_merge=${allow_rebase}"
echo "  allow_auto_merge=${allow_auto}"
echo "  delete_branch_on_merge=${delete_on_merge}"
echo
echo "=== Target state ==="
echo "  default_branch=main"
echo "  allow_squash_merge=true"
echo "  allow_merge_commit=false"
echo "  allow_rebase_merge=false"
echo "  allow_auto_merge=false"
echo "  delete_branch_on_merge=true"
echo "  ruleset: '${CANONICAL_RULESET_NAME}' targeting refs/heads/main only"
echo "  retire obsolete rulesets named: 'WAIA dev + main protection', 'dev', 'main' (legacy)"
echo "  do NOT delete branch refs/heads/dev"
echo
echo "=== Planned mutations ==="
echo "  1. Persist pre-cutover snapshot to ${PRECUTOVER_SNAPSHOT}"
echo "  2. PATCH repos/${REPO} default_branch=main + merge settings"
echo "  3. Upsert ruleset '${CANONICAL_RULESET_NAME}' from ${RULESET_FILE}"
echo "  4. Disable/delete obsolete dual-branch rulesets by canonical name (fail-closed on ambiguity)"
echo "  5. Re-verify via verify-single-trunk-cutover.sh"

if [[ "$CONFIRM" != true ]]; then
  echo
  echo "Dry-run complete. Re-run with --confirm to mutate live GitHub settings."
  exit 0
fi

echo
echo "=== MUTATING (Human --confirm) ==="

mkdir -p "$PRECUTOVER_STATE_DIR"
jq -n \
  --arg repo "$REPO" \
  --arg captured_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg default_branch "$default_branch" \
  --argjson merge_settings "$(jq -n \
    --argjson squash "$allow_squash" \
    --argjson merge "$allow_merge" \
    --argjson rebase "$allow_rebase" \
    --argjson auto "$allow_auto" \
    --argjson del "$delete_on_merge" \
    '{allow_squash_merge:$squash,allow_merge_commit:$merge,allow_rebase_merge:$rebase,allow_auto_merge:$auto,delete_branch_on_merge:$del}')" \
  --argjson open_prs "$open_prs" \
  --argjson rulesets "$rulesets_raw" \
  --arg main_sha "$main_sha" \
  --arg dev_sha "$dev_sha" \
  '{
    repo:$repo,
    captured_at:$captured_at,
    default_branch:$default_branch,
    merge_settings:$merge_settings,
    open_prs:$open_prs,
    rulesets:$rulesets,
    main_sha:$main_sha,
    dev_sha:$dev_sha
  }' > "$PRECUTOVER_SNAPSHOT"
echo "Wrote pre-cutover snapshot: ${PRECUTOVER_SNAPSHOT}"

gh api -X PATCH "repos/${REPO}" \
  -f default_branch=main \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f allow_auto_merge=false \
  -f delete_branch_on_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=BLANK \
  >/dev/null
echo "Updated repository default_branch + merge settings"

canonical_ids="$(
  printf '%s\n' "$rulesets_raw" \
    | jq -r --arg name "$CANONICAL_RULESET_NAME" '[.[] | select(.name == $name) | .id] | .[]'
)"
canonical_count="$(printf '%s\n' "$canonical_ids" | grep -c '^[0-9]' || true)"
if [[ "$canonical_count" -gt 1 ]]; then
  echo "error: multiple rulesets named '${CANONICAL_RULESET_NAME}' — refuse ambiguous mutation" >&2
  exit 1
fi

if [[ "$canonical_count" -eq 1 ]]; then
  cid="$(printf '%s\n' "$canonical_ids" | head -1)"
  echo "Updating canonical ruleset id=${cid}"
  gh api -X PUT "repos/${REPO}/rulesets/${cid}" --input "$RULESET_FILE" >/dev/null
else
  echo "Creating canonical ruleset '${CANONICAL_RULESET_NAME}'"
  gh api -X POST "repos/${REPO}/rulesets" --input "$RULESET_FILE" >/dev/null
fi

retire_names=("WAIA dev + main protection" "dev" "main")
for name in "${retire_names[@]}"; do
  ids="$(
    gh api "repos/${REPO}/rulesets" --paginate \
      | jq -r --arg name "$name" '[.[] | select(.name == $name) | .id] | .[]'
  )"
  count="$(printf '%s\n' "$ids" | grep -c '^[0-9]' || true)"
  if [[ "$count" -eq 0 ]]; then
    echo "No obsolete ruleset named '${name}' (ok)"
    continue
  fi
  if [[ "$count" -gt 1 ]]; then
    echo "error: multiple rulesets named '${name}' — refuse ambiguous delete: ${ids}" >&2
    exit 1
  fi
  rid="$(printf '%s\n' "$ids" | head -1)"
  current_name="$(gh api "repos/${REPO}/rulesets/${rid}" --jq .name)"
  if [[ "$current_name" == "$CANONICAL_RULESET_NAME" ]]; then
    echo "Skipping id=${rid} (canonical '${CANONICAL_RULESET_NAME}')"
    continue
  fi
  echo "Deleting obsolete ruleset name=${current_name} id=${rid}"
  gh api -X DELETE "repos/${REPO}/rulesets/${rid}" >/dev/null
done

echo
"${ROOT}/scripts/github/verify-single-trunk-cutover.sh"
echo
echo "Cutover apply complete. Branch refs/heads/dev was NOT deleted."
