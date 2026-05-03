#!/usr/bin/env bash
# Append every agent stop / subagent-stop event to a JSONL audit log.
# The log is gitignored — it's local observability, not source.

set -u

input=$(cat)
log_file=".cursor/agent-log.jsonl"

mkdir -p "$(dirname "$log_file")" 2>/dev/null || true

ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

if command -v jq >/dev/null 2>&1; then
  printf '%s' "$input" | jq -c \
    --arg ts "$ts" \
    --arg branch "$branch" \
    '{ts: $ts, branch: $branch, event: .}' >> "$log_file" 2>/dev/null || true
else
  # Fallback: just dump raw input with a timestamp header line.
  {
    printf '{"ts":"%s","branch":"%s","event":' "$ts" "$branch"
    printf '%s' "$input"
    printf '}\n'
  } >> "$log_file" 2>/dev/null || true
fi

printf '{}'
exit 0
