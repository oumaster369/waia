#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ops/_execution-server-common.sh
source "${SCRIPT_DIR}/_execution-server-common.sh"
readonly SCRIPT_NAME="${0##*/}"
usage() { cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --operator <id> [--target-sha <sha>] [--image-tag <tag>] [--notes TEXT] [--confirm] [--dry-run]
Rolls back and rewrites deployed-revision.json on --confirm. No-op without --confirm.
EOF
}
TARGET_SHA=""; IMAGE_TAG=""; OPERATOR=""; NOTES=""; SECRETS_ENV_FILE=""
REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"; CONFIRM=0; DRY_RUN=0
while [[ $# -gt 0 ]]; do case "$1" in
  --target-sha) TARGET_SHA="$2"; shift 2;; --image-tag) IMAGE_TAG="$2"; shift 2;;
  --operator) OPERATOR="$2"; shift 2;; --notes) NOTES="$2"; shift 2;;
  --secrets-env-file) SECRETS_ENV_FILE="$2"; shift 2;; --repo-path) REPO_PATH="$2"; shift 2;;
  --confirm) CONFIRM=1; shift;; --dry-run) DRY_RUN=1; shift;; -h|--help) usage; exit 0;;
  *) die "unknown argument: $1";; esac; done
[[ -n "$OPERATOR" ]] || die "operator required"
REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"; REVISION_PATH="$(resolve_revision_path "$REPO_ROOT")"
[[ -f "$REVISION_PATH" ]] || die "deployed-revision.json not found: ${REVISION_PATH}"
CURRENT_SHA="$(read_revision_field "$REVISION_PATH" "gitSha" || true)"
[[ -z "$TARGET_SHA" ]] && TARGET_SHA="$(read_revision_field "$REVISION_PATH" "previousGitSha" || true)"
[[ -z "$IMAGE_TAG" ]] && IMAGE_TAG="$(read_revision_field "$REVISION_PATH" "imageTag" || true)"
[[ -n "$TARGET_SHA" && -n "$IMAGE_TAG" ]] || die "rollback target missing"; is_full_sha "$TARGET_SHA" || die "invalid target SHA"
ENV_FILE_ARG=""; [[ -n "$SECRETS_ENV_FILE" ]] && { [[ -f "$SECRETS_ENV_FILE" ]] || die "secrets env file not found"; ENV_FILE_ARG="--env-file ${SECRETS_ENV_FILE}"; }
log "execution-server rollback"; log "  rollback sha: ${TARGET_SHA}"; log "planned actions: sync, preflight, docker run, /health, write revision"
if ! require_confirm_or_noop "rollback"; then print_noop_footer; exit 0; fi
git -C "$REPO_ROOT" fetch origin; git -C "$REPO_ROOT" checkout "$TARGET_SHA"
run_preflight "$REPO_ROOT" "$TARGET_SHA" || exit 1
docker ps -a --format '{{.Names}}' | grep -qx "$EXECUTION_SERVER_CONTAINER_NAME" && docker rm -f "$EXECUTION_SERVER_CONTAINER_NAME" || true
# shellcheck disable=SC2086
docker run -d --name "$EXECUTION_SERVER_CONTAINER_NAME" --restart unless-stopped -p "${EXECUTION_SERVER_HOST_PORT}:8080" -e EXECUTION_HOST_PORT=8080 $ENV_FILE_ARG "$IMAGE_TAG"
curl -sf "http://127.0.0.1:${EXECUTION_SERVER_HOST_PORT}/health" >/dev/null || { log "/health failed"; exit 1; }
PATCH_JSON="$(node - "$TARGET_SHA" "$IMAGE_TAG" "$(utc_now_iso)" "$OPERATOR" "$CURRENT_SHA" "$NOTES" <<'NODE'
const [gitSha, imageTag, deployedAt, operator, previousGitSha, notes] = process.argv.slice(2);
const patch = { gitSha, imageTag, deployedAt, operator, notes: notes || "rollback via execution-server-rollback.sh" };
if (previousGitSha) patch.previousGitSha = previousGitSha;
process.stdout.write(JSON.stringify(patch));
NODE
)"
revision_merge_json "$REVISION_PATH" "$PATCH_JSON"; log "result: OK"
