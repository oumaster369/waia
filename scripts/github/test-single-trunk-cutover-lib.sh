#!/usr/bin/env bash
# Unit-style regressions for single-trunk cutover lib + script contracts.
# Usage: ./scripts/github/test-single-trunk-cutover-lib.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/single-trunk-cutover-lib.sh
source "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh"

fail=0
pass() { printf 'PASS  %s\n' "$1"; }
fail_msg() { printf 'FAIL  %s\n' "$1" >&2; fail=1; }

# strip_ruleset_for_restore removes read-only fields
sample='{
  "id": 15855741,
  "name": "dev",
  "target": "branch",
  "source_type": "Repository",
  "source": "oumaster369/waia",
  "enforcement": "active",
  "conditions": {"ref_name": {"exclude": [], "include": ["refs/heads/dev"]}},
  "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}],
  "node_id": "RRS_x",
  "created_at": "2026-05-02T10:20:27.740+03:00",
  "updated_at": "2026-05-02T11:35:36.093+03:00",
  "bypass_actors": [],
  "current_user_can_bypass": "never",
  "_links": {"self": {"href": "https://example"}}
}'
stripped="$(printf '%s' "$sample" | strip_ruleset_for_restore)"
if printf '%s' "$stripped" | jq -e 'has("id") or has("node_id") or has("created_at") or has("_links") or has("source")' >/dev/null; then
  fail_msg "strip_ruleset_for_restore retained read-only fields"
else
  pass "strip_ruleset_for_restore removes read-only fields"
fi
if printf '%s' "$stripped" | jq -e '.name=="dev" and .target=="branch" and .enforcement=="active" and (.rules|length)==2' >/dev/null; then
  pass "strip_ruleset_for_restore keeps restore fields"
else
  fail_msg "strip_ruleset_for_restore lost required restore fields"
fi

# equivalence helper
if ruleset_bodies_equivalent "$stripped" "$stripped"; then
  pass "ruleset_bodies_equivalent identical bodies"
else
  fail_msg "ruleset_bodies_equivalent failed on identical bodies"
fi
other="$(printf '%s' "$stripped" | jq '.enforcement="disabled"')"
if ruleset_bodies_equivalent "$stripped" "$other"; then
  fail_msg "ruleset_bodies_equivalent should differ when enforcement changes"
else
  pass "ruleset_bodies_equivalent detects enforcement drift"
fi

# Snapshot path is operator-local by default
snap="$(waia_cutover_snapshot_path)"
case "$snap" in
  */.waia/single-trunk-cutover/pre-cutover-state.json)
    pass "default snapshot path is operator-local under ~/.waia"
    ;;
  *)
    if [[ -n "${WAIA_CUTOVER_STATE_DIR:-}" ]]; then
      pass "snapshot path uses WAIA_CUTOVER_STATE_DIR override"
    else
      fail_msg "unexpected snapshot path: $snap"
    fi
    ;;
esac

# apply script contracts
APPLY="${ROOT}/scripts/github/apply-single-trunk-cutover.sh"
assert_contains() {
  local name="$1" file="$2" needle="$3"
  if grep -qF -- "$needle" "$file"; then pass "$name"; else fail_msg "$name missing: $needle"; fi
}
assert_not_contains() {
  local name="$1" file="$2" needle="$3"
  if grep -qF -- "$needle" "$file"; then fail_msg "$name unexpected: $needle"; else pass "$name"; fi
}

assert_contains "apply sources shared lib" "$APPLY" "single-trunk-cutover-lib.sh"
assert_contains "apply refuses confirm without preflight" "$APPLY" "refusing --confirm mutation"
assert_contains "apply requires PR 456 merged" "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh" "MIGRATION_PR_NUMBER=\"456\""
assert_contains "apply requires admin" "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh" "permissions.admin"
assert_contains "apply fetches before resolving refs" "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh" "git fetch origin --prune"
assert_contains "apply uses ls-remote for live SHAs" "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh" "ls-remote origin refs/heads/main"
assert_contains "apply snapshots full ruleset detail" "$APPLY" "restore_body"
assert_contains "apply uses typed JSON patch" "$APPLY" "allow_squash_merge: true"

ROLLBACK="${ROOT}/scripts/github/rollback-single-trunk-cutover.sh"
assert_contains "rollback requires schema v2 snapshot" "$ROLLBACK" "schema_version"
assert_contains "rollback restores every legacy ruleset" "$ROLLBACK" "LEGACY_RULESET_NAMES"
assert_contains "rollback verifies restored bodies" "$ROLLBACK" "ruleset_bodies_equivalent"
assert_not_contains "rollback has no manual recreate instruction" "$ROLLBACK" "recreate them manually"
assert_contains "rollback refuses missing snapshot" "$ROLLBACK" "missing operator-local snapshot"

VERIFY="${ROOT}/scripts/github/verify-single-trunk-cutover.sh"
assert_contains "verify requires tenant isolation" "$VERIFY" "tenant isolation gate"
assert_contains "verify reports Cloudflare human gate" "$VERIFY" "CLOUDFLARE_HUMAN_GATE"

# bash -n syntax
for s in \
  "$APPLY" \
  "$ROLLBACK" \
  "$VERIFY" \
  "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh" \
  "${ROOT}/scripts/github/configure-merge-settings.sh" \
  "${ROOT}/scripts/github/apply-branch-rulesets.sh"
do
  if bash -n "$s"; then
    pass "bash -n $(basename "$s")"
  else
    fail_msg "bash -n failed: $s"
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "Some cutover lib regressions failed." >&2
  exit 1
fi
echo "All single-trunk cutover lib regressions passed."
