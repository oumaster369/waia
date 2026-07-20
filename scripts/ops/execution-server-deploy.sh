#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ops/_execution-server-common.sh
source "${SCRIPT_DIR}/_execution-server-common.sh"
readonly SCRIPT_NAME="${0##*/}"
usage() { cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --target-sha <sha> --image-tag <tag> --operator <id> [--secrets-env-file PATH] [--confirm] [--dry-run]
Deploys container and writes deployed-revision.json on --confirm. No-op without --confirm.
EOF
}
TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"; REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"
IMAGE_TAG=""; OPERATOR=""; SECRETS_ENV_FILE=""; CONFIRM=0; DRY_RUN=0
while [[ $# -gt 0 ]]; do case "$1" in
  --target-sha) TARGET_SHA="$2"; shift 2;; --image-tag) IMAGE_TAG="$2"; shift 2;;
  --operator) OPERATOR="$2"; shift 2;; --secrets-env-file) SECRETS_ENV_FILE="$2"; shift 2;;
  --repo-path) REPO_PATH="$2"; shift 2;; --confirm) CONFIRM=1; shift;; --dry-run) DRY_RUN=1; shift;;
  -h|--help) usage; exit 0;; *) die "unknown argument: $1";; esac; done
[[ -n "$TARGET_SHA" && -n "$IMAGE_TAG" && -n "$OPERATOR" ]] || die "target-sha, image-tag, operator required"
is_full_sha "$TARGET_SHA" || die "invalid target SHA"
REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"; REVISION_PATH="$(resolve_revision_path "$REPO_ROOT")"
PREVIOUS_SHA=""; read_revision_field "$REVISION_PATH" "gitSha" >/dev/null 2>&1 && PREVIOUS_SHA="$(read_revision_field "$REVISION_PATH" "gitSha")"
ENV_FILE_ARG=""; [[ -n "$SECRETS_ENV_FILE" ]] && { [[ -f "$SECRETS_ENV_FILE" ]] || die "secrets env file not found"; ENV_FILE_ARG="--env-file ${SECRETS_ENV_FILE}"; }
log "execution-server deploy"; log "  image tag: ${IMAGE_TAG}"; log "planned actions: preflight, docker run, /health, write revision"
if ! require_confirm_or_noop "deploy"; then print_noop_footer; exit 0; fi
run_preflight "$REPO_ROOT" "$TARGET_SHA" || exit 1
docker ps -a --format '{{.Names}}' | grep -qx "$EXECUTION_SERVER_CONTAINER_NAME" && docker rm -f "$EXECUTION_SERVER_CONTAINER_NAME" || true
# shellcheck disable=SC2086
docker run -d --name "$EXECUTION_SERVER_CONTAINER_NAME" --restart unless-stopped -p "${EXECUTION_SERVER_HOST_PORT}:8080" -e EXECUTION_HOST_PORT=8080 $ENV_FILE_ARG "$IMAGE_TAG"
curl -sf "http://127.0.0.1:${EXECUTION_SERVER_HOST_PORT}/health" >/dev/null || { log "/health failed"; exit 1; }
PATCH_JSON="$(node - "$TARGET_SHA" "$IMAGE_TAG" "$(utc_now_iso)" "$OPERATOR" "$PREVIOUS_SHA" <<'NODE'
const [gitSha, imageTag, deployedAt, operator, previousGitSha] = process.argv.slice(2);
const patch = { gitSha, imageTag, deployedAt, operator };
if (previousGitSha) patch.previousGitSha = previousGitSha;
process.stdout.write(JSON.stringify(patch));
NODE
)"
revision_merge_json "$REVISION_PATH" "$PATCH_JSON"; log "result: OK"
