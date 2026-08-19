#!/usr/bin/env bash
# Regression tests for validate-canonical-docs.sh plan vs addendum classification.
# Usage: ./scripts/ops/test-validate-canonical-docs.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VALIDATOR="${ROOT}/scripts/ops/validate-canonical-docs.sh"
chmod +x "$VALIDATOR"

PLAN_FRONTMATTER="$(cat <<'EOF'
---
integrationIssue: DEE-999
integrationTitle: "fixture plan"
branch: dee-999-fixture
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint]
approvalGates: [plan-approved]
state:
  status: draft
provenance:
  createdFrom: chat
---
EOF
)"

run_case() {
  local name="$1"
  local expect_exit="$2"
  local file="$3"

  set +e
  "$VALIDATOR" "$file" >/dev/null 2>&1
  local code=$?
  set -e

  if [[ "$code" -eq "$expect_exit" ]]; then
    printf 'PASS  %s (exit %s)\n' "$name" "$code"
  else
    printf 'FAIL  %s (expected exit %s, got %s)\n' "$name" "$expect_exit" "$code" >&2
    "$VALIDATOR" "$file" 2>&1 | sed 's/^/      /' >&2 || true
    return 1
  fi
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/waia-canon-docs.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail=0

# 1. valid normal integration plan -> PASS
cat >"$TMP/dee-999-valid-plan.md" <<EOF
${PLAN_FRONTMATTER}

## Acceptance

- fixture
EOF
run_case "valid integration plan" 0 "$TMP/dee-999-valid-plan.md" || fail=1

# 2. malformed normal integration plan (missing required frontmatter) -> FAIL
cat >"$TMP/dee-999-malformed-plan.md" <<'EOF'
---
integrationIssue: DEE-999
---

## Acceptance

- missing remaining plan keys
EOF
run_case "malformed integration plan missing keys" 1 "$TMP/dee-999-malformed-plan.md" || fail=1

# 3. legitimate DEE-518 ratification addendum filename class -> PASS
cat >"$TMP/dee-518-0148-open-tail-ratification-addendum-v1.md" <<'EOF'
# DEE-518 addendum fixture

## Human decision

- ratify migration 0148
EOF
run_case "legitimate ratification addendum" 0 "$TMP/dee-518-0148-open-tail-ratification-addendum-v1.md" || fail=1

# 4. legitimate approved nested ### WP-* structure -> PASS
cat >"$TMP/dee-999-nested-wp.md" <<EOF
${PLAN_FRONTMATTER}

## Work packages

### WP-CANON — DEE-519

- nested work package
EOF
run_case "nested ### WP-* structure" 0 "$TMP/dee-999-nested-wp.md" || fail=1

# 5. missing meaningful structure -> FAIL
cat >"$TMP/dee-999-no-structure.md" <<EOF
${PLAN_FRONTMATTER}

# Title only

No acceptance and no work-package headings.
EOF
run_case "missing Acceptance and WP structure" 1 "$TMP/dee-999-no-structure.md" || fail=1

# Extra: addendum without ## heading still FAIL (exemption is not a silent skip)
cat >"$TMP/dee-999-empty-addendum-v1.md" <<'EOF'
# empty addendum with no level-2 heading
EOF
run_case "addendum missing ## heading" 1 "$TMP/dee-999-empty-addendum-v1.md" || fail=1

# Extra: addendum with invalid kind still FAIL
cat >"$TMP/dee-999-bad-kind-addendum-v1.md" <<'EOF'
---
kind: integration-plan
---

## Human decision

- not a plan
EOF
run_case "addendum invalid kind" 1 "$TMP/dee-999-bad-kind-addendum-v1.md" || fail=1

# Extra: Integration Train JSON is classified and delegated to the fail-closed manifest validator.
cat >"$TMP/dee-999-invalid.integration-train.json" <<'EOF'
{}
EOF
run_case "invalid Integration Train manifest" 1 "$TMP/dee-999-invalid.integration-train.json" || fail=1

if [[ "$fail" -ne 0 ]]; then
  echo "Some canonical-doc validator regression tests failed." >&2
  exit 1
fi

echo "All canonical-doc validator regression tests passed."
