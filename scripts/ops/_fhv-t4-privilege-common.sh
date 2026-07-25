#!/usr/bin/env bash
# DEE-436 — shared root/service-user privilege helpers for T4A host scripts.
set -euo pipefail

fhv_t4_require_effective_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    printf 'error: caller must have effective UID 0\n' >&2
    exit 2
  fi
}

fhv_t4_resolve_service_user_identity() {
  local service_user="$1"
  if ! id -u "$service_user" >/dev/null 2>&1; then
    printf 'error: service user does not exist: %s\n' "$service_user" >&2
    exit 2
  fi
  FHV_SERVICE_UID="$(id -u "$service_user")"
  FHV_SERVICE_GID="$(id -g "$service_user")"
  FHV_SERVICE_GROUP="$(id -gn "$service_user")"
  if [[ "$FHV_SERVICE_UID" -eq 0 ]]; then
    printf 'error: service user UID must be nonzero\n' >&2
    exit 2
  fi
}

fhv_t4_emit_json() {
  local python_bin="$1"
  shift
  "$python_bin" -c 'import json, os, sys; print(json.dumps(json.loads(os.environ["FHV_JSON_PAYLOAD"]), separators=(",", ":")))'
}
