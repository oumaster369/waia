#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_file="$repo_root/tests/integration/postgres-risk-v2.test.ts"

require_literal() {
  local literal="$1"
  if ! grep -Fq -- "$literal" "$test_file"; then
    echo "missing required Risk expiry proof literal: $literal" >&2
    exit 1
  fi
}

require_literal 'validForMs: 2_000'
require_literal 'SELECT pg_sleep(2.1)'
require_literal 'status: "CONSUMED", consumedNow: true'
require_literal 'reason: "ALLOWANCE_EXPIRED"'

if grep -Eq 'it\.(skip|todo)\(|describe\.(skip|todo)\(|retry' "$test_file"; then
  echo "Risk expiry proof must not add skip, todo or retry semantics" >&2
  exit 1
fi

echo "PASS: DEE-796 Risk expiry proof retains bounded validity and unchanged assertions"
