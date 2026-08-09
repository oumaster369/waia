#!/usr/bin/env bash
# Configure merge methods for single-trunk main.
# Usage: ./scripts/github/configure-merge-settings.sh
# Requires: gh CLI authenticated with repo admin access.
#
# Prefer ./scripts/github/apply-single-trunk-cutover.sh for the one-time migration.

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required. Install: https://cli.github.com/" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Configuring merge settings for ${REPO}: squash-only, no auto-merge"

jq -n '{
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  allow_auto_merge: false,
  delete_branch_on_merge: true,
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "BLANK"
}' | gh api -X PATCH "repos/${REPO}" --input - >/dev/null

echo "Done. Integration PRs → main: Squash and merge only."
echo "Official release: Human workflow_dispatch on release.yml for an exact main SHA."
