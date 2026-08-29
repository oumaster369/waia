#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/tests/unit/fhv-authoritative-run-chain.test.ts"

require() {
  rg -q --fixed-strings "$1" "$TARGET" || {
    printf 'FAIL: missing protected proof: %s\n' "$1" >&2
    exit 1
  }
}

forbidden() {
  if rg -q --fixed-strings "$1" "$TARGET"; then
    printf 'FAIL: external timing-race surface restored: %s\n' "$1" >&2
    exit 1
  fi
}

require "testOnlyPauseAfterCycles: FHV_REHEARSAL_CHECKPOINT_CYCLE"
require 'expect(chainRead.authoritativeGapCount).toBe(0)'
require 'expect(chainRead.authoritativeDuplicateCount).toBe(0)'
require 'expect(chainRead.semanticParityDigest).toBe(uninterruptedDigest)'
require 'expect(readFhvEvidenceHealth(pauseResumeDir)).toBe("ok")'
forbidden "waitForFhvRehearsalCycles"
forbidden "writeFhvCampaignControlPauseRequest"

printf 'PASS: DEE-790 deterministic boundary and protected assertions are intact\n'
