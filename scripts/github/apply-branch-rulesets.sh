#!/usr/bin/env bash
# Upsert GitHub repository ruleset for dev + main protection.
# Usage: ./scripts/github/apply-branch-rulesets.sh
# Requires: gh CLI authenticated with repo admin access.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RULESET_FILE="${ROOT}/.github/rulesets/dev-main-protection.json"
RULESET_NAME="WAIA dev + main protection"

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

EXISTING_ID="$(
  gh api "repos/${REPO}/rulesets" --paginate \
    | jq -r --arg name "$RULESET_NAME" '.[] | select(.name == $name) | .id' \
    | head -1
)"

if [[ -n "$EXISTING_ID" && "$EXISTING_ID" != "null" ]]; then
  echo "Updating existing ruleset id=${EXISTING_ID}"
  gh api -X PUT "repos/${REPO}/rulesets/${EXISTING_ID}" \
    --input "$RULESET_FILE" >/dev/null
else
  echo "Creating new ruleset"
  gh api -X POST "repos/${REPO}/rulesets" \
    --input "$RULESET_FILE" >/dev/null
fi

echo "Done. Verify in GitHub → Settings → Rules → Rulesets."
