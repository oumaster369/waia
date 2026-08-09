#!/usr/bin/env bash
# Bootstrap git worktrees for parallel agent implementation.
# Usage: ./scripts/worktrees/parallel-issue.sh DEE-101 DEE-102 ...
# Requires: git, jq; optional gh for branch slug resolution.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKTREE_ROOT="${WAIA_WORKTREE_ROOT:-$(dirname "$ROOT")/waia-worktrees}"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 DEE-101 [DEE-102 ...]" >&2
  exit 1
fi

cd "$ROOT"
git fetch origin main 2>/dev/null || true
git checkout main
git pull --ff-only origin main 2>/dev/null || true

mkdir -p "$WORKTREE_ROOT"

for IDENT in "$@"; do
  IDENT_UPPER="$(printf '%s' "$IDENT" | tr '[:lower:]' '[:upper:]')"
  NN="${IDENT_UPPER#DEE-}"
  if [[ "$NN" =~ ^[0-9]+$ ]] && [[ "$NN" -lt 100 ]]; then
    NN="$(printf '%02d' "$((10#$NN))")"
  fi

  # Default slug from identifier; override with WAIA_WORKTREE_SLUG_DEE_NN env or Linear branch
  SLUG_VAR="WAIA_WORKTREE_SLUG_${IDENT_UPPER//-/_}"
  SLUG="${!SLUG_VAR:-parallel-task}"
  BRANCH="dee-${NN}-${SLUG}"

  if command -v gh >/dev/null 2>&1; then
    REMOTE_BRANCH="$(git ls-remote --heads origin "$BRANCH" | awk '{print $2}' | sed 's|refs/heads/||')"
    if [[ -z "$REMOTE_BRANCH" ]]; then
      echo "Creating branch ${BRANCH} from main"
      git branch "$BRANCH" main 2>/dev/null || git checkout -b "$BRANCH" main
      git checkout main
    fi
  else
    git branch "$BRANCH" main 2>/dev/null || true
  fi

  DEST="${WORKTREE_ROOT}/${BRANCH}"
  if [[ -d "$DEST" ]]; then
    echo "worktree exists: $DEST (skipping)"
    continue
  fi

  echo "Adding worktree: $DEST → $BRANCH"
  git worktree add "$DEST" "$BRANCH"
done

echo ""
echo "Worktrees ready under: $WORKTREE_ROOT"
echo "Launch parallel agents with: /parallel-implement"
