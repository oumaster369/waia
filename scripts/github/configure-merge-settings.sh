#!/usr/bin/env bash
# Configure merge methods for single-trunk main.
# Usage: ./scripts/github/configure-merge-settings.sh
# Requires: gh CLI authenticated with repo admin access.
#
# Policy (docs/waia-governance/BRANCHING-STRATEGY.md):
#   - Squash only for feature/fix/governance PRs → main
#   - Merge commits disabled (legacy release/back-sync topology retired)
#   - Rebase merges disabled
#   - Auto-merge disabled (explicit Human merge discipline)
#   - Delete branch on merge enabled
#
# Prefer ./scripts/github/apply-single-trunk-cutover.sh for the one-time migration.

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required. Install: https://cli.github.com/" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Configuring merge settings for ${REPO}: squash-only, no auto-merge"

gh api -X PATCH "repos/${REPO}" \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f allow_auto_merge=false \
  -f delete_branch_on_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=BLANK \
  >/dev/null

echo "Done. Integration PRs → main: Squash and merge only."
echo "Official release: Human workflow_dispatch on release.yml for an exact main SHA."
