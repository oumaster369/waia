#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ops/_execution-server-common.sh
source "${SCRIPT_DIR}/_execution-server-common.sh"
readonly SCRIPT_NAME="${0##*/}"
usage() { cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --target-sha <sha> --image-tag <tag> --operator <id> --secrets-env-file PATH --dataset-root PATH [--approved-ref refs/remotes/origin/main] [--confirm] [--dry-run]
Deploys container and writes deployed-revision.json on --confirm. No-op without --confirm.
EOF
}
TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"; REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"
APPROVED_REF="${EXECUTION_SERVER_APPROVED_REF:-refs/remotes/origin/main}"
IMAGE_TAG=""; OPERATOR=""; SECRETS_ENV_FILE=""; DATASET_ROOT=""; CONFIRM=0; DRY_RUN=0
while [[ $# -gt 0 ]]; do case "$1" in
  --target-sha) TARGET_SHA="$2"; shift 2;; --image-tag) IMAGE_TAG="$2"; shift 2;;
  --operator) OPERATOR="$2"; shift 2;; --secrets-env-file) SECRETS_ENV_FILE="$2"; shift 2;;
  --dataset-root) DATASET_ROOT="$2"; shift 2;;
  --repo-path) REPO_PATH="$2"; shift 2;; --confirm) CONFIRM=1; shift;; --dry-run) DRY_RUN=1; shift;;
  --approved-ref) APPROVED_REF="$2"; shift 2;;
  -h|--help) usage; exit 0;; *) die "unknown argument: $1";; esac; done
[[ -n "$TARGET_SHA" && -n "$IMAGE_TAG" && -n "$OPERATOR" && -n "$SECRETS_ENV_FILE" &&
   -n "$DATASET_ROOT" ]] || \
  die "target-sha, image-tag, operator, secrets-env-file and dataset-root required"
is_full_sha "$TARGET_SHA" || die "invalid target SHA"
REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"; REVISION_PATH="$(resolve_revision_path "$REPO_ROOT")"
PREVIOUS_SHA=""; read_revision_field "$REVISION_PATH" "gitSha" >/dev/null 2>&1 && PREVIOUS_SHA="$(read_revision_field "$REVISION_PATH" "gitSha")"
[[ -f "$SECRETS_ENV_FILE" ]] || die "secrets env file not found"
[[ "$DATASET_ROOT" == /* && -d "$DATASET_ROOT" ]] ||
  die "dataset-root must be an existing absolute directory"
DATASET_ROOT="$(cd "$DATASET_ROOT" && pwd -P)"
if [[ "$(uname -s)" == "Linux" ]]; then
  ENV_MODE="$(stat -c '%a' "$SECRETS_ENV_FILE")"
  (( (8#$ENV_MODE & 077) == 0 )) || die "secrets env file must not be group/world accessible"
fi
log "execution-server deploy"; log "  image tag: ${IMAGE_TAG}"; log "planned actions: preflight, docker run, /health, write revision"
if ! require_confirm_or_noop "deploy"; then print_noop_footer; exit 0; fi
run_preflight "$REPO_ROOT" "$TARGET_SHA" "$APPROVED_REF" || exit 1
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")"
[[ "$IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || die "docker returned an invalid immutable image id"
RECORDED_IMAGE_ID="$(read_revision_field "$REVISION_PATH" "imageId")" || \
  die "deployed-revision.json has no immutable image id; rebuild with execution-server-build.sh"
[[ "$IMAGE_ID" == "$RECORDED_IMAGE_ID" ]] || die "image id does not match the recorded build artifact"
IMAGE_SHA="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE_TAG")"
[[ "$IMAGE_SHA" == "$TARGET_SHA" ]] || die "image release SHA does not match target SHA"
docker run --rm \
  -e "WAIA_RELEASE_SHA=$TARGET_SHA" \
  "$IMAGE_TAG" node --import tsx --conditions=react-server \
  services/ai-trader-execution-host/entrypoint.mjs --preflight-image >/dev/null
docker run --rm \
  --env-file "$SECRETS_ENV_FILE" \
  -e "WAIA_RELEASE_SHA=$TARGET_SHA" \
  "$IMAGE_TAG" node services/ai-trader-execution-host/entrypoint.mjs --preflight-runtime >/dev/null
docker ps -a --format '{{.Names}}' | grep -qx "$EXECUTION_SERVER_CONTAINER_NAME" && docker rm -f "$EXECUTION_SERVER_CONTAINER_NAME" || true
docker run -d --name "$EXECUTION_SERVER_CONTAINER_NAME" --restart unless-stopped \
  -p "${EXECUTION_SERVER_HOST_PORT}:8080" \
  --mount "type=bind,src=${DATASET_ROOT},dst=${DATASET_ROOT},readonly" \
  --env-file "$SECRETS_ENV_FILE" \
  -e EXECUTION_HOST_PORT=8080 \
  -e "WAIA_RELEASE_SHA=$TARGET_SHA" \
  "$IMAGE_TAG"
CONTAINER_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$EXECUTION_SERVER_CONTAINER_NAME")"
[[ "$CONTAINER_IMAGE_ID" == "$IMAGE_ID" ]] || die "running container image id does not match verified image id"
HEALTH_JSON=""
READY_TIMEOUT_SECONDS="${EXECUTION_SERVER_READY_TIMEOUT_SECONDS:-900}"
[[ "$READY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "invalid readiness timeout"
for _ in $(seq 1 "$READY_TIMEOUT_SECONDS"); do
  HEALTH_JSON="$(curl -sf "http://127.0.0.1:${EXECUTION_SERVER_HOST_PORT}/health" || true)"
  [[ -n "$HEALTH_JSON" ]] && break
  [[ "$(docker inspect --format '{{.RestartCount}}' "$EXECUTION_SERVER_CONTAINER_NAME")" == "0" ]] || \
    die "ratified launch failed before durable claim; inspect container logs"
  sleep 1
done
node - "$HEALTH_JSON" "$TARGET_SHA" <<'NODE'
const [raw, targetSha] = process.argv.slice(2);
let body;
try { body = JSON.parse(raw); } catch { process.exit(1); }
if (body.status !== "ok" || body.releaseSha !== targetSha ||
    body.imageReleaseSha !== targetSha ||
    body.consumer?.mode !== "historical-v2-ratified-one-shot" ||
    !["running", "completed"].includes(body.consumer?.state)) process.exit(1);
NODE
[[ "$(docker inspect --format '{{.RestartCount}}' "$EXECUTION_SERVER_CONTAINER_NAME")" == "0" ]] || \
  die "consumer container restarted during deployment preflight"
PATCH_JSON="$(node - "$TARGET_SHA" "$IMAGE_TAG" "$IMAGE_ID" "$(utc_now_iso)" "$OPERATOR" "$PREVIOUS_SHA" <<'NODE'
const [gitSha, imageTag, imageId, deployedAt, operator, previousGitSha] = process.argv.slice(2);
const patch = { gitSha, imageTag, imageId, deployedAt, operator };
if (previousGitSha) patch.previousGitSha = previousGitSha;
process.stdout.write(JSON.stringify(patch));
NODE
)"
revision_merge_json "$REVISION_PATH" "$PATCH_JSON"; log "result: OK"
