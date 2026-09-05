#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ops/_execution-server-common.sh
source "${SCRIPT_DIR}/_execution-server-common.sh"
readonly SCRIPT_NAME="${0##*/}"
usage() { cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --target-sha <sha> [--image-tag TAG] [--repo-path PATH] [--approved-ref refs/remotes/origin/main] [--confirm] [--dry-run]
Builds image and merges deployed-revision.json imageTag on --confirm. No-op without --confirm.
EOF
}
TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"; REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"
APPROVED_REF="${EXECUTION_SERVER_APPROVED_REF:-refs/remotes/origin/main}"; IMAGE_TAG=""; CONFIRM=0; DRY_RUN=0
while [[ $# -gt 0 ]]; do case "$1" in
  --target-sha) TARGET_SHA="$2"; shift 2;; --image-tag) IMAGE_TAG="$2"; shift 2;;
  --repo-path) REPO_PATH="$2"; shift 2;; --confirm) CONFIRM=1; shift;; --dry-run) DRY_RUN=1; shift;;
  --approved-ref) APPROVED_REF="$2"; shift 2;;
  -h|--help) usage; exit 0;; *) die "unknown argument: $1";; esac; done
[[ -n "$TARGET_SHA" ]] || die "target SHA required"; is_full_sha "$TARGET_SHA" || die "invalid target SHA"
REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"; REVISION_PATH="$(resolve_revision_path "$REPO_ROOT")"
[[ -n "$IMAGE_TAG" ]] || IMAGE_TAG="$(default_image_tag "$TARGET_SHA")"
log "execution-server build"; log "  image tag: ${IMAGE_TAG}"; log "planned actions: preflight, docker build, inspect immutable image id, pnpm install, merge image identity"
if ! require_confirm_or_noop "build"; then print_noop_footer; exit 0; fi
run_preflight "$REPO_ROOT" "$TARGET_SHA" "$APPROVED_REF" || exit 1
BUILD_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/waia-execution-build.XXXXXX")"
cleanup_build_context() { rm -rf "$BUILD_CONTEXT"; }
trap cleanup_build_context EXIT
git -C "$REPO_ROOT" archive "$TARGET_SHA" | tar -x -C "$BUILD_CONTEXT"
docker build \
  -f "$BUILD_CONTEXT/$EXECUTION_SERVER_DOCKERFILE_DIR/Dockerfile" \
  --build-arg "WAIA_IMAGE_RELEASE_SHA=$TARGET_SHA" \
  -t "$IMAGE_TAG" \
  "$BUILD_CONTEXT"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")"
[[ "$IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || die "docker returned an invalid immutable image id"
docker run --rm \
  -e "WAIA_RELEASE_SHA=$TARGET_SHA" \
  "$IMAGE_TAG" node --import tsx --conditions=react-server \
  services/ai-trader-execution-host/entrypoint.mjs --preflight-image
docker history "$IMAGE_TAG" | head -n 20
( cd "$REPO_ROOT" && pnpm install --frozen-lockfile )
revision_merge_json "$REVISION_PATH" "$(node -e "process.stdout.write(JSON.stringify({imageTag:process.argv[1],gitSha:process.argv[2],imageId:process.argv[3]}))" "$IMAGE_TAG" "$TARGET_SHA" "$IMAGE_ID")"
log "result: OK"
