#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUNNER="$ROOT/scripts/github/run-unit-tests-with-bounded-progress.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_case() {
  name="$1"
  expected="$2"
  shift 2
  output="$TMP/${name}.out"
  set +e
  WAIA_UNIT_LOG_FILE="$TMP/${name}.log" \
    WAIA_PROGRESS_INTERVAL_SECONDS=1 \
    WAIA_UNIT_TIMEOUT_SECONDS=4 \
    "$RUNNER" "$@" >"$output" 2>&1
  actual=$?
  set -e
  [[ "$actual" -eq "$expected" ]] || fail "$name expected $expected, got $actual"
}

run_case success 0 bash -c 'echo success-marker'
grep -q 'success-marker' "$TMP/success.out" || fail "success tail missing"

run_case failure 23 bash -c 'echo failure-marker; exit 23'
grep -q 'complete unit-test log' "$TMP/failure.out" || fail "failure log header missing"
grep -q 'failure-marker' "$TMP/failure.out" || fail "failure log content missing"

timeout_output="$TMP/timeout.out"
set +e
WAIA_UNIT_LOG_FILE="$TMP/timeout.log" \
  WAIA_PROGRESS_INTERVAL_SECONDS=1 \
  WAIA_UNIT_TIMEOUT_SECONDS=2 \
  "$RUNNER" bash -c 'echo timeout-marker; sleep 30' >"$timeout_output" 2>&1
timeout_status=$?
set -e
[[ "$timeout_status" -eq 124 ]] || fail "timeout expected 124, got $timeout_status"
grep -q 'bounded unit-test progress' "$timeout_output" || fail "bounded progress missing"
grep -q 'timeout-marker' "$timeout_output" || fail "timeout complete log missing"

stubborn_output="$TMP/stubborn.out"
stubborn_started=$SECONDS
set +e
WAIA_UNIT_LOG_FILE="$TMP/stubborn.log" \
  WAIA_PROGRESS_INTERVAL_SECONDS=1 \
  WAIA_UNIT_TIMEOUT_SECONDS=1 \
  WAIA_TERM_GRACE_SECONDS=1 \
  "$RUNNER" bash -c 'trap "" TERM; echo stubborn-marker; while :; do :; done' \
    >"$stubborn_output" 2>&1
stubborn_status=$?
set -e
stubborn_elapsed=$((SECONDS - stubborn_started))
[[ "$stubborn_status" -eq 124 ]] || fail "TERM-ignoring timeout expected 124, got $stubborn_status"
[[ "$stubborn_elapsed" -lt 6 ]] || fail "TERM-ignoring timeout was not bounded (${stubborn_elapsed}s)"
grep -q 'sending KILL' "$stubborn_output" || fail "TERM-ignoring KILL escalation missing"
grep -q 'stubborn-marker' "$stubborn_output" || fail "TERM-ignoring complete log missing"

term_output="$TMP/term.out"
WAIA_UNIT_LOG_FILE="$TMP/term.log" \
  WAIA_PROGRESS_INTERVAL_SECONDS=1 \
  WAIA_UNIT_TIMEOUT_SECONDS=30 \
  "$RUNNER" bash -c 'echo term-marker; sleep 30' >"$term_output" 2>&1 &
wrapper_pid=$!
sleep 1
kill -TERM "$wrapper_pid"
set +e
wait "$wrapper_pid"
term_status=$?
set -e
[[ "$term_status" -eq 143 ]] || fail "TERM expected 143, got $term_status"
grep -q 'interrupted by TERM' "$term_output" || fail "TERM notice missing"
grep -q 'term-marker' "$term_output" || fail "TERM complete log missing"

grep -q 'pnpm test --run --reporter=dot' "$ROOT/.github/workflows/ci.yml" \
  || fail "authoritative full test command changed or missing"
grep -q 'WAIA_UNIT_TIMEOUT_SECONDS=3600' "$ROOT/.github/workflows/ci.yml" \
  || fail "explicit 3600-second inner unit watchdog missing"
grep -q 'timeout-minutes: 70' "$ROOT/.github/workflows/ci.yml" \
  || fail "explicit 70-minute outer unit job timeout missing"

echo "PASS: bounded unit-test diagnostic wrapper"
