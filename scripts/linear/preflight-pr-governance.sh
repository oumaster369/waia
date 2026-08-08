#!/usr/bin/env bash
# Local P0 PR governance preflight — mirrors .github/workflows/pr-governance.yml checks.
#
# Usage:
#   PR_TITLE=... PR_BODY=... PR_BRANCH=... [PR_BASE=main] ./scripts/linear/preflight-pr-governance.sh
#   PR_TITLE=... PR_BRANCH=... ./scripts/linear/preflight-pr-governance.sh --body-file path/to/body.md
#
# Env:
#   PR_TITLE      PR title (required)
#   PR_BODY       PR body markdown (required unless --body-file)
#   PR_BRANCH     head branch name (required)
#   PR_BASE       base branch (default: main)
#   LINEAR_API_KEY  optional; enables Linear API scope verification
#
# Exit codes:
#   0 = pass
#   1 = governance failure (blocking)
#   2 = usage / missing required input

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VALIDATOR="${ROOT}/scripts/linear/validate-pr-linear-id.sh"
BODY_FILE=""

usage() {
  cat >&2 <<'EOF'
Usage:
  PR_TITLE=... PR_BODY=... PR_BRANCH=... [PR_BASE=main] ./scripts/linear/preflight-pr-governance.sh
  PR_TITLE=... PR_BRANCH=... ./scripts/linear/preflight-pr-governance.sh --body-file path/to/body.md

Runs the same P0 checks as CI pr-governance (Linear ID + Tier field).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --body-file)
      if [[ $# -lt 2 ]]; then
        echo "error: --body-file requires a path" >&2
        usage
        exit 2
      fi
      BODY_FILE="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

PR_TITLE="${PR_TITLE:-}"
PR_BODY="${PR_BODY:-}"
PR_BRANCH="${PR_BRANCH:-}"
PR_BASE="${PR_BASE:-main}"

if [[ -n "$BODY_FILE" ]]; then
  if [[ ! -f "$BODY_FILE" ]]; then
    echo "error: body file not found: ${BODY_FILE}" >&2
    exit 2
  fi
  PR_BODY="$(cat "$BODY_FILE")"
fi

if [[ -z "$PR_TITLE" || -z "$PR_BODY" || -z "$PR_BRANCH" ]]; then
  echo "error: PR_TITLE, PR_BODY (or --body-file), and PR_BRANCH are required" >&2
  usage
  exit 2
fi

chmod +x "$VALIDATOR"

errors=()

if ! printf '%s' "$PR_BODY" | grep -q '\*\*Tier:\*\*'; then
  errors+=("PR body missing **Tier:** field from pull_request_template.md.")
fi

set +e
validator_err="$(
  MODE=pr-governance \
    PR_TITLE="$PR_TITLE" \
    PR_BODY="$PR_BODY" \
    PR_BRANCH="$PR_BRANCH" \
    PR_BASE="$PR_BASE" \
    "$VALIDATOR" 2>&1
)"
validator_code=$?
set -e

if [[ "$validator_code" -ne 0 ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && errors+=("$line")
  done <<< "$validator_err"
fi

if [[ ${#errors[@]} -gt 0 ]]; then
  printf 'Governance preflight failed:\n' >&2
  for err in "${errors[@]}"; do
    printf '  - %s\n' "$err" >&2
  done
  exit 1
fi

printf 'PASS: PR body satisfies P0 governance preflight\n'
exit 0
