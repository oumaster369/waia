#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ops/_execution-server-common.sh
source "${SCRIPT_DIR}/_execution-server-common.sh"
readonly SCRIPT_NAME="${0##*/}"
usage() { cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --target-sha <sha> --image-tag <tag> --proposal-env-file PATH --dataset-root PATH [--approved-ref refs/remotes/origin/main] [--confirm] [--dry-run]
Prepares the exact technical proposal from the immutable image and read-only dataset mount.
No-op without --confirm. It never ratifies or launches the run.
EOF
}
TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"; REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"
APPROVED_REF="${EXECUTION_SERVER_APPROVED_REF:-refs/remotes/origin/main}"
IMAGE_TAG=""; PROPOSAL_ENV_FILE=""; DATASET_ROOT=""; CONFIRM=0; DRY_RUN=0
while [[ $# -gt 0 ]]; do case "$1" in
  --target-sha) TARGET_SHA="$2"; shift 2;; --image-tag) IMAGE_TAG="$2"; shift 2;;
  --proposal-env-file) PROPOSAL_ENV_FILE="$2"; shift 2;;
  --dataset-root) DATASET_ROOT="$2"; shift 2;;
  --repo-path) REPO_PATH="$2"; shift 2;; --confirm) CONFIRM=1; shift;; --dry-run) DRY_RUN=1; shift;;
  --approved-ref) APPROVED_REF="$2"; shift 2;;
  -h|--help) usage; exit 0;; *) die "unknown argument: $1";; esac; done
[[ -n "$TARGET_SHA" && -n "$IMAGE_TAG" && -n "$PROPOSAL_ENV_FILE" &&
   -n "$DATASET_ROOT" ]] ||
  die "target-sha, image-tag, proposal-env-file and dataset-root required"
is_full_sha "$TARGET_SHA" || die "invalid target SHA"
[[ -f "$PROPOSAL_ENV_FILE" ]] || die "proposal env file not found"
[[ "$DATASET_ROOT" == /* && -d "$DATASET_ROOT" ]] ||
  die "dataset-root must be an existing absolute directory"
DATASET_ROOT="$(cd "$DATASET_ROOT" && pwd -P)"
if [[ "$(uname -s)" == "Linux" ]]; then
  ENV_MODE="$(stat -c '%a' "$PROPOSAL_ENV_FILE")"
  (( (8#$ENV_MODE & 077) == 0 )) || die "proposal env file must not be group/world accessible"
fi
REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"; REVISION_PATH="$(resolve_revision_path "$REPO_ROOT")"
log "execution-server historical proposal preparation"
log "  image tag: ${IMAGE_TAG}"
log "  dataset root: ${DATASET_ROOT} (read-only)"
log "planned actions: exact-SHA preflight, image/runtime attestation, technical proposal only"
if ! require_confirm_or_noop "proposal preparation"; then print_noop_footer; exit 0; fi
run_preflight "$REPO_ROOT" "$TARGET_SHA" "$APPROVED_REF" || exit 1
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")"
RECORDED_IMAGE_ID="$(read_revision_field "$REVISION_PATH" "imageId")" ||
  die "deployed-revision.json has no immutable image id; build the exact image first"
[[ "$IMAGE_ID" == "$RECORDED_IMAGE_ID" ]] ||
  die "image id does not match the recorded build artifact"
IMAGE_SHA="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE_TAG")"
[[ "$IMAGE_SHA" == "$TARGET_SHA" ]] || die "image release SHA does not match target SHA"
docker run --rm --env-file "$PROPOSAL_ENV_FILE" -e "WAIA_RELEASE_SHA=$TARGET_SHA" \
  "$IMAGE_TAG" node services/ai-trader-execution-host/entrypoint.mjs --preflight-runtime >/dev/null
docker run --rm \
  --mount "type=bind,src=${DATASET_ROOT},dst=${DATASET_ROOT},readonly" \
  --env-file "$PROPOSAL_ENV_FILE" \
  -e "WAIA_RELEASE_SHA=$TARGET_SHA" \
  "$IMAGE_TAG" node --import tsx --conditions=react-server \
  scripts/trader/historical-simulation-v2-prepare-proposal.ts
log "result: PROPOSAL_PREPARED; Human ratification is still required before deploy"
