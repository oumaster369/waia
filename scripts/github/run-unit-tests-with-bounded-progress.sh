#!/usr/bin/env bash
set -uo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 64
fi

log_file="${WAIA_UNIT_LOG_FILE:-${RUNNER_TEMP:-/tmp}/waia-unit-tests.log}"
progress_interval="${WAIA_PROGRESS_INTERVAL_SECONDS:-60}"
timeout_seconds="${WAIA_UNIT_TIMEOUT_SECONDS:-2700}"
termination_grace_seconds="${WAIA_TERM_GRACE_SECONDS:-10}"

for value_name in progress_interval timeout_seconds termination_grace_seconds; do
  value="${!value_name}"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "${value_name} must be a positive integer" >&2
    exit 64
  fi
done

mkdir -p "$(dirname "$log_file")"
: >"$log_file"
timeout_marker="${log_file}.timeout"
rm -f "$timeout_marker"

child_pid=""
progress_pid=""
watchdog_pid=""
child_has_own_group=0

stop_helpers() {
  [[ -n "$progress_pid" ]] && kill "$progress_pid" 2>/dev/null || true
  [[ -n "$watchdog_pid" ]] && kill "$watchdog_pid" 2>/dev/null || true
}

signal_child() {
  child_signal="$1"
  [[ -n "$child_pid" ]] || return 0
  if [[ "$child_has_own_group" -eq 1 ]]; then
    kill "-$child_signal" -- "-$child_pid" 2>/dev/null || true
  else
    kill "-$child_signal" "$child_pid" 2>/dev/null || true
  fi
}

child_is_alive() {
  [[ -n "$child_pid" ]] || return 1
  if [[ "$child_has_own_group" -eq 1 ]]; then
    kill -0 -- "-$child_pid" 2>/dev/null
  else
    kill -0 "$child_pid" 2>/dev/null
  fi
}

terminate_child_bounded() {
  child_is_alive || return 0
  signal_child TERM
  grace_elapsed=0
  while child_is_alive && [[ "$grace_elapsed" -lt "$termination_grace_seconds" ]]; do
    sleep 1
    grace_elapsed=$((grace_elapsed + 1))
  done
  if child_is_alive; then
    echo "unit-test command ignored TERM for ${termination_grace_seconds}s; sending KILL" >&2
    signal_child KILL
  fi
}

print_full_log() {
  echo "---- complete unit-test log ----"
  cat "$log_file" 2>/dev/null || true
  echo "---- end unit-test log ----"
}

handle_signal() {
  signal="$1"
  status="$2"
  trap - INT TERM
  terminate_child_bounded
  wait "$child_pid" 2>/dev/null || true
  stop_helpers
  echo "unit-test command interrupted by ${signal}" >&2
  print_full_log
  exit "$status"
}

trap 'handle_signal TERM 143' TERM
trap 'handle_signal INT 130' INT

if command -v setsid >/dev/null 2>&1; then
  setsid "$@" >"$log_file" 2>&1 &
  child_has_own_group=1
else
  "$@" >"$log_file" 2>&1 &
fi
child_pid=$!

(
  while kill -0 "$child_pid" 2>/dev/null; do
    sleep "$progress_interval"
    kill -0 "$child_pid" 2>/dev/null || break
    echo "---- bounded unit-test progress $(date -u +%FT%TZ) ----"
    tail -n 12 "$log_file" 2>/dev/null || true
  done
) &
progress_pid=$!

(
  sleep "$timeout_seconds"
  if child_is_alive; then
    : >"$timeout_marker"
    terminate_child_bounded
  fi
) &
watchdog_pid=$!

set +e
wait "$child_pid"
test_status=$?
set -e
stop_helpers
wait "$progress_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true
trap - INT TERM

if [[ -f "$timeout_marker" ]]; then
  rm -f "$timeout_marker"
  echo "unit-test command exceeded ${timeout_seconds}s diagnostic timeout" >&2
  print_full_log
  exit 124
fi

if [[ "$test_status" -eq 0 ]]; then
  tail -n 80 "$log_file"
else
  print_full_log
fi
exit "$test_status"
