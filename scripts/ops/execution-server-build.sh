#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/ops/_execution-server-common.sh
source "${SCRIPT_DIR}/_execution-server-common.sh"
readonly SCRIPT_NAME="${0##*/}"
usage() { cat >&2 <<EOF
Usage: ${SCRIPT_NAME} --target-sha <sha> [--image-tag TAG] [--repo-path PATH] [--confirm] [--dry-run]
Builds image and merges deployed-revision.json imageTag on --confirm. No-op without --confirm.
EOF
}
TARGET_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"; REPO_PATH="${EXECUTION_SERVER_REPO_PATH:-}"; IMAGE_TAG=""; CONFIRM=0; DRY_RUN=0
while [[ $# -gt 0 ]]; do case "$1" in
  --target-sha) TARGET_SHA="$2"; shift 2;; --image-tag) IMAGE_TAG="$2"; shift 2;;
  --repo-path) REPO_PATH="$2"; shift 2;; --confirm) CONFIRM=1; shift;; --dry-run) DRY_RUN=1; shift;;
  -h|--help) usage; exit 0;; *) die "unknown argument: $1";; esac; done
[[ -n "$TARGET_SHA" ]] || die "target SHA required"; is_full_sha "$TARGET_SHA" || die "invalid target SHA"
REPO_ROOT="$(resolve_repo_root "$REPO_PATH")"; REVISION_PATH="$(resolve_revision_path "$REPO_ROOT")"
[[ -n "$IMAGE_TAG" ]] || IMAGE_TAG="$(default_image_tag "$TARGET_SHA")"
DOCKERFILE_PATH="${REPO_ROOT}/${EXECUTION_SERVER_DOCKERFILE_DIR}"
log "execution-server build"; log "  image tag: ${IMAGE_TAG}"; log "planned actions: preflight, docker build, pnpm install, merge imageTag"
if ! require_confirm_or_noop "build"; then print_noop_footer; exit 0; fi
run_preflight "$REPO_ROOT" "$TARGET_SHA" || exit 1
docker build -t "$IMAGE_TAG" "$DOCKERFILE_PATH"; docker history "$IMAGE_TAG" | head -n 20
( cd "$REPO_ROOT" && pnpm install --frozen-lockfile )
revision_merge_json "$REVISION_PATH" "$(node -e "process.stdout.write(JSON.stringify({imageTag:process.argv[1],gitSha:process.argv[2]}))" "$IMAGE_TAG" "$TARGET_SHA")"
log "result: OK"
