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
TEAM_KEY="${IDENTIFIER%%-*}"

lookup_query='query($id: String!) { issue(id: $id) { id identifier title team { id key } } }'

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

status_query='query($teamId: String!) { workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { id name type } } }'
team_id="$(printf '%s' "$issue_json" | jq -r '.data.issue.team.id')"

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
  echo "error: could not find Done workflow state for team ${TEAM_KEY}" >&2
  exit 1
fi

comment=""
if [[ -n "$PR_URL" ]]; then
  comment="Merged PR: ${PR_URL}"
fi

update_mutation='mutation($id: String!, $stateId: String!, $comment: String) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { identifier state { name } } }
  c1: commentCreate(input: { issueId: $id, body: $comment }) { success }
}'

# commentCreate fails on empty body — skip comment mutation when no URL
if [[ -n "$comment" ]]; then
  result="$(
    curl -sf "$API" \
      -H "Content-Type: application/json" \
      -H "Authorization: ${LINEAR_API_KEY}" \
      -d "$(jq -nc \
        --arg id "$issue_id" \
        --arg stateId "$done_state_id" \
        --arg comment "$comment" \
        --arg query "$update_mutation" \
        '{query: $query, variables: {id: $id, stateId: $stateId, comment: $comment}}')"
  )"
else
  update_mutation='mutation($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { identifier state { name } } }
  }'
  result="$(
    curl -sf "$API" \
      -H "Content-Type: application/json" \
      -H "Authorization: ${LINEAR_API_KEY}" \
      -d "$(jq -nc \
        --arg id "$issue_id" \
        --arg stateId "$done_state_id" \
        --arg query "$update_mutation" \
        '{query: $query, variables: {id: $id, stateId: $stateId}}')"
  )"
fi

success="$(printf '%s' "$result" | jq -r '.data.issueUpdate.success // false')"
if [[ "$success" != "true" ]]; then
  echo "error: Linear issueUpdate failed for ${IDENTIFIER}" >&2
  printf '%s\n' "$result" | jq '.' >&2 || true
  exit 1
fi

state_name="$(printf '%s' "$result" | jq -r '.data.issueUpdate.issue.state.name')"
echo "Linear ${IDENTIFIER} → ${state_name}"
