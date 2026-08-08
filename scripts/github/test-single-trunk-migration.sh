#!/usr/bin/env bash
# Regression contracts for DEE-511 single-trunk main migration.
# Usage: ./scripts/github/test-single-trunk-migration.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0

pass() { printf 'PASS  %s\n' "$1"; }
fail_msg() { printf 'FAIL  %s\n' "$1" >&2; fail=1; }

assert_file_contains() {
  local name="$1"
  local file="$2"
  local needle="$3"
  if [[ ! -f "$file" ]]; then
    fail_msg "$name (missing file: $file)"
    return
  fi
  if grep -qF -- "$needle" "$file"; then
    pass "$name"
  else
    fail_msg "$name (missing in $file: $needle)"
  fi
}

assert_file_not_contains() {
  local name="$1"
  local file="$2"
  local needle="$3"
  if [[ ! -f "$file" ]]; then
    fail_msg "$name (missing file: $file)"
    return
  fi
  if grep -qF -- "$needle" "$file"; then
    fail_msg "$name (unexpected in $file: $needle)"
  else
    pass "$name"
  fi
}

assert_file_not_matches() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  if [[ ! -f "$file" ]]; then
    fail_msg "$name (missing file: $file)"
    return
  fi
  if grep -Eq "$pattern" "$file"; then
    fail_msg "$name (unexpected match in $file: $pattern)"
  else
    pass "$name"
  fi
}

# 1. CI: PR to main only; no push-to-main full suite
assert_file_contains "ci PR targets main" "$ROOT/.github/workflows/ci.yml" "branches: [main]"
assert_file_not_matches "ci has no push trigger" "$ROOT/.github/workflows/ci.yml" '^[[:space:]]*push:'
assert_file_contains "ci keeps workflow_dispatch" "$ROOT/.github/workflows/ci.yml" "workflow_dispatch:"

# 2. linear-done targets main
assert_file_contains "linear-done on main" "$ROOT/.github/workflows/linear-done.yml" "branches: [main]"
assert_file_not_contains "linear-done not on dev" "$ROOT/.github/workflows/linear-done.yml" "branches: [dev]"
assert_file_contains "linear-done blob/main link" "$ROOT/.github/workflows/linear-done.yml" "/blob/main/docs/waia-governance/POST-MERGE-PROTOCOL.md"

# 3. pr-governance + cloudflare-preview on main
assert_file_contains "pr-governance on main" "$ROOT/.github/workflows/pr-governance.yml" "branches: [main]"
assert_file_contains "pr-governance blob/main link" "$ROOT/.github/workflows/pr-governance.yml" "/blob/main/docs/waia-governance/LINEAR-ID-COLLISION-RECOVERY.md"
assert_file_contains "cloudflare-preview on main" "$ROOT/.github/workflows/cloudflare-preview.yml" "branches: [main]"
assert_file_not_contains "cloudflare-preview not dual-branch" "$ROOT/.github/workflows/cloudflare-preview.yml" "branches: [dev, main]"

# 4. release is Human workflow_dispatch only
assert_file_contains "release workflow_dispatch" "$ROOT/.github/workflows/release.yml" "workflow_dispatch:"
assert_file_not_matches "release has no push trigger" "$ROOT/.github/workflows/release.yml" '^[[:space:]]*push:'

# 5. ruleset-as-code targets main only
RULESET="$ROOT/.github/rulesets/main-protection.json"
assert_file_contains "ruleset name" "$RULESET" "WAIA main protection"
if command -v jq >/dev/null 2>&1; then
  includes="$(jq -c '.conditions.ref_name.include' "$RULESET")"
  if [[ "$includes" == '["refs/heads/main"]' ]]; then
    pass "ruleset includes refs/heads/main only"
  else
    fail_msg "ruleset includes=${includes}"
  fi
  if jq -e '.rules[] | select(.type=="pull_request")' "$RULESET" >/dev/null; then
    pass "ruleset requires pull_request"
  else
    fail_msg "ruleset missing pull_request"
  fi
  approvals="$(jq -r '.rules[] | select(.type=="pull_request") | .parameters.required_approving_review_count' "$RULESET")"
  if [[ "$approvals" == "0" ]]; then
    pass "ruleset approval count 0 (single-operator)"
  else
    fail_msg "ruleset approval count=${approvals} (want 0)"
  fi
else
  fail_msg "jq required for ruleset assertions"
fi

# 6. cutover scripts exist and default to dry-run messaging
for s in apply-single-trunk-cutover.sh verify-single-trunk-cutover.sh rollback-single-trunk-cutover.sh; do
  if [[ -x "$ROOT/scripts/github/$s" || -f "$ROOT/scripts/github/$s" ]]; then
    pass "cutover script present: $s"
  else
    fail_msg "missing cutover script: $s"
  fi
done
assert_file_contains "apply dry-run default" "$ROOT/scripts/github/apply-single-trunk-cutover.sh" "READ-ONLY dry-run"
assert_file_contains "apply confirm flag" "$ROOT/scripts/github/apply-single-trunk-cutover.sh" "--confirm"
assert_file_contains "rollback confirm flag" "$ROOT/scripts/github/rollback-single-trunk-cutover.sh" "--confirm"
assert_file_contains "apply does not delete dev" "$ROOT/scripts/github/apply-single-trunk-cutover.sh" "do NOT delete branch refs/heads/dev"

# 7. guard-shell still blocks direct push to main
GUARD="$ROOT/.cursor/hooks/guard-shell.sh"
chmod +x "$GUARD"
deny_out="$(printf '%s' '{"command":"git push origin main"}' | "$GUARD")"
if printf '%s' "$deny_out" | grep -q '"permission":"deny"'; then
  pass "guard-shell denies push origin main"
else
  fail_msg "guard-shell did not deny push origin main: $deny_out"
fi
force_out="$(printf '%s' '{"command":"git push --force origin HEAD"}' | "$GUARD")"
if printf '%s' "$force_out" | grep -q '"permission":"deny"'; then
  pass "guard-shell denies force push"
else
  fail_msg "guard-shell did not deny force push"
fi

# 8. AGENTS / branching canon say PR → main
assert_file_contains "AGENTS PR to main" "$ROOT/AGENTS.md" "PR to \`main\`"
assert_file_contains "BRANCHING single trunk" "$ROOT/docs/waia-governance/BRANCHING-STRATEGY.md" "main-protection.json"
if grep -q 'agents \*\*never\*\* `gh pr merge`' "$ROOT/AGENTS.md"; then
  pass "AGENTS forbids agent merge"
else
  fail_msg "AGENTS missing agent merge forbid"
fi

# 9. prepare-pr / commands use origin/main
assert_file_contains "prepare-pr base main" "$ROOT/.cursor/commands/prepare-pr.md" "--base main"
assert_file_contains "implement from main" "$ROOT/.cursor/commands/implement.md" "origin/main"

echo
if [[ "$fail" -ne 0 ]]; then
  echo "Some single-trunk migration contracts failed." >&2
  exit 1
fi
echo "All single-trunk migration contracts passed."
