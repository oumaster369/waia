#!/usr/bin/env bash
# Upsert GitHub repository ruleset for canonical main protection (single-trunk).
# Usage: ./scripts/github/apply-branch-rulesets.sh
# Requires: gh CLI authenticated with repo admin access.
#
# Prefer ./scripts/github/apply-single-trunk-cutover.sh for the one-time migration
# (also retires obsolete dual-branch rulesets and sets default_branch).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RULESET_FILE="${ROOT}/.github/rulesets/main-protection.json"
RULESET_NAME="WAIA main protection"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required. Install: https://cli.github.com/" >&2
  exit 1
fi

if [[ ! -f "$RULESET_FILE" ]]; then
  echo "error: missing ruleset file: $RULESET_FILE" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Applying ruleset to ${REPO} from ${RULESET_FILE}"

MATCHING_IDS="$(
  gh api "repos/${REPO}/rulesets" --paginate \
    | jq -r --arg name "$RULESET_NAME" '[.[] | select(.name == $name) | .id] | .[]'
)"
MATCH_COUNT="$(printf '%s\n' "$MATCHING_IDS" | grep -c '^[0-9]' || true)"

if [[ "$MATCH_COUNT" -gt 1 ]]; then
  echo "error: multiple rulesets named '${RULESET_NAME}' found — refuse to mutate ambiguously: ${MATCHING_IDS}" >&2
  exit 1
fi

EXISTING_ID="$(printf '%s\n' "$MATCHING_IDS" | head -1)"

if [[ -n "$EXISTING_ID" && "$EXISTING_ID" != "null" ]]; then
  echo "Updating existing ruleset id=${EXISTING_ID}"
  gh api -X PUT "repos/${REPO}/rulesets/${EXISTING_ID}" \
    --input "$RULESET_FILE" >/dev/null
else
  echo "Creating new ruleset"
  gh api -X POST "repos/${REPO}/rulesets" \
    --input "$RULESET_FILE" >/dev/null
fi

echo "Done. Verify with ./scripts/github/verify-single-trunk-cutover.sh"
