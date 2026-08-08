#!/usr/bin/env bash
# Human-run rollback of single-trunk GitHub cutover settings.
#
# DEFAULT: read-only dry-run. Does NOT rewrite protected branch history.
# Mutation requires explicit: --confirm
#
# Restores repository settings from scripts/github/fixtures/single-trunk-cutover/pre-cutover-state.json
# when present; otherwise restores the known pre-migration dual-branch posture documented
# in that fixture's schema / DEE-511 migration record.
#
# Does NOT: delete tags, rewrite commits, deploy Cloudflare, mutate Execution Server,
# or alter GitHub secrets.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SNAPSHOT="${ROOT}/scripts/github/fixtures/single-trunk-cutover/pre-cutover-state.json"
LEGACY_RULESET_FILE="${ROOT}/.github/rulesets/dev-main-protection.json"
CONFIRM=false

for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM=true ;;
    -h|--help)
      sed -n '2,18p' "$0"
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

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

if [[ -f "$SNAPSHOT" ]]; then
  echo "Using captured pre-cutover snapshot: ${SNAPSHOT}"
  default_branch="$(jq -r .default_branch "$SNAPSHOT")"
  allow_squash="$(jq -r .merge_settings.allow_squash_merge "$SNAPSHOT")"
  allow_merge="$(jq -r .merge_settings.allow_merge_commit "$SNAPSHOT")"
  allow_rebase="$(jq -r .merge_settings.allow_rebase_merge "$SNAPSHOT")"
  allow_auto="$(jq -r .merge_settings.allow_auto_merge "$SNAPSHOT")"
  delete_on_merge="$(jq -r .merge_settings.delete_branch_on_merge "$SNAPSHOT")"
else
  echo "WARNING: no captured snapshot at ${SNAPSHOT}"
  echo "Falling back to documented pre-migration dual-branch posture:"
  echo "  default_branch=dev, squash+merge-commit on, auto_merge on, rebase off"
  default_branch="dev"
  allow_squash="true"
  allow_merge="true"
  allow_rebase="false"
  allow_auto="true"
  delete_on_merge="true"
fi

echo "=== WAIA single-trunk cutover (rollback) ==="
echo "repo: ${REPO}"
echo "mode: $([[ "$CONFIRM" == true ]] && echo MUTATING || echo READ-ONLY dry-run)"
echo
echo "=== Planned rollback mutations ==="
echo "  1. PATCH default_branch=${default_branch}"
echo "  2. PATCH merge settings: squash=${allow_squash} merge_commit=${allow_merge} rebase=${allow_rebase} auto_merge=${allow_auto} delete_on_merge=${delete_on_merge}"
echo "  3. Re-apply legacy dual-branch ruleset from ${LEGACY_RULESET_FILE} (name: WAIA dev + main protection)"
echo "  4. Delete canonical 'WAIA main protection' ruleset if present (fail-closed on ambiguity)"
echo "  5. Does NOT rewrite git history; does NOT recreate deleted commits"

if [[ "$CONFIRM" != true ]]; then
  echo
  echo "Dry-run complete. Re-run with --confirm to mutate live GitHub settings."
  exit 0
fi

if [[ ! -f "$LEGACY_RULESET_FILE" ]]; then
  echo "error: missing legacy ruleset file for rollback: ${LEGACY_RULESET_FILE}" >&2
  exit 1
fi

echo
echo "=== MUTATING rollback (--confirm) ==="

gh api -X PATCH "repos/${REPO}" \
  -f "default_branch=${default_branch}" \
  -F "allow_squash_merge=${allow_squash}" \
  -F "allow_merge_commit=${allow_merge}" \
  -F "allow_rebase_merge=${allow_rebase}" \
  -F "allow_auto_merge=${allow_auto}" \
  -F "delete_branch_on_merge=${delete_on_merge}" \
  >/dev/null
echo "Restored repository settings"

# Remove canonical single-trunk ruleset
canon_ids="$(
  gh api "repos/${REPO}/rulesets" --paginate \
    | jq -r '[.[] | select(.name == "WAIA main protection") | .id] | .[]'
)"
canon_count="$(printf '%s\n' "$canon_ids" | grep -c '^[0-9]' || true)"
if [[ "$canon_count" -gt 1 ]]; then
  echo "error: multiple 'WAIA main protection' rulesets — refuse ambiguous delete" >&2
  exit 1
fi
if [[ "$canon_count" -eq 1 ]]; then
  cid="$(printf '%s\n' "$canon_ids" | head -1)"
  gh api -X DELETE "repos/${REPO}/rulesets/${cid}" >/dev/null
  echo "Deleted canonical ruleset id=${cid}"
fi

# Upsert legacy dual-branch ruleset
legacy_name="WAIA dev + main protection"
legacy_ids="$(
  gh api "repos/${REPO}/rulesets" --paginate \
    | jq -r --arg name "$legacy_name" '[.[] | select(.name == $name) | .id] | .[]'
)"
legacy_count="$(printf '%s\n' "$legacy_ids" | grep -c '^[0-9]' || true)"
if [[ "$legacy_count" -gt 1 ]]; then
  echo "error: multiple '${legacy_name}' rulesets — refuse ambiguous upsert" >&2
  exit 1
fi
if [[ "$legacy_count" -eq 1 ]]; then
  lid="$(printf '%s\n' "$legacy_ids" | head -1)"
  gh api -X PUT "repos/${REPO}/rulesets/${lid}" --input "$LEGACY_RULESET_FILE" >/dev/null
  echo "Updated legacy ruleset id=${lid}"
else
  gh api -X POST "repos/${REPO}/rulesets" --input "$LEGACY_RULESET_FILE" >/dev/null
  echo "Created legacy ruleset '${legacy_name}'"
fi

echo
echo "Rollback settings apply complete."
echo "NOTE: If live short-name rulesets 'dev'/'main' existed pre-cutover beyond the combined"
echo "ruleset, recreate them manually from the snapshot if needed:"
echo "  ${SNAPSHOT}"
echo "History was not rewritten. Branch refs/heads/dev was not deleted by cutover."
