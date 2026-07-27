#!/usr/bin/env bash
# DEE-436 — root-only RESUME systemd enforcement for T4A.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_fhv-git-trust.sh
source "${SCRIPT_DIR}/_fhv-git-trust.sh"

RUN_ROOT=""
RUN_ID=""
ORGANIZATION_ID=""
TARGET_SHA=""
REPO_ROOT=""
SYSTEMCTL=""
NODE_BIN=""
UNIT="waia-fhv-campaign.service"

usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-resume-campaign-root.sh \
  --run-root ABS_PATH \
  --run-id ID \
  --organization-id UUID \
  --target-sha SHA \
  --repo-root ABS_PATH \
  --systemctl-bin ABS_PATH \
  --node-bin ABS_PATH

Root-only: verifies signed RESUME acceptance and starts campaign unit once.
EOF
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-root) RUN_ROOT="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --organization-id) ORGANIZATION_ID="${2:-}"; shift 2 ;;
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --repo-root) REPO_ROOT="${2:-}"; shift 2 ;;
    --systemctl-bin) SYSTEMCTL="${2:-}"; shift 2 ;;
    --node-bin) NODE_BIN="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$RUN_ROOT" && -n "$RUN_ID" && -n "$ORGANIZATION_ID" && -n "$TARGET_SHA" && -n "$REPO_ROOT" ]] || usage
[[ "$RUN_ROOT" = /* ]] || fail "run-root must be absolute"
fhv_git_trust_require_abs_safe_path "repo-root" "$REPO_ROOT"
[[ -n "$SYSTEMCTL" && "$SYSTEMCTL" = /* && -x "$SYSTEMCTL" ]] || fail "systemctl-bin required"
[[ -n "$NODE_BIN" && "$NODE_BIN" = /* && -x "$NODE_BIN" ]] || fail "node-bin required"

if [[ "$(id -u)" -ne 0 ]]; then
  fail "effective UID 0 required"
fi

TARGET_SHA="$(printf '%s' "$TARGET_SHA" | tr '[:upper:]' '[:lower:]')"
PROOF_OUT="${RUN_ROOT}/control/fhv-t4-resume-enforcement-proof.v1.json"
if [[ -f "$PROOF_OUT" ]]; then
  fail "resume enforcement proof already exists"
fi

export RUN_ROOT RUN_ID ORGANIZATION_ID TARGET_SHA REPO_ROOT
fhv_ops_cd_repo_root "$REPO_ROOT"
"$NODE_BIN" --import tsx scripts/ops/fhv-t4-resume-campaign-root-cli.ts \
  --run-root "$RUN_ROOT" \
  --run-id "$RUN_ID" \
  --organization-id "$ORGANIZATION_ID" \
  --target-sha "$TARGET_SHA" \
  --systemctl-bin "$SYSTEMCTL" \
  --output "$PROOF_OUT"

printf 'classification=FHV_T4_RESUME_ENFORCEMENT_OK\n'
