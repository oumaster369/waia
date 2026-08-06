#!/usr/bin/env bash
# Snapshot FHV full-corpus evidence into an immutable staging directory for CI upload.
# Semantics-preserving: never mutates trading/accounting state; never upgrades FAIL→PASS.
#
# Usage:
#   snapshot-fhv-full-corpus-failure-evidence.sh \
#     --artifact-root <path> \
#     --staging-root <path> \
#     [--primary-exit-code <n>] \
#     [--kill-pattern <regex>]
set -euo pipefail

ARTIFACT_ROOT=""
STAGING_ROOT=""
PRIMARY_EXIT_CODE=""
SKIP_KILL=0
KILL_PATTERN='(vitest|node).*fhv-official|(vitest).*official-scale|test:fhv:official-scale:full-corpus'

usage() {
  cat <<'EOF' >&2
Usage: snapshot-fhv-full-corpus-failure-evidence.sh --artifact-root DIR --staging-root DIR [--primary-exit-code N]
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-root)
      ARTIFACT_ROOT="${2:-}"
      shift 2
      ;;
    --staging-root)
      STAGING_ROOT="${2:-}"
      shift 2
      ;;
    --primary-exit-code)
      PRIMARY_EXIT_CODE="${2:-}"
      shift 2
      ;;
    --kill-pattern)
      KILL_PATTERN="${2:-}"
      shift 2
      ;;
    --skip-kill)
      SKIP_KILL=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      ;;
  esac
done

[[ -n "$ARTIFACT_ROOT" && -n "$STAGING_ROOT" ]] || usage

mkdir -p "$STAGING_ROOT"
MANIFEST="$STAGING_ROOT/fhv-full-corpus-failure-evidence-manifest.v1.json"
MISSING_LIST="$STAGING_ROOT/missing-required-evidence.txt"
: >"$MISSING_LIST"

terminate_corpus_children() {
  # Best-effort: stop mutation before walking/copying. Do not fail the snapshot if none match.
  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -f "$KILL_PATTERN" 2>/dev/null || true
    sleep 2
    pkill -KILL -f "$KILL_PATTERN" 2>/dev/null || true
  fi
  # Also stop stray vitest workers that still hold the artifact tree open.
  if command -v pgrep >/dev/null 2>&1; then
    while read -r pid; do
      [[ -n "$pid" ]] || continue
      kill -TERM "$pid" 2>/dev/null || true
    done < <(pgrep -f 'vitest.*fhv-official-full-corpus|fhv-official-full-corpus.test' || true)
    sleep 1
    while read -r pid; do
      [[ -n "$pid" ]] || continue
      kill -KILL "$pid" 2>/dev/null || true
    done < <(pgrep -f 'vitest.*fhv-official-full-corpus|fhv-official-full-corpus.test' || true)
  fi
}

copy_stable_file() {
  local src="$1"
  local dest="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -p "$src" "$dest" 2>/dev/null || cp "$src" "$dest"
    return 0
  fi
  echo "$src" >>"$MISSING_LIST"
  return 1
}

# Copy a directory tree but skip transient checkpoint temp dirs and follow only completed epoch dirs.
# Transient names: .epoch-N.tmp-*  (publication in progress)
# Also skip epoch dirs that lack checkpoint-manifest + .ready (incomplete).
copy_checkpoints_stable() {
  local src_parent="$1"
  local dest_parent="$2"
  mkdir -p "$dest_parent"
  [[ -d "$src_parent" ]] || {
    echo "$src_parent" >>"$MISSING_LIST"
    return 0
  }

  local entry name
  for entry in "$src_parent"/* "$src_parent"/.[!.]*; do
    [[ -e "$entry" ]] || continue
    name="$(basename "$entry")"
    # Never traverse publication temp directories.
    if [[ "$name" == .epoch-*.tmp-* ]]; then
      echo "skipped_transient:$entry" >>"$MISSING_LIST"
      continue
    fi
    if [[ "$name" == "summaries" && -d "$entry" ]]; then
      mkdir -p "$dest_parent/summaries"
      cp -a "$entry"/. "$dest_parent/summaries/" 2>/dev/null || true
      continue
    fi
    if [[ "$name" =~ ^epoch-[0-9]+$ && -d "$entry" ]]; then
      if [[ -f "$entry/checkpoint-manifest.v1.json" && -f "$entry/.ready" ]]; then
        mkdir -p "$dest_parent/$name"
        # Copy files only (no nested live mutation). Ignore races with ENOENT.
        (
          set +e
          cp -a "$entry"/. "$dest_parent/$name/" 2>/dev/null
        ) || echo "partial_checkpoint_copy:$entry" >>"$MISSING_LIST"
      else
        echo "skipped_incomplete_checkpoint:$entry" >>"$MISSING_LIST"
      fi
      continue
    fi
  done
}

if [[ "$SKIP_KILL" -eq 0 ]]; then
  terminate_corpus_children
fi

PROGRESS_SRC="$ARTIFACT_ROOT/fhv-full-historical-progress.v1.json"
PROGRESS_JSONL_SRC="$ARTIFACT_ROOT/fhv-full-historical-progress.v1.jsonl"
METRICS_SRC="$ARTIFACT_ROOT/fhv-official-scale-metrics.v1.json"
IDENTITY_SRC="$ARTIFACT_ROOT/fhv-artifact-identity.v1.json"
RUN_DIR=""
# Prefer the canonical full-corpus run directory when present.
for candidate in \
  "$ARTIFACT_ROOT/RI-P7/fhv-full-historical/fhv-official-scale-full-corpus" \
  "$ARTIFACT_ROOT/fhv-full-historical/fhv-official-scale-full-corpus"; do
  if [[ -d "$candidate" ]]; then
    RUN_DIR="$candidate"
    break
  fi
done

copy_stable_file "$PROGRESS_SRC" "$STAGING_ROOT/fhv-full-historical-progress.v1.json" || true
# Append-only time series: the only record of throughput decay when the step is killed.
copy_stable_file "$PROGRESS_JSONL_SRC" "$STAGING_ROOT/fhv-full-historical-progress.v1.jsonl" || true
# Also accept progress nested under the run dir.
if [[ -n "$RUN_DIR" ]]; then
  copy_stable_file \
    "$RUN_DIR/fhv-full-historical-progress.v1.json" \
    "$STAGING_ROOT/run/fhv-full-historical-progress.v1.json" || true
  copy_stable_file \
    "$RUN_DIR/fhv-full-historical-progress.v1.jsonl" \
    "$STAGING_ROOT/run/fhv-full-historical-progress.v1.jsonl" || true
  copy_stable_file \
    "$RUN_DIR/fhv-launch-journal.v1.json" \
    "$STAGING_ROOT/run/fhv-launch-journal.v1.json" || true
  copy_stable_file \
    "$RUN_DIR/fhv-full-launch-result.v1.json" \
    "$STAGING_ROOT/run/fhv-full-launch-result.v1.json" || true
  copy_stable_file \
    "$RUN_DIR/fhv-full-launch-receipt.v1.json" \
    "$STAGING_ROOT/run/fhv-full-launch-receipt.v1.json" || true
  copy_checkpoints_stable "$RUN_DIR/checkpoints" "$STAGING_ROOT/run/checkpoints"
fi

copy_stable_file "$METRICS_SRC" "$STAGING_ROOT/fhv-official-scale-metrics.v1.json" || true
copy_stable_file "$IDENTITY_SRC" "$STAGING_ROOT/fhv-artifact-identity.v1.json" || true

# Record identity triad files if present next to metrics.
for name in FINAL_HEAD EXECUTED_SHA BASE_SHA; do
  copy_stable_file "$ARTIFACT_ROOT/$name" "$STAGING_ROOT/$name" || true
done

MISSING_COUNT="$(wc -l <"$MISSING_LIST" | tr -d ' ')"
COMPLETED_CHECKPOINT_COUNT=0
if [[ -d "$STAGING_ROOT/run/checkpoints" ]]; then
  COMPLETED_CHECKPOINT_COUNT="$(find "$STAGING_ROOT/run/checkpoints" -maxdepth 1 -type d -name 'epoch-*' | wc -l | tr -d ' ')"
fi

python3 - <<PY
import json, os, datetime
manifest = {
  "schemaVersion": "fhv-full-corpus-failure-evidence-manifest/v1",
  "capturedAtUtc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "artifactRoot": os.path.abspath("$ARTIFACT_ROOT"),
  "stagingRoot": os.path.abspath("$STAGING_ROOT"),
  "runDir": os.path.abspath("$RUN_DIR") if "$RUN_DIR" else None,
  "primaryExitCode": int("$PRIMARY_EXIT_CODE") if "$PRIMARY_EXIT_CODE".strip() != "" else None,
  "completedCheckpointCount": int("$COMPLETED_CHECKPOINT_COUNT"),
  "missingRequiredEvidenceCount": int("$MISSING_COUNT"),
  "missingRequiredEvidencePath": "missing-required-evidence.txt",
  "classification": "FHV_FULL_CORPUS_FAILURE_EVIDENCE_STAGED",
  "passUpgraded": False,
}
with open("$MANIFEST", "w", encoding="utf-8") as fh:
  fh.write(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
PY

# Always exit 0 so CI can upload staging; primary step failure remains the job failure.
exit 0
