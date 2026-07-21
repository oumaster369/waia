#!/usr/bin/env bash
# Fail-closed regression validator for FHV operational release identity (DEE-431).
# Ensures active ops docs do not pin literal SHAs as deployment/rehearsal targets.
#
# Usage: ./scripts/ops/validate-fhv-release-identity.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REHEARSAL_CONTRACT="${ROOT}/docs/ops/FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md"
RELEASE_IDENTITY="${ROOT}/docs/ops/FHV-RELEASE-IDENTITY-CONTRACT.md"
RUNBOOK="${ROOT}/docs/ops/EXECUTION-SERVER-RUNBOOK.md"
PREVIOUS_RELEASE_SHA="1744301f6ed31c754b183634daa37372a7d898cb"
FEATURE_HEAD_SHA="dfb7b87c31450e1c494da84acaf5d5582f4daa4d"

fail=0

assert_fail() {
  printf 'FAIL  %s\n' "$1" >&2
  fail=1
}

assert_pass() {
  printf 'PASS  %s\n' "$1"
}

extract_active_section() {
  local file="$1"
  awk '
    /^## Historical evidence/ { stop=1 }
    /^## Status/ { stop=1 }
    stop { next }
    { print }
  ' "$file"
}

assert_not_in_active() {
  local name="$1"
  local file="$2"
  local needle="$3"
  local active
  active="$(extract_active_section "$file")"
  if grep -Fq "$needle" <<<"$active"; then
    assert_fail "$name (active section contains forbidden literal: ${needle:0:12}…)"
  else
    assert_pass "$name"
  fi
}

assert_contains() {
  local name="$1"
  local haystack="$2"
  local needle="$3"
  if grep -Fq -- "$needle" <<<"$haystack"; then
    assert_pass "$name"
  else
    assert_fail "$name (missing required pattern: $needle)"
  fi
}

assert_not_matches() {
  local name="$1"
  local haystack="$2"
  local pattern="$3"
  if grep -Eq -- "$pattern" <<<"$haystack"; then
    assert_fail "$name (matched forbidden pattern)"
  else
    assert_pass "$name"
  fi
}

if [[ ! -f "$REHEARSAL_CONTRACT" ]]; then
  assert_fail "rehearsal contract file missing"
  exit 1
fi

rehearsal_active="$(extract_active_section "$REHEARSAL_CONTRACT")"
release_doc="$(<"$RELEASE_IDENTITY")"

assert_not_in_active \
  "rehearsal contract excludes previous release SHA from active ops" \
  "$REHEARSAL_CONTRACT" \
  "$PREVIOUS_RELEASE_SHA"

assert_not_in_active \
  "rehearsal contract excludes abbreviated previous release SHA" \
  "$REHEARSAL_CONTRACT" \
  "1744301f"

assert_not_matches \
  "rehearsal active section has no literal --target-sha 40-char SHA" \
  "$rehearsal_active" \
  '--target-sha [0-9a-f]{40}'

assert_contains \
  "rehearsal active section requires EXECUTION_SERVER_TARGET_SHA variable" \
  "$rehearsal_active" \
  '--target-sha "$EXECUTION_SERVER_TARGET_SHA"'

assert_contains \
  "release identity contract defines UNRESOLVED_UNTIL_NEXT_RELEASE" \
  "$release_doc" \
  "EXECUTION_SERVER_TARGET_SHA=UNRESOLVED_UNTIL_NEXT_RELEASE"

assert_contains \
  "release identity contract forbids feature squash SHA as release target" \
  "$release_doc" \
  "Feature branch squash SHA"

assert_contains \
  "release identity contract forbids prior release SHA as next target" \
  "$release_doc" \
  "Prior release SHA"

assert_not_in_active \
  "runbook active FHV section excludes previous release SHA" \
  "$RUNBOOK" \
  "$PREVIOUS_RELEASE_SHA"

assert_not_in_active \
  "runbook active FHV section excludes feature head SHA" \
  "$RUNBOOK" \
  "$FEATURE_HEAD_SHA"

if [[ $fail -ne 0 ]]; then
  echo "validate-fhv-release-identity: FAILED" >&2
  exit 1
fi

echo "validate-fhv-release-identity: all checks passed"
