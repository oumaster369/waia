#!/usr/bin/env bash
# Mark a Linear issue Done via GraphQL API.
# Usage: LINEAR_API_KEY=... ./scripts/linear/mark-done.sh DEE-150 [pr-url]
# Requires: curl, jq

set -euo pipefail

IDENTIFIER="${1:-}"
PR_URL="${2:-}"

if [[ -z "$IDENTIFIER" ]]; then
  echo "usage: LINEAR_API_KEY=... $0 DEE-NN [merged-pr-url]" >&2
  exit 1
fi

if [[ -z "${LINEAR_API_KEY:-}" ]]; then
  echo "error: LINEAR_API_KEY is not set" >&2
  exit 1
fi

API="https://api.linear.app/graphql"

lookup_query='query($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    state { name type }
    team { id key }
  }
}'

issue_json="$(
  curl -sf "$API" \
    -H "Content-Type: application/json" \
    -H "Authorization: ${LINEAR_API_KEY}" \
    -d "$(jq -nc --arg id "$IDENTIFIER" --arg query "$lookup_query" '{query: $query, variables: {id: $id}}')"
)"

issue_id="$(printf '%s' "$issue_json" | jq -r '.data.issue.id // empty')"
if [[ -z "$issue_id" ]]; then
  echo "error: could not resolve Linear issue ${IDENTIFIER}" >&2
  printf '%s\n' "$issue_json" | jq '.' >&2 || true
  exit 1
fi

current_state_type="$(printf '%s' "$issue_json" | jq -r '.data.issue.state.type // empty')"
current_state_name="$(printf '%s' "$issue_json" | jq -r '.data.issue.state.name // empty')"

if [[ "$current_state_type" == "completed" ]]; then
  echo "notice: Linear ${IDENTIFIER} already ${current_state_name} — skipping state transition"
else
  team_id="$(printf '%s' "$issue_json" | jq -r '.data.issue.team.id')"

  status_query='query($teamId: String!) { workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { id name type } } }'

  states_json="$(
    curl -sf "$API" \
      -H "Content-Type: application/json" \
      -H "Authorization: ${LINEAR_API_KEY}" \
      -d "$(jq -nc --arg teamId "$team_id" --arg query "$status_query" '{query: $query, variables: {teamId: $teamId}}')"
  )"

  done_state_id="$(
    printf '%s' "$states_json" \
      | jq -r '.data.workflowStates.nodes[] | select(.type == "completed" and (.name == "Done" or .name == "done")) | .id' \
      | head -1
  )"

  if [[ -z "$done_state_id" ]]; then
    echo "error: could not find Done workflow state for team" >&2
    exit 1
  fi

  update_mutation='mutation($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
      issue { identifier state { name } }
    }
  }'

  update_result="$(
    curl -sf "$API" \
      -H "Content-Type: application/json" \
      -H "Authorization: ${LINEAR_API_KEY}" \
      -d "$(jq -nc \
        --arg id "$issue_id" \
        --arg stateId "$done_state_id" \
        --arg query "$update_mutation" \
        '{query: $query, variables: {id: $id, stateId: $stateId}}')"
  )"

  success="$(printf '%s' "$update_result" | jq -r '.data.issueUpdate.success // false')"
  if [[ "$success" != "true" ]]; then
    echo "error: Linear issueUpdate failed for ${IDENTIFIER}" >&2
    printf '%s\n' "$update_result" | jq '.' >&2 || true
    exit 1
  fi

  state_name="$(printf '%s' "$update_result" | jq -r '.data.issueUpdate.issue.state.name')"
  echo "Linear ${IDENTIFIER} → ${state_name}"
fi

if [[ -n "$PR_URL" ]]; then
  comment="Merged PR: ${PR_URL}"
  comment_mutation='mutation($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }'

  comment_result="$(
    curl -sf "$API" \
      -H "Content-Type: application/json" \
      -H "Authorization: ${LINEAR_API_KEY}" \
      -d "$(jq -nc \
        --arg issueId "$issue_id" \
        --arg body "$comment" \
        --arg query "$comment_mutation" \
        '{query: $query, variables: {issueId: $issueId, body: $body}}')"
  )"

  comment_success="$(printf '%s' "$comment_result" | jq -r '.data.commentCreate.success // false')"
  if [[ "$comment_success" != "true" ]]; then
    echo "warning: merge comment failed for ${IDENTIFIER}" >&2
    printf '%s\n' "$comment_result" | jq '.' >&2 || true
  fi
fi
