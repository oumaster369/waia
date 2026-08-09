#!/usr/bin/env bash
# Block obviously destructive shell commands from agents.
# Reads JSON from stdin, returns JSON permission decision.

set -u

input=$(cat)

# jq may not be present on every machine; degrade to grep on the raw JSON.
command=""
if command -v jq >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | jq -r '.command // empty' 2>/dev/null || true)
fi
if [ -z "$command" ]; then
  command=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)
fi

deny() {
  reason=$1
  printf '{"permission":"deny","user_message":"Blocked by .cursor/hooks/guard-shell.sh: %s","agent_message":"Refused: %s"}' "$reason" "$reason"
  exit 0
}

case "$command" in
  *"git push"*"--force"*|*"git push"*"-f "*|*"git push -f"|*"git push --force"*)
    deny "git push --force is not allowed"
    ;;
  *"rm -rf /"|*"rm -rf /*"|*"rm -rf ~"|*"rm -rf $HOME"*)
    deny "rm -rf at filesystem/home root is not allowed"
    ;;
esac

# Block direct push to protected trunk (and frozen legacy `dev` during retirement window).
if printf '%s' "$command" | grep -Eq 'git[[:space:]]+push[[:space:]]+([^|;&]*[[:space:]])?(origin[[:space:]]+)?(dev|main)([[:space:]]|$)'; then
  deny "direct push to main (or frozen legacy dev) is not allowed — use a dee-* branch + PR to main"
fi

printf '{"permission":"allow"}'
exit 0
