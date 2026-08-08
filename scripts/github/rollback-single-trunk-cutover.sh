#!/usr/bin/env bash
# Human-run rollback of single-trunk GitHub cutover settings (DEE-511).
#
# DEFAULT: read-only dry-run. Mutation requires explicit: --confirm
#
# Restores EXACT pre-cutover repository settings and EVERY affected ruleset from
# the operator-local full snapshot written by apply-single-trunk-cutover.sh --confirm:
#   ${WAIA_CUTOVER_STATE_DIR:-$HOME/.waia/single-trunk-cutover}/pre-cutover-state.json
#
# Does NOT rewrite protected branch history, delete tags, deploy Cloudflare,
# mutate Execution Server, or alter GitHub secrets.
# Does NOT instruct manual ruleset recreation for state the cutover deleted.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/single-trunk-cutover-lib.sh
source "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh"

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

require_cmd gh
require_cmd jq

SNAPSHOT="$(waia_cutover_snapshot_path)"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

echo "=== WAIA single-trunk cutover (rollback) ==="
echo "repo: ${REPO}"
echo "mode: $([[ "$CONFIRM" == true ]] && echo MUTATING || echo READ-ONLY dry-run)"
echo "snapshot: ${SNAPSHOT}"

if [[ ! -f "$SNAPSHOT" ]]; then
  echo "error: missing operator-local snapshot at ${SNAPSHOT}" >&2
  echo "Rollback cannot invent deleted ruleset bodies. Re-run cutover apply --confirm only after a valid snapshot exists," >&2
  echo "or restore the snapshot file from operator backup into WAIA_CUTOVER_STATE_DIR." >&2
  exit 1
fi

schema="$(jq -r '.schema_version // 0' "$SNAPSHOT")"
if [[ "$schema" != "2" ]]; then
  echo "error: snapshot schema_version=${schema} unsupported (want 2 with full ruleset restore bodies)" >&2
  exit 1
fi

snap_repo="$(jq -r .repo "$SNAPSHOT")"
if [[ "$snap_repo" != "$EXPECTED_REPO" ]]; then
  echo "error: snapshot repo '${snap_repo}' != ${EXPECTED_REPO}" >&2
  exit 1
fi
if [[ "$REPO" != "$EXPECTED_REPO" ]]; then
  echo "error: current repo '${REPO}' != ${EXPECTED_REPO}" >&2
  exit 1
fi

default_branch="$(jq -r .default_branch "$SNAPSHOT")"
allow_squash="$(jq -r .merge_settings.allow_squash_merge "$SNAPSHOT")"
allow_merge="$(jq -r .merge_settings.allow_merge_commit "$SNAPSHOT")"
allow_rebase="$(jq -r .merge_settings.allow_rebase_merge "$SNAPSHOT")"
allow_auto="$(jq -r .merge_settings.allow_auto_merge "$SNAPSHOT")"
delete_on_merge="$(jq -r .merge_settings.delete_branch_on_merge "$SNAPSHOT")"

missing_restore=0
for name in "${LEGACY_RULESET_NAMES[@]}"; do
  if ! jq -e --arg n "$name" '.rulesets[$n].restore_body.name' "$SNAPSHOT" >/dev/null; then
    echo "FAIL  snapshot missing restore_body for '${name}'" >&2
    missing_restore=1
  else
    echo "PASS  snapshot has restore_body for '${name}'"
  fi
done
if [[ "$missing_restore" -ne 0 ]]; then
  echo "error: snapshot incomplete — refuse rollback" >&2
  exit 1
fi

echo
echo "=== Planned rollback mutations ==="
echo "  1. PATCH default_branch=${default_branch}"
echo "  2. PATCH merge settings from snapshot (typed JSON booleans)"
echo "  3. Delete canonical '${CANONICAL_RULESET_NAME}' if present (fail-closed on ambiguity)"
echo "  4. Recreate/update EVERY affected legacy ruleset from snapshot restore_body"
echo "  5. Verify restored ruleset bodies match snapshot"
echo "  6. Does NOT rewrite git history; does NOT delete refs/heads/dev"

if [[ "$CONFIRM" != true ]]; then
  echo
  echo "Dry-run complete. Re-run with --confirm to mutate live GitHub settings."
  exit 0
fi

echo
echo "=== MUTATING rollback (--confirm) ==="

# Typed JSON booleans from snapshot values.
jq -n \
  --arg default_branch "$default_branch" \
  --argjson squash "$allow_squash" \
  --argjson merge "$allow_merge" \
  --argjson rebase "$allow_rebase" \
  --argjson auto "$allow_auto" \
  --argjson del "$delete_on_merge" \
  '{
    default_branch: $default_branch,
    allow_squash_merge: $squash,
    allow_merge_commit: $merge,
    allow_rebase_merge: $rebase,
    allow_auto_merge: $auto,
    delete_branch_on_merge: $del
  }' | gh api -X PATCH "repos/${EXPECTED_REPO}" --input - >/dev/null
echo "Restored repository default_branch + merge settings"

# Remove canonical single-trunk ruleset
canon_ids="$(
  gh api "repos/${EXPECTED_REPO}/rulesets" --paginate \
    | jq -r --arg n "$CANONICAL_RULESET_NAME" '[.[] | select(.name == $n) | .id] | .[]'
)"
canon_count="$(printf '%s\n' "$canon_ids" | grep -c '^[0-9]' || true)"
if [[ "$canon_count" -gt 1 ]]; then
  echo "error: multiple '${CANONICAL_RULESET_NAME}' rulesets — refuse ambiguous delete" >&2
  exit 1
fi
if [[ "$canon_count" -eq 1 ]]; then
  cid="$(printf '%s\n' "$canon_ids" | head -1)"
  gh api -X DELETE "repos/${EXPECTED_REPO}/rulesets/${cid}" >/dev/null
  echo "Deleted canonical ruleset id=${cid}"
fi

# Recreate every legacy ruleset from snapshot (no manual recreation path).
for name in "${LEGACY_RULESET_NAMES[@]}"; do
  restore_body="$(jq -c --arg n "$name" '.rulesets[$n].restore_body' "$SNAPSHOT")"
  existing_ids="$(
    gh api "repos/${EXPECTED_REPO}/rulesets" --paginate \
      | jq -r --arg name "$name" '[.[] | select(.name == $name) | .id] | .[]'
  )"
  existing_count="$(printf '%s\n' "$existing_ids" | grep -c '^[0-9]' || true)"
  if [[ "$existing_count" -gt 1 ]]; then
    echo "error: multiple rulesets named '${name}' — refuse ambiguous upsert" >&2
    exit 1
  fi
  if [[ "$existing_count" -eq 1 ]]; then
    lid="$(printf '%s\n' "$existing_ids" | head -1)"
    printf '%s' "$restore_body" | gh api -X PUT "repos/${EXPECTED_REPO}/rulesets/${lid}" --input - >/dev/null
    echo "Updated legacy ruleset name=${name} id=${lid}"
  else
    printf '%s' "$restore_body" | gh api -X POST "repos/${EXPECTED_REPO}/rulesets" --input - >/dev/null
    echo "Created legacy ruleset name=${name}"
  fi
done

echo
echo "=== Verifying restored rulesets against snapshot ==="
verify_fail=0
for name in "${LEGACY_RULESET_NAMES[@]}"; do
  expected="$(jq -c --arg n "$name" '.rulesets[$n].restore_body' "$SNAPSHOT")"
  ids="$(
    gh api "repos/${EXPECTED_REPO}/rulesets" --paginate \
      | jq -r --arg name "$name" '[.[] | select(.name == $name) | .id] | .[]'
  )"
  count="$(printf '%s\n' "$ids" | grep -c '^[0-9]' || true)"
  if [[ "$count" != "1" ]]; then
    echo "FAIL  restored '${name}' count=${count} (want 1)" >&2
    verify_fail=1
    continue
  fi
  rid="$(printf '%s\n' "$ids" | head -1)"
  live_detail="$(gh api "repos/${EXPECTED_REPO}/rulesets/${rid}")"
  live_restore="$(printf '%s' "$live_detail" | strip_ruleset_for_restore)"
  if ruleset_bodies_equivalent "$expected" "$live_restore"; then
    echo "PASS  restored '${name}' matches snapshot restore_body"
  else
    echo "FAIL  restored '${name}' does not match snapshot restore_body" >&2
    echo "  expected: $(printf '%s' "$expected" | jq -c '{name,target,enforcement,conditions,rules}')" >&2
    echo "  live:     $(printf '%s' "$live_restore" | jq -c '{name,target,enforcement,conditions,rules}')" >&2
    verify_fail=1
  fi
done

repo_now="$(gh api "repos/${EXPECTED_REPO}")"
db_now="$(printf '%s' "$repo_now" | jq -r .default_branch)"
if [[ "$db_now" == "$default_branch" ]]; then
  echo "PASS  default_branch restored (${db_now})"
else
  echo "FAIL  default_branch=${db_now} (want ${default_branch})" >&2
  verify_fail=1
fi

for key in allow_squash_merge allow_merge_commit allow_rebase_merge allow_auto_merge delete_branch_on_merge; do
  want="$(jq -r --arg k "$key" ".merge_settings[\$k]" "$SNAPSHOT")"
  got="$(printf '%s' "$repo_now" | jq -r --arg k "$key" '.[$k]')"
  if [[ "$want" == "$got" ]]; then
    echo "PASS  ${key}=${got}"
  else
    echo "FAIL  ${key}=${got} (want ${want})" >&2
    verify_fail=1
  fi
done

if [[ "$verify_fail" -ne 0 ]]; then
  echo "error: rollback verification failed — fail closed" >&2
  exit 1
fi

echo
echo "Rollback complete. History was not rewritten. refs/heads/dev was not deleted by cutover."
echo "All affected legacy rulesets were restored automatically from ${SNAPSHOT}."
