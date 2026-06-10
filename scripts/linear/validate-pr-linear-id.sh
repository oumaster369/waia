#!/usr/bin/env bash
# Validate PR ↔ Linear ID consistency (P0 governance).
#
# Usage:
#   MODE=pr-governance PR_TITLE=... PR_BODY=... PR_BRANCH=... ./scripts/linear/validate-pr-linear-id.sh
#   MODE=linear-done  PR_TITLE=... PR_BODY=... PR_BRANCH=... ./scripts/linear/validate-pr-linear-id.sh
#
# Env:
#   MODE          pr-governance | linear-done (required)
#   PR_TITLE      PR title
#   PR_BODY       PR body (markdown)
#   PR_BRANCH     head branch name
#   LINEAR_API_KEY  optional; enables Linear title/scope verification
#
# Exit codes (pr-governance):
#   0 = pass
#   1 = governance failure (blocking)
#
# Exit codes (linear-done):
#   0 = safe to mark Done (prints RESOLVED_DEE_ID=...)
#   2 = ambiguous / skip auto-close (prints reason to stdout)

set -euo pipefail

MODE="${MODE:-}"
PR_TITLE="${PR_TITLE:-}"
PR_BODY="${PR_BODY:-}"
PR_BRANCH="${PR_BRANCH:-}"
LINEAR_API_KEY="${LINEAR_API_KEY:-}"

if [[ -z "$MODE" ]]; then
  echo "error: MODE must be pr-governance or linear-done" >&2
  exit 1
fi

failures=()
warnings=()

add_failure() { failures+=("$1"); }
add_warning() { warnings+=("$1"); }

upper_id() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

extract_first_dee() {
  printf '%s' "$1" | grep -oiE 'DEE-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]' || true
}

# Canonical source: **Linear:** `DEE-NN` or **Linear:** DEE-NN (with optional link text)
extract_explicit_linear() {
  local body="$1"
  local id=""
  id="$(
    printf '%s' "$body" \
      | grep -oiE '\*\*Linear:\*\*[[:space:]]*(`DEE-[0-9]+`|DEE-[0-9]+|\[DEE-[0-9]+\])' \
      | head -1 \
      | grep -oiE 'DEE-[0-9]+' \
      | head -1 \
      | tr '[:lower:]' '[:upper:]' \
      || true
  )"
  if [[ -z "$id" ]]; then
    id="$(
      printf '%s' "$body" \
        | grep -oiE '\*\*Linear:\*\*[^`]*DEE-[0-9]+' \
        | head -1 \
        | grep -oiE 'DEE-[0-9]+' \
        | head -1 \
        | tr '[:lower:]' '[:upper:]' \
        || true
    )"
  fi
  printf '%s' "$id"
}

extract_branch_nn() {
  local branch="$1"
  if [[ "$branch" =~ ^dee-([0-9]+)- ]]; then
    local nn="${BASH_REMATCH[1]}"
    if [[ "$nn" -lt 100 ]]; then
      printf 'DEE-%02d' "$((10#$nn))"
    else
      printf 'DEE-%s' "$nn"
    fi
    return 0
  fi
  printf ''
}

normalize_tokens() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/`//g; s/\*\*//g; s/[^a-z0-9]+/ /g' \
    | tr ' ' '\n' \
    | grep -E '.{3,}' \
    | grep -viE '^(the|and|for|with|from|into|dee|fix|feat|docs|chore|infra|implement|add|update|merge|pull|request|waia|dev|os)$' \
    | sort -u \
    || true
}

scope_overlap_ok() {
  local issue_title="$1"
  local pr_title="$2"
  local issue_tokens pr_tokens shared count
  issue_tokens="$(normalize_tokens "$issue_title")"
  pr_tokens="$(normalize_tokens "$pr_title")"
  if [[ -z "$issue_tokens" || -z "$pr_tokens" ]]; then
    return 0
  fi
  shared="$(
    comm -12 \
      <(printf '%s\n' "$issue_tokens") \
      <(printf '%s\n' "$pr_tokens") \
      | wc -l \
      | tr -d ' '
  )"
  if [[ "$shared" -ge 1 ]]; then
    return 0
  fi
  return 1
}

check_disclaimer_collision() {
  local body="$1"
  local title="$2"
  local branch="$3"
  local disclaimer_id title_id branch_id
  disclaimer_id="$(
    printf '%s' "$body" \
      | grep -oiE 'do[[:space:]]+not[[:space:]]+use[[:space:]]+DEE-[0-9]+' \
      | grep -oiE 'DEE-[0-9]+' \
      | head -1 \
      | tr '[:lower:]' '[:upper:]' \
      || true
  )"
  if [[ -z "$disclaimer_id" ]]; then
    return 0
  fi
  title_id="$(extract_first_dee "$title")"
  branch_id="$(extract_branch_nn "$branch")"
  if [[ "$disclaimer_id" == "$title_id" || "$disclaimer_id" == "$branch_id" ]]; then
    add_failure "PR body disclaims \`${disclaimer_id}\` (\"do NOT use\") but PR title/branch still references the same id."
    return 1
  fi
  return 0
}

fetch_linear_title() {
  local identifier="$1"
  local api='https://api.linear.app/graphql'
  local query='query($id: String!) { issue(id: $id) { identifier title } }'
  local json title
  json="$(
    curl -sf "$api" \
      -H 'Content-Type: application/json' \
      -H "Authorization: ${LINEAR_API_KEY}" \
      -d "$(jq -nc --arg id "$identifier" '{query: $query, variables: {id: $id}}')" \
      2>/dev/null || true
  )"
  title="$(printf '%s' "$json" | jq -r '.data.issue.title // empty' 2>/dev/null || true)"
  if [[ -z "$title" ]]; then
    return 1
  fi
  printf '%s' "$title"
  return 0
}

# --- validation ---

explicit_id="$(extract_explicit_linear "$PR_BODY")"
title_id="$(extract_first_dee "$PR_TITLE")"
branch_id="$(extract_branch_nn "$PR_BRANCH")"

if [[ -z "$explicit_id" ]]; then
  add_failure 'PR body missing explicit **Linear:** `DEE-NN` field (required — do not rely on title/branch alone).'
fi

if [[ -n "$title_id" && -n "$explicit_id" && "$title_id" != "$explicit_id" ]]; then
  add_failure "PR title references \`${title_id}\` but **Linear:** field declares \`${explicit_id}\`."
fi

if [[ -n "$branch_id" && -n "$explicit_id" && "$branch_id" != "$explicit_id" ]]; then
  add_failure "Branch \`${PR_BRANCH}\` implies \`${branch_id}\` but **Linear:** field declares \`${explicit_id}\`."
fi

dee_branch_ok=false
if [[ "$PR_BRANCH" =~ ^dee-[0-9]{2,}-[a-z0-9-]+$ ]]; then
  dee_branch_ok=true
elif [[ -n "$PR_BRANCH" ]]; then
  add_failure "Branch \`${PR_BRANCH}\` does not match \`dee-<NN>-<slug>\`."
fi

if [[ "$dee_branch_ok" == true && -z "$branch_id" && -n "$explicit_id" ]]; then
  add_failure "Could not parse issue number from branch \`${PR_BRANCH}\`."
fi

check_disclaimer_collision "$PR_BODY" "$PR_TITLE" "$PR_BRANCH" || true

resolved_id="$explicit_id"

if [[ -n "$resolved_id" && -n "${LINEAR_API_KEY:-}" ]]; then
  issue_title="$(fetch_linear_title "$resolved_id" || true)"
  if [[ -z "$issue_title" ]]; then
    add_failure "Linear issue \`${resolved_id}\` could not be resolved via API."
  else
    if ! scope_overlap_ok "$issue_title" "$PR_TITLE"; then
      add_failure "Linear issue title materially differs from PR scope: issue=\"${issue_title}\" vs PR title=\"${PR_TITLE}\"."
    fi
  fi
elif [[ -n "$resolved_id" ]]; then
  add_warning 'LINEAR_API_KEY not set — skipping Linear API title/scope verification.'
fi

# --- output ---

if [[ ${#warnings[@]} -gt 0 ]]; then
  printf 'Warnings:\n' >&2
  for w in "${warnings[@]}"; do
    printf '  - %s\n' "$w" >&2
  done
fi

if [[ ${#failures[@]} -gt 0 ]]; then
  printf 'Governance failures:\n' >&2
  for f in "${failures[@]}"; do
    printf '  - %s\n' "$f" >&2
  done
  if [[ "$MODE" == "linear-done" ]]; then
    printf 'SKIP_LINEAR_DONE=1\n'
    printf 'SKIP_REASON=governance_validation_failed\n'
    exit 2
  fi
  exit 1
fi

if [[ -z "$resolved_id" ]]; then
  if [[ "$MODE" == "linear-done" ]]; then
    printf 'SKIP_LINEAR_DONE=1\n'
    printf 'SKIP_REASON=missing_explicit_linear_field\n'
    exit 2
  fi
  exit 1
fi

printf 'RESOLVED_DEE_ID=%s\n' "$resolved_id"

if [[ "$MODE" == "linear-done" ]]; then
  exit 0
fi

exit 0
