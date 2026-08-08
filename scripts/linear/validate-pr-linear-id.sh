#!/usr/bin/env bash
# Validate PR ↔ Linear ID consistency (P0 governance).
#
# Usage:
#   MODE=pr-governance PR_TITLE=... PR_BODY=... PR_BRANCH=... PR_BASE=... ./scripts/linear/validate-pr-linear-id.sh
#   MODE=linear-done  PR_TITLE=... PR_BODY=... PR_BRANCH=... ./scripts/linear/validate-pr-linear-id.sh
#
# Env:
#   MODE          pr-governance | linear-done (required)
#   PR_TITLE      PR title
#   PR_BODY       PR body (markdown)
#   PR_BRANCH     head branch name
#   PR_BASE       base branch name (optional; must be main under single-trunk)
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
PR_BASE="${PR_BASE:-}"
LINEAR_API_KEY="${LINEAR_API_KEY:-}"

if [[ -z "$MODE" ]]; then
  echo "error: MODE must be pr-governance or linear-done" >&2
  exit 1
fi

failures=()
warnings=()

add_failure() { failures+=("$1"); }
add_warning() { warnings+=("$1"); }

linear_graphql() {
  local query="$1"
  local id="$2"
  local api='https://api.linear.app/graphql'
  curl -sf "$api" \
    -H 'Content-Type: application/json' \
    -H "Authorization: ${LINEAR_API_KEY}" \
    -d "$(jq -nc --arg query "$query" --arg id "$id" '{query: $query, variables: {id: $id}}')"
}

dee_numeric() {
  local id="$1"
  if [[ "$id" =~ [Dd][Ee][Ee]-0*([0-9]+) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  printf ''
}

dee_ids_equal() {
  local a="$1"
  local b="$2"
  [[ -n "$(dee_numeric "$a")" && "$(dee_numeric "$a")" == "$(dee_numeric "$b")" ]]
}

extract_first_dee() {
  printf '%s' "$1" | grep -oiE 'DEE-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]' || true
}

# Canonical source: **Linear:** `DEE-NN`, **Linear:** DEE-NN, or **Linear:** [DEE-NN]
# immediately after the field label. Identifiers in explanatory prose (including on
# `n/a` lines) must never resolve as the explicit Linear id.
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
  printf '%s' "$id"
}

extract_linear_completion_values() {
  local body="$1"
  printf '%s' "$body" \
    | grep -oiE '\*\*Linear completion:\*\*[[:space:]]*[a-z-]+' \
    | sed -E 's/^\*\*Linear completion:\*\*[[:space:]]*//i' \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[[:space:]]//g' \
    || true
}

extract_linear_completion_reason() {
  local body="$1"
  local reason=""
  reason="$(
    printf '%s' "$body" \
      | grep -oiE '\*\*Linear completion reason:\*\*[[:space:]]*.+' \
      | head -1 \
      | sed -E 's/^\*\*Linear completion reason:\*\*[[:space:]]*//i' \
      | sed -E 's/[[:space:]]+$//' \
      || true
  )"
  printf '%s' "$reason"
}

validate_linear_completion_contract() {
  local body="$1"
  local explicit_id="$2"
  local values value_count keep_open_count auto_close_count
  local reason=""

  values="$(extract_linear_completion_values "$body")"
  if [[ -z "$values" ]]; then
    linear_completion_mode="auto-close"
    linear_completion_reason=""
    return 0
  fi

  value_count="$(printf '%s\n' "$values" | grep -c . || true)"
  keep_open_count="$(printf '%s\n' "$values" | grep -cx 'keep-open' || true)"
  auto_close_count="$(printf '%s\n' "$values" | grep -cx 'auto-close' || true)"

  if [[ "$value_count" -gt 1 ]]; then
    add_failure 'PR body contains duplicate or conflicting **Linear completion:** fields.'
    return 1
  fi

  if [[ "$keep_open_count" -eq 1 ]]; then
    linear_completion_mode="keep-open"
  elif [[ "$auto_close_count" -eq 1 ]]; then
    linear_completion_mode="auto-close"
  else
    add_failure 'PR body **Linear completion:** must be exactly `keep-open` or `auto-close`.'
    return 1
  fi

  reason="$(extract_linear_completion_reason "$body")"
  linear_completion_reason="$reason"

  if [[ "$linear_completion_mode" == "keep-open" ]]; then
    if [[ -z "$explicit_id" ]]; then
      add_failure '**Linear completion:** keep-open requires an explicit **Linear:** `DEE-NN` field.'
      return 1
    fi
    if [[ -z "$reason" ]]; then
      add_failure '**Linear completion:** keep-open requires a non-empty **Linear completion reason:** field.'
      return 1
    fi
  fi

  return 0
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
    | grep -viE '^(the|and|for|with|from|into|dee|fix|feat|docs|chore|infra|implement|add|update|merge|pull|request)$' \
    | sort -u \
    || true
}

scope_overlap_ok() {
  local issue_context="$1"
  local pr_title="$2"
  local issue_tokens pr_tokens shared
  issue_tokens="$(normalize_tokens "$issue_context")"
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
  [[ "$shared" -ge 1 ]]
}

extract_markdown_section() {
  local text="$1"
  local heading="$2"
  printf '%s' "$text" \
    | sed -n "/^## ${heading}\$/,/^## /p" \
    | tail -n +2 \
    | sed '/^## /d' \
    | head -40
}

fetch_linear_scope_context() {
  local identifier="$1"
  local gql='query($id: String!) { issue(id: $id) { title description parent { title } } }'
  local json title parent_title description goal scope context

  json="$(linear_graphql "$gql" "$identifier" 2>/dev/null || true)"
  title="$(printf '%s' "$json" | jq -r '.data.issue.title // empty' 2>/dev/null || true)"
  if [[ -z "$title" ]]; then
    return 1
  fi

  parent_title="$(printf '%s' "$json" | jq -r '.data.issue.parent.title // empty' 2>/dev/null || true)"
  description="$(printf '%s' "$json" | jq -r '.data.issue.description // empty' 2>/dev/null || true)"
  goal="$(extract_markdown_section "$description" "Goal")"
  scope="$(extract_markdown_section "$description" "Scope")"

  context="${title} ${parent_title} ${goal} ${scope}"
  printf '%s' "$context"
  return 0
}

# Legacy dual-branch release promotion (head=dev, base=main) is retired under
# single-trunk main. Official release identity is an explicit Human tag/release.
is_legacy_release_promotion_pr() {
  [[ "$PR_BRANCH" == "dev" && "$PR_BASE" == "main" ]]
}

# Normal integration PRs are squash → main (BRANCHING-STRATEGY.md).
# Informational only (stdout, never blocking).
detect_merge_strategy() {
  printf 'squash'
}

emit_merge_strategy_note() {
  local strategy
  strategy="$(detect_merge_strategy)"
  printf 'MERGE_STRATEGY=%s\n' "$strategy"
  printf 'MERGE_STRATEGY_NOTE=feature/fix/governance PR — Squash and merge into main (BRANCHING-STRATEGY.md)\n'
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
  if dee_ids_equal "$disclaimer_id" "$title_id" || dee_ids_equal "$disclaimer_id" "$branch_id"; then
    add_failure "PR body disclaims \`${disclaimer_id}\` (\"do NOT use\") but PR title/branch still references the same id."
    return 1
  fi
  return 0
}

# --- validation ---

if is_legacy_release_promotion_pr; then
  add_failure 'Legacy release-promotion PRs (head=dev → base=main) are retired. Use dee-<NN>-<slug> → main (squash). Official release is an explicit Human tag/release of a main SHA.'
fi

explicit_id="$(extract_explicit_linear "$PR_BODY")"
title_id="$(extract_first_dee "$PR_TITLE")"
branch_id="$(extract_branch_nn "$PR_BRANCH")"

if [[ -z "$explicit_id" ]]; then
  add_failure 'PR body missing explicit **Linear:** `DEE-NN` field (required — do not rely on title/branch alone).'
fi

if [[ -n "$title_id" && -n "$explicit_id" ]] && ! dee_ids_equal "$title_id" "$explicit_id"; then
  add_failure "PR title references \`${title_id}\` but **Linear:** field declares \`${explicit_id}\`."
fi

if [[ -n "$branch_id" && -n "$explicit_id" ]] && ! dee_ids_equal "$branch_id" "$explicit_id"; then
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

if [[ -n "$PR_BASE" && "$PR_BASE" != "main" ]]; then
  add_failure "PR base must be \`main\` (single-trunk). Got \`${PR_BASE}\`."
fi

check_disclaimer_collision "$PR_BODY" "$PR_TITLE" "$PR_BRANCH" || true

linear_completion_mode="auto-close"
linear_completion_reason=""
validate_linear_completion_contract "$PR_BODY" "$explicit_id" || true

resolved_id="$explicit_id"

if [[ -n "$resolved_id" && -n "${LINEAR_API_KEY:-}" ]]; then
  issue_context="$(fetch_linear_scope_context "$resolved_id" || true)"
  if [[ -z "$issue_context" ]]; then
    add_failure "Linear issue \`${resolved_id}\` could not be resolved via API (check LINEAR_API_KEY and issue id)."
  elif ! scope_overlap_ok "$issue_context" "$PR_TITLE"; then
    issue_title="$(printf '%s' "$issue_context" | awk '{print $1, $2, $3, $4, $5}')"
    add_failure "Linear issue scope materially differs from PR title (no token overlap). Issue context starts: \"${issue_title}…\" vs PR title=\"${PR_TITLE}\"."
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
emit_merge_strategy_note

if [[ "$linear_completion_mode" == "keep-open" ]]; then
  printf 'LINEAR_COMPLETION=keep-open\n'
  printf 'KEEP_OPEN_REASON=%s\n' "$linear_completion_reason"
  if [[ "$MODE" == "linear-done" ]]; then
    printf 'SKIP_LINEAR_DONE=1\n'
    printf 'SKIP_REASON=explicit_keep_open\n'
    exit 2
  fi
fi

if [[ "$MODE" == "linear-done" ]]; then
  exit 0
fi

exit 0
