#!/usr/bin/env bash
# Human-run single-trunk cutover for WAIA (DEE-511).
#
# DEFAULT: read-only dry-run. Runs fail-closed preflight and prints PASS/FAIL.
# Mutation requires explicit: --confirm
#
# Snapshot + full ruleset restore bodies are written ONLY under operator-local:
#   ${WAIA_CUTOVER_STATE_DIR:-$HOME/.waia/single-trunk-cutover}/
# That path is outside the repository so rollback survives working-tree changes
# and cannot be accidentally committed.
#
# Does NOT: delete `dev`, merge PRs, deploy Cloudflare, mutate Execution Server,
# rewrite protected branch history, or alter GitHub secrets.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/single-trunk-cutover-lib.sh
source "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh"

RULESET_FILE="${ROOT}/.github/rulesets/main-protection.json"
CONFIRM=false

for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM=true ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $arg (only --confirm is supported)" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$RULESET_FILE" ]]; then
  echo "error: missing ruleset file: $RULESET_FILE" >&2
  exit 1
fi

STATE_DIR="$(waia_cutover_state_dir)"
SNAPSHOT="$(waia_cutover_snapshot_path)"

echo "=== WAIA single-trunk cutover (apply) ==="
echo "mode:              $([[ "$CONFIRM" == true ]] && echo MUTATING || echo READ-ONLY dry-run)"
echo "state dir:         ${STATE_DIR}"
echo "snapshot path:     ${SNAPSHOT}"
echo "do NOT delete branch refs/heads/dev"
echo
echo "=== Fail-closed preflight ==="

set +e
run_single_trunk_cutover_preflight "$ROOT"
preflight_rc=$?
set -e

echo
echo "=== Preflight summary ==="
if [[ "$preflight_rc" -eq 0 ]]; then
  echo "CUTOVER_PREFLIGHT_READY=true"
else
  echo "CUTOVER_PREFLIGHT_READY=false (failures=${PRECUTOVER_FAIL})"
fi

echo
echo "=== Target mutations (only if --confirm AND preflight ready) ==="
echo "  1. Persist full pre-cutover snapshot (repo settings + full ruleset details/restore bodies) to ${SNAPSHOT}"
echo "  2. PATCH repos/${EXPECTED_REPO} default_branch=main + squash-only merge settings (typed JSON booleans)"
echo "  3. Create ruleset '${CANONICAL_RULESET_NAME}' from ${RULESET_FILE}"
echo "  4. Delete obsolete legacy rulesets by exact name (fail-closed on ambiguity)"
echo "  5. Re-verify GitHub post-cutover state"
echo "  Cloudflare Architect Contract A|B must already be recorded BEFORE merging PR #456"
echo "  (see docs/ops/SINGLE-TRUNK-CUTOVER.md — pre-merge Human gate)"

if [[ "$CONFIRM" != true ]]; then
  echo
  echo "Dry-run complete. No live GitHub settings were mutated."
  if [[ "$preflight_rc" -ne 0 ]]; then
    echo "Preflight is NOT ready for --confirm yet (expected before PR #456 merge / while gates fail)."
    exit 0
  fi
  echo "Preflight READY. Re-run with --confirm to mutate live GitHub settings."
  exit 0
fi

if [[ "$preflight_rc" -ne 0 ]]; then
  echo "error: refusing --confirm mutation; fail-closed preflight did not pass" >&2
  exit 1
fi

echo
echo "=== MUTATING (Human --confirm; preflight passed) ==="

mkdir -p "$STATE_DIR"
umask 077

# Persist complete snapshot BEFORE any mutation.
jq -n \
  --arg repo "$EXPECTED_REPO" \
  --arg captured_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg captured_by "${AUTH_LOGIN}" \
  --arg default_branch "$DEFAULT_BRANCH" \
  --argjson merge_settings "$(jq -n \
    --argjson squash "$ALLOW_SQUASH" \
    --argjson merge "$ALLOW_MERGE" \
    --argjson rebase "$ALLOW_REBASE" \
    --argjson auto "$ALLOW_AUTO" \
    --argjson del "$DELETE_ON_MERGE" \
    '{
      allow_squash_merge:$squash,
      allow_merge_commit:$merge,
      allow_rebase_merge:$rebase,
      allow_auto_merge:$auto,
      delete_branch_on_merge:$del
    }')" \
  --argjson open_prs "$OPEN_PRS_JSON" \
  --argjson rulesets_list "$RULESETS_LIST_JSON" \
  --argjson rulesets "$RULESET_DETAILS_JSON" \
  --arg main_sha "$MAIN_SHA" \
  --arg dev_sha "$DEV_SHA" \
  --arg migration_pr "$MIGRATION_PR_NUMBER" \
  --arg migration_merge_sha "${MIGRATION_MERGE_SHA}" \
  '{
    schema_version: 2,
    repo: $repo,
    captured_at: $captured_at,
    captured_by: $captured_by,
    default_branch: $default_branch,
    merge_settings: $merge_settings,
    open_prs: $open_prs,
    rulesets_list: $rulesets_list,
    rulesets: $rulesets,
    main_sha: $main_sha,
    dev_sha: $dev_sha,
    migration_pr: ($migration_pr | tonumber),
    migration_merge_sha: $migration_merge_sha,
    note: "Full ruleset detail+restore_body captured before any delete/update. Operator-local only."
  }' > "$SNAPSHOT"
echo "Wrote pre-cutover snapshot: ${SNAPSHOT}"

# Typed JSON body for boolean fields (no string coercion).
jq -n '{
  default_branch: "main",
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  allow_auto_merge: false,
  delete_branch_on_merge: true,
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "BLANK"
}' | gh api -X PATCH "repos/${EXPECTED_REPO}" --input - >/dev/null
echo "Updated repository default_branch + merge settings"

echo "Creating canonical ruleset '${CANONICAL_RULESET_NAME}'"
gh api -X POST "repos/${EXPECTED_REPO}/rulesets" --input "$RULESET_FILE" >/dev/null

for name in "${LEGACY_RULESET_NAMES[@]}"; do
  ids="$(
    gh api "repos/${EXPECTED_REPO}/rulesets" --paginate \
      | jq -r --arg name "$name" '[.[] | select(.name == $name) | .id] | .[]'
  )"
  count="$(printf '%s\n' "$ids" | grep -c '^[0-9]' || true)"
  if [[ "$count" -eq 0 ]]; then
    echo "error: expected legacy ruleset '${name}' missing at delete time" >&2
    exit 1
  fi
  if [[ "$count" -gt 1 ]]; then
    echo "error: multiple rulesets named '${name}' — refuse ambiguous delete: ${ids}" >&2
    exit 1
  fi
  rid="$(printf '%s\n' "$ids" | head -1)"
  current_name="$(gh api "repos/${EXPECTED_REPO}/rulesets/${rid}" --jq .name)"
  if [[ "$current_name" == "$CANONICAL_RULESET_NAME" ]]; then
    echo "error: refusing to delete canonical ruleset id=${rid}" >&2
    exit 1
  fi
  echo "Deleting obsolete ruleset name=${current_name} id=${rid}"
  gh api -X DELETE "repos/${EXPECTED_REPO}/rulesets/${rid}" >/dev/null
done

echo
echo "=== Post-mutation GitHub verification (fail-closed) ==="
if ! "${ROOT}/scripts/github/verify-single-trunk-cutover.sh" --github-only; then
  echo >&2
  echo "error: GitHub cutover is NOT verified/complete — post-cutover verification failed." >&2
  echo "Do NOT treat this cutover as successful." >&2
  echo "Deterministic rollback (Human-authorized only; not auto-executed):" >&2
  echo "  ./scripts/github/rollback-single-trunk-cutover.sh --confirm" >&2
  echo "Snapshot for rollback: ${SNAPSHOT}" >&2
  exit 1
fi

echo
echo "GitHub cutover apply complete and verified. Branch refs/heads/dev was NOT deleted."
echo "Cloudflare Architect contract must already be recorded pre-merge; full verify still checks it:"
echo "  ./scripts/github/verify-single-trunk-cutover.sh"
echo "Snapshot for deterministic rollback: ${SNAPSHOT}"
exit 0
