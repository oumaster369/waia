#!/usr/bin/env bash
# Configure merge methods for the repository (integration hygiene).
# Usage: ./scripts/github/configure-merge-settings.sh
# Requires: gh CLI authenticated with repo admin access.
#
# Policy (see docs/waia-governance/BRANCHING-STRATEGY.md "Merge strategy"):
#   - Squash stays the DEFAULT (squash title/message) for feature/fix/governance PRs → dev.
#   - Merge commits are ENABLED so humans can pick "Create a merge commit" for the two
#     classes that require it: release promotion (dev→main) and back-sync (main→dev).
#     Squash cannot preserve a second parent, so those classes need real merge commits
#     or dev/main ancestry drifts (FAILURE-PATTERNS.md FP-010).
#   - Rebase merges remain disabled.
#
# CONSEQUENCE: enabling merge commits is repo-wide — GitHub will offer "Create a merge
# commit" on every PR. Humans must consciously keep choosing SQUASH for feature PRs and
# use merge commits ONLY for release/back-sync PRs. Applying this is an Architect-approved
# one-time admin action.

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required. Install: https://cli.github.com/" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Configuring merge settings for ${REPO}: squash default + merge-commit enabled for release/back-sync"

gh api -X PATCH "repos/${REPO}" \
  -f allow_squash_merge=true \
  -f allow_merge_commit=true \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=BLANK \
  >/dev/null

echo "Done. Feature PRs → dev: use Squash and merge (default)."
echo "Release promotion (dev→main) and back-sync (main→dev): use Create a merge commit, never squash."
