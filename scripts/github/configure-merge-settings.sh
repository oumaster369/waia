#!/usr/bin/env bash
# Configure squash-only merges for the repository (integration hygiene).
# Usage: ./scripts/github/configure-merge-settings.sh
# Requires: gh CLI authenticated with repo admin access.

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required. Install: https://cli.github.com/" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Configuring merge settings for ${REPO}: squash-only"

gh api -X PATCH "repos/${REPO}" \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=BLANK \
  >/dev/null

echo "Done. PRs into dev should use squash merge (one commit per atomic issue)."
