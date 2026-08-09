#!/usr/bin/env bash
# Human-safe recorder for DEE-511 Cloudflare Workers Builds preflight.
#
# Writes operator-local JSON from explicitly supplied Human-observed values.
# Does NOT scrape, invent, or mutate Cloudflare settings.
#
# Usage:
#   ./scripts/github/record-cloudflare-preflight.sh \
#     --recorded-by "human-operator" \
#     --production-branch "<from dashboard>" \
#     --non-production-branch-builds true|false \
#     --production-deploy-command "<from dashboard>" \
#     --non-production-deploy-command "<from dashboard>" \
#     --architect-contract A|B
#
# Output path:
#   ${WAIA_CUTOVER_STATE_DIR:-$HOME/.waia/single-trunk-cutover}/cloudflare-preflight.json

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/single-trunk-cutover-lib.sh
source "${ROOT}/scripts/github/lib/single-trunk-cutover-lib.sh"

RECORDED_BY=""
PRODUCTION_BRANCH=""
NON_PROD_BUILDS=""
PROD_DEPLOY_CMD=""
NON_PROD_DEPLOY_CMD=""
ARCHITECT_CONTRACT=""

usage() {
  sed -n '2,20p' "$0" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --recorded-by)
      RECORDED_BY="${2:-}"; shift 2 ;;
    --production-branch)
      PRODUCTION_BRANCH="${2:-}"; shift 2 ;;
    --non-production-branch-builds)
      NON_PROD_BUILDS="${2:-}"; shift 2 ;;
    --production-deploy-command)
      PROD_DEPLOY_CMD="${2:-}"; shift 2 ;;
    --non-production-deploy-command)
      NON_PROD_DEPLOY_CMD="${2:-}"; shift 2 ;;
    --architect-contract)
      ARCHITECT_CONTRACT="${2:-}"; shift 2 ;;
    -h|--help)
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

if [[ -z "$RECORDED_BY" || -z "$PRODUCTION_BRANCH" || -z "$NON_PROD_BUILDS" \
  || -z "$PROD_DEPLOY_CMD" || -z "$NON_PROD_DEPLOY_CMD" || -z "$ARCHITECT_CONTRACT" ]]; then
  echo "error: all flags are required" >&2
  usage
  exit 2
fi

if [[ "$ARCHITECT_CONTRACT" != "A" && "$ARCHITECT_CONTRACT" != "B" ]]; then
  echo "error: --architect-contract must be A or B (got: ${ARCHITECT_CONTRACT})" >&2
  exit 2
fi

if [[ "$NON_PROD_BUILDS" != "true" && "$NON_PROD_BUILDS" != "false" ]]; then
  echo "error: --non-production-branch-builds must be true or false" >&2
  exit 2
fi

require_cmd jq

STATE_DIR="$(waia_cutover_state_dir)"
OUT="$(waia_cutover_cloudflare_preflight_path)"
mkdir -p "$STATE_DIR"
umask 077

jq -n \
  --arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg recorded_by "$RECORDED_BY" \
  --arg worker "waia-app" \
  --arg production_branch "$PRODUCTION_BRANCH" \
  --argjson non_production_branch_builds "$NON_PROD_BUILDS" \
  --arg production_deploy_command "$PROD_DEPLOY_CMD" \
  --arg non_production_branch_deploy_command "$NON_PROD_DEPLOY_CMD" \
  --arg architect_contract "$ARCHITECT_CONTRACT" \
  '{
    recorded_at: $recorded_at,
    recorded_by: $recorded_by,
    worker: $worker,
    production_branch: $production_branch,
    non_production_branch_builds_enabled: $non_production_branch_builds,
    production_deploy_command: $production_deploy_command,
    non_production_branch_deploy_command: $non_production_branch_deploy_command,
    architect_contract: $architect_contract,
    note: "Human-observed Cloudflare Dashboard values only. Not scraped. No Cloudflare mutation performed by this script."
  }' > "$OUT"

echo "Wrote Cloudflare preflight record: ${OUT}"
echo "architect_contract=${ARCHITECT_CONTRACT}"
echo "production_branch=${PRODUCTION_BRANCH}"
echo "This record must exist BEFORE Human squash-merge of PR #456 (see docs/ops/SINGLE-TRUNK-CUTOVER.md)."
