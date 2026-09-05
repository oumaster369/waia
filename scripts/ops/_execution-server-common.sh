#!/usr/bin/env bash
# Shared helpers for guarded execution-server mutation scripts (Slice D2).
set -euo pipefail
readonly EXECUTION_SERVER_CONTAINER_NAME="${EXECUTION_SERVER_CONTAINER_NAME:-ai-trader-execution-host}"
readonly EXECUTION_SERVER_IMAGE_PREFIX="${EXECUTION_SERVER_IMAGE_PREFIX:-waia-execution-host}"
readonly EXECUTION_SERVER_HOST_PORT="${EXECUTION_SERVER_HOST_PORT:-8080}"
readonly EXECUTION_SERVER_DOCKERFILE_DIR="${EXECUTION_SERVER_DOCKERFILE_DIR:-services/ai-trader-execution-host}"
log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 2; }
is_full_sha() { local sha="$1"; [[ "${#sha}" -eq 40 && "$sha" =~ ^[0-9a-f]{40}$ ]]; }
resolve_repo_root() {
  local start="${1:-}"
  if [[ -n "$start" ]]; then
    git -C "$start" rev-parse --show-toplevel && return 0
    die "--repo-path is not a git work tree: ${start}"
  fi
  local script_dir; script_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
  git -C "${script_dir}/../.." rev-parse --show-toplevel
}
default_revision_path() { printf '%s/.ops/deployed-revision.json' "$1"; }
resolve_revision_path() {
  local repo_root="$1"
  if [[ -n "${EXECUTION_SERVER_DEPLOYED_REVISION_PATH:-}" ]]; then printf '%s' "$EXECUTION_SERVER_DEPLOYED_REVISION_PATH"
  else default_revision_path "$repo_root"; fi
}
utc_now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
short_sha() { printf '%s' "$1" | cut -c1-7; }
default_image_tag() { printf '%s:%s-%s' "$EXECUTION_SERVER_IMAGE_PREFIX" "$(date -u '+%Y%m%d')" "$(short_sha "$1")"; }
require_confirm_or_noop() {
  local action="$1"
  if [[ "$CONFIRM" -eq 0 ]]; then
    log "execution-server ${action}: NO-OP (missing --confirm)"
    [[ "$DRY_RUN" -eq 1 ]] && log "  mode: dry-run"
    return 1
  fi
  return 0
}
print_noop_footer() {
  log ""; log "No mutation performed. Re-run with --confirm on the execution host to apply."
  log "Agents and Composer must never pass --confirm on execution-server tooling."
}
revision_merge_json() {
  local revision_path="$1" patch_json="$2" revision_dir; revision_dir="$(dirname "$revision_path")"
  node - "$revision_path" "$revision_dir" "$patch_json" <<'NODE'
const fs = require("node:fs");
const [revisionPath, revisionDir, patchJson] = process.argv.slice(2);
const patch = JSON.parse(patchJson);
let data = {};
if (fs.existsSync(revisionPath)) {
  try { data = JSON.parse(fs.readFileSync(revisionPath, "utf8")); }
  catch (err) { console.error(`error: invalid JSON in ${revisionPath}: ${err.message}`); process.exit(2); }
}
const merged = { ...data, ...patch };
// A tag change without a freshly inspected immutable id must never retain a
// stale image identity from a previous deployment (notably legacy rollback).
if (Object.hasOwn(patch, "imageTag") && !Object.hasOwn(patch, "imageId")) {
  delete merged.imageId;
}
if (Object.hasOwn(patch, "imageId") &&
    (typeof patch.imageId !== "string" || !/^sha256:[0-9a-f]{64}$/.test(patch.imageId))) {
  console.error("error: deployed-revision.json imageId must be an immutable sha256 image id"); process.exit(2);
}
const req = ["gitSha", "imageTag", "imageId", "deployedAt", "operator"];
if (req.every((k) => k in patch)) {
  for (const key of req) {
    if (typeof merged[key] !== "string" || !merged[key]) {
      console.error(`error: deployed-revision.json field ${key} must be a non-empty string`); process.exit(2);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(merged.gitSha)) {
    console.error("error: deployed-revision.json gitSha must be a 40-char lowercase hex SHA"); process.exit(2);
  }
}
fs.mkdirSync(revisionDir, { recursive: true });
fs.writeFileSync(revisionPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
NODE
}
read_revision_field() {
  local revision_path="$1" field="$2"; [[ -f "$revision_path" ]] || return 1
  node - "$revision_path" "$field" <<'NODE'
const fs = require("node:fs");
const [revisionPath, field] = process.argv.slice(2);
try {
  const value = JSON.parse(fs.readFileSync(revisionPath, "utf8"))[field];
  if (typeof value === "string" && value.length > 0) { process.stdout.write(value); process.exit(0); }
} catch {}
process.exit(1);
NODE
}
run_preflight() {
  local repo_root="$1" target_sha="$2" approved_ref="${3:-${EXECUTION_SERVER_APPROVED_REF:-refs/remotes/origin/main}}"
  EXECUTION_SERVER_TARGET_SHA="$target_sha" EXECUTION_SERVER_REPO_PATH="$repo_root" \
    EXECUTION_SERVER_APPROVED_REF="$approved_ref" \
    "${repo_root}/scripts/ops/execution-server-preflight.sh"
}
