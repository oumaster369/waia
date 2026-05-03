#!/usr/bin/env bash
# Auto-format files the agent just edited.
# Best-effort: never block on failure.

set -u

input=$(cat)

file=""
if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.file_path // .path // empty' 2>/dev/null || true)
fi
if [ -z "$file" ]; then
  file=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)
fi

# Only act on source files in this repo.
case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.md) ;;
  *) printf '{}'; exit 0 ;;
esac

# If the file no longer exists (deleted), do nothing.
[ -f "$file" ] || { printf '{}'; exit 0; }

# Run ESLint --fix and Prettier; ignore failures.
if command -v pnpm >/dev/null 2>&1; then
  pnpm exec eslint --fix "$file" >/dev/null 2>&1 || true
  pnpm exec prettier --write "$file" >/dev/null 2>&1 || true
fi

printf '{}'
exit 0
