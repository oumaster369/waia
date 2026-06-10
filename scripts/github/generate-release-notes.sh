#!/usr/bin/env bash
# Generate release notes from commits since the last tag.
# Usage: ./scripts/github/generate-release-notes.sh [base-ref]
# Output: markdown on stdout

set -euo pipefail

BASE_REF="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "$BASE_REF" ]]; then
  BASE_REF="$(git describe --tags --abbrev=0 2>/dev/null || echo "")"
fi

if [[ -n "$BASE_REF" ]]; then
  RANGE="${BASE_REF}..HEAD"
else
  RANGE="HEAD~50..HEAD"
  BASE_REF="(last 50 commits)"
fi

echo "## WAIA release"
echo ""
echo "Range: \`${RANGE}\`"
echo ""

COMMITS="$(git log --pretty=format:'%s (%h)' "$RANGE" 2>/dev/null || git log --pretty=format:'%s (%h)' -50)"

if [[ -z "$COMMITS" ]]; then
  echo "_No commits in range._"
  exit 0
fi

echo "### Linear-linked changes"
echo ""
printf '%s\n' "$COMMITS" | grep -iE 'DEE-[0-9]+' | sed 's/^/- /' || echo "_No DEE-NN commits in range._"
echo ""

echo "### All commits"
echo ""
printf '%s\n' "$COMMITS" | sed 's/^/- /'
