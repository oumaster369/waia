#!/usr/bin/env bash
# DEE-436 — read-only FHV supervisor residual-state inspection (PRE_AUTH).
set -euo pipefail

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

SYSTEMCTL=""
PYTHON_BIN=""
SYSTEMD_DIR="/etc/systemd/system"
EXPECTED_RUN_ID=""
EXPECTED_TARGET_SHA=""
EXPECTED_ORGANIZATION_ID=""
EXPECTED_HOSTNAME=""
EXPECTED_MACHINE_ID_SHA256=""

usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-supervisor-residual-state-read.sh \
  --systemctl-bin PATH \
  --python-bin PATH \
  --systemd-dir DIR \
  --expected-run-id ID \
  --expected-target-sha SHA \
  --expected-organization-id UUID \
  --expected-hostname HOST \
  --expected-machine-id-sha256 HEX

Read-only. Never reads environment-file contents. Linux only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --systemctl-bin) SYSTEMCTL="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    --systemd-dir) SYSTEMD_DIR="${2:-}"; shift 2 ;;
    --expected-run-id) EXPECTED_RUN_ID="${2:-}"; shift 2 ;;
    --expected-target-sha) EXPECTED_TARGET_SHA="${2:-}"; shift 2 ;;
    --expected-organization-id) EXPECTED_ORGANIZATION_ID="${2:-}"; shift 2 ;;
    --expected-hostname) EXPECTED_HOSTNAME="${2:-}"; shift 2 ;;
    --expected-machine-id-sha256) EXPECTED_MACHINE_ID_SHA256="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$SYSTEMCTL" && -x "$SYSTEMCTL" ]] || fail "--systemctl-bin required and executable"
[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || fail "--python-bin required and executable"
[[ -n "$EXPECTED_RUN_ID" ]] || fail "--expected-run-id required"
[[ -n "$EXPECTED_TARGET_SHA" ]] || fail "--expected-target-sha required"
[[ -n "$EXPECTED_ORGANIZATION_ID" ]] || fail "--expected-organization-id required"
[[ -n "$EXPECTED_HOSTNAME" ]] || fail "--expected-hostname required"
[[ -n "$EXPECTED_MACHINE_ID_SHA256" ]] || fail "--expected-machine-id-sha256 required"

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "Linux only"
fi

readonly FHV_CAMPAIGN_UNIT="waia-fhv-campaign.service"
readonly FHV_OBSERVER_UNIT="waia-fhv-observer.service"
readonly FHV_ALLOWED_UNITS=("$FHV_CAMPAIGN_UNIT" "$FHV_OBSERVER_UNIT")

assert_allowed_unit() {
  local unit="$1"
  local allowed
  for allowed in "${FHV_ALLOWED_UNITS[@]}"; do
    [[ "$unit" == "$allowed" ]] && return 0
  done
  fail "unit not allowlisted: ${unit}"
}

classify_systemctl_is_active() {
  local unit="$1"
  local exit_code=0
  local output=""
  output="$("$SYSTEMCTL" is-active "$unit" 2>&1)" || exit_code=$?
  case "$exit_code" in
    0)
      if [[ "$output" == "active" || "$output" == "activating" || "$output" == "reloading" ]]; then
        printf '%s\n' "active"
        return 0
      fi
      fail "fatal: malformed is-active success output for ${unit}: ${output}"
      ;;
    3)
      printf '%s\n' "inactive"
      return 0
      ;;
    4)
      printf '%s\n' "not-found"
      return 0
      ;;
    1)
      if [[ "$output" == "inactive" || "$output" == "failed" || "$output" == "deactivating" ]]; then
        printf '%s\n' "inactive"
        return 0
      fi
      fail "fatal: unclassified is-active exit 1 for ${unit}: ${output}"
      ;;
    126|127)
      fail "fatal: systemctl unavailable for is-active ${unit}"
      ;;
    *)
      fail "fatal: unclassified is-active exit ${exit_code} for ${unit}: ${output}"
      ;;
  esac
}

classify_systemctl_is_enabled() {
  local unit="$1"
  local exit_code=0
  local output=""
  output="$("$SYSTEMCTL" is-enabled "$unit" 2>&1)" || exit_code=$?
  case "$exit_code" in
    0)
      printf '%s\n' "enabled"
      return 0
      ;;
    1)
      if [[ "$output" == "disabled" || "$output" == "masked" || "$output" == "static" || "$output" == "indirect" ]]; then
        printf '%s\n' "disabled"
        return 0
      fi
      fail "fatal: unclassified is-enabled exit 1 for ${unit}: ${output}"
      ;;
    4)
      printf '%s\n' "not-found"
      return 0
      ;;
    126|127)
      fail "fatal: systemctl unavailable for is-enabled ${unit}"
      ;;
    *)
      fail "fatal: unclassified is-enabled exit ${exit_code} for ${unit}: ${output}"
      ;;
  esac
}

HOSTNAME="$(hostname -f 2>/dev/null || hostname)"
MACHINE_ID_SHA256="$(printf '%s' "$(tr -d '\n' < /etc/machine-id)" | sha256sum | awk '{print $1}')"
HOST_BOOT_ID="$(tr -d '\n' < /proc/sys/kernel/random/boot_id)"

read_unit_state() {
  local unit_name="$1"
  assert_allowed_unit "$unit_name"
  local unit_path="${SYSTEMD_DIR}/${unit_name}"
  local unit_file_exists="false"
  local unit_file_sha256=""
  local load_state="" unit_file_state="" active_state="" sub_state="" fragment_path=""
  local enabled_state="" active_class="" is_failed="false"
  local exec_start="" working_directory="" environment_file="" embedded_run_id="" embedded_target_sha="" embedded_org_id=""

  if [[ -f "$unit_path" ]]; then
    unit_file_exists="true"
    unit_file_sha256="$(sha256sum "$unit_path" | awk '{print $1}')"
  fi

  load_state="$("$SYSTEMCTL" show "$unit_name" -p LoadState --value 2>/dev/null || true)"
  unit_file_state="$("$SYSTEMCTL" show "$unit_name" -p UnitFileState --value 2>/dev/null || true)"
  active_state="$("$SYSTEMCTL" show "$unit_name" -p ActiveState --value 2>/dev/null || true)"
  sub_state="$("$SYSTEMCTL" show "$unit_name" -p SubState --value 2>/dev/null || true)"
  fragment_path="$("$SYSTEMCTL" show "$unit_name" -p FragmentPath --value 2>/dev/null || true)"
  exec_start="$("$SYSTEMCTL" show "$unit_name" -p ExecStart --value 2>/dev/null || true)"
  working_directory="$("$SYSTEMCTL" show "$unit_name" -p WorkingDirectory --value 2>/dev/null || true)"
  environment_file="$("$SYSTEMCTL" show "$unit_name" -p EnvironmentFile --value 2>/dev/null || true)"

  enabled_state="$(classify_systemctl_is_enabled "$unit_name")"
  active_class="$(classify_systemctl_is_active "$unit_name")"
  if [[ "$active_state" == "failed" || "$sub_state" == "failed" ]]; then
    is_failed="true"
  fi

  if [[ -f "$unit_path" ]]; then
    embedded_run_id="$(grep -E '^Environment=FHV_RUN_ID=' "$unit_path" | head -n1 | sed 's/^Environment=FHV_RUN_ID=//' || true)"
    embedded_target_sha="$(grep -E '^Environment=FHV_TARGET_SHA=' "$unit_path" | head -n1 | sed 's/^Environment=FHV_TARGET_SHA=//' || true)"
    embedded_org_id="$(grep -E '^Environment=FHV_ORGANIZATION_ID=' "$unit_path" | head -n1 | sed 's/^Environment=FHV_ORGANIZATION_ID=//' || true)"
  fi

  UNIT_NAME="$unit_name" UNIT_FILE_EXISTS="$unit_file_exists" UNIT_FILE_PATH="$unit_path" \
  UNIT_FILE_SHA256="$unit_file_sha256" LOAD_STATE="$load_state" UNIT_FILE_STATE="$unit_file_state" \
  ACTIVE_STATE="$active_state" SUB_STATE="$sub_state" FRAGMENT_PATH="$fragment_path" \
  ENABLED_STATE="$enabled_state" ACTIVE_CLASS="$active_class" IS_FAILED="$is_failed" \
  EXEC_START="$exec_start" WORKING_DIRECTORY="$working_directory" ENVIRONMENT_FILE="$environment_file" \
  EMBEDDED_RUN_ID="$embedded_run_id" EMBEDDED_TARGET_SHA="$embedded_target_sha" EMBEDDED_ORG_ID="$embedded_org_id" \
  "$PYTHON_BIN" - <<'PY'
import json, os
print(json.dumps({
    "unitName": os.environ["UNIT_NAME"],
    "unitFileExists": os.environ["UNIT_FILE_EXISTS"] == "true",
    "unitFilePath": os.environ["UNIT_FILE_PATH"],
    "unitFileSha256": os.environ["UNIT_FILE_SHA256"] or None,
    "loadState": os.environ["LOAD_STATE"],
    "unitFileState": os.environ["UNIT_FILE_STATE"],
    "activeState": os.environ["ACTIVE_STATE"],
    "subState": os.environ["SUB_STATE"],
    "fragmentPath": os.environ["FRAGMENT_PATH"],
    "enabledState": os.environ["ENABLED_STATE"],
    "activeClass": os.environ["ACTIVE_CLASS"],
    "isFailed": os.environ["IS_FAILED"] == "true",
    "execStart": os.environ["EXEC_START"],
    "workingDirectory": os.environ["WORKING_DIRECTORY"],
    "environmentFilePath": os.environ["ENVIRONMENT_FILE"],
    "embeddedRunId": os.environ["EMBEDDED_RUN_ID"] or None,
    "embeddedTargetSha": os.environ["EMBEDDED_TARGET_SHA"] or None,
    "embeddedOrganizationId": os.environ["EMBEDDED_ORG_ID"] or None,
}, separators=(",", ":")))
PY
}

OBSERVER_JSON="$(read_unit_state "$FHV_OBSERVER_UNIT")"
CAMPAIGN_JSON="$(read_unit_state "$FHV_CAMPAIGN_UNIT")"

export FHV_JSON_PAYLOAD
FHV_JSON_PAYLOAD="$(
  EXPECTED_RUN_ID="$EXPECTED_RUN_ID" EXPECTED_TARGET_SHA="$EXPECTED_TARGET_SHA" \
  EXPECTED_ORGANIZATION_ID="$EXPECTED_ORGANIZATION_ID" EXPECTED_HOSTNAME="$EXPECTED_HOSTNAME" \
  EXPECTED_MACHINE_ID_SHA256="$EXPECTED_MACHINE_ID_SHA256" HOSTNAME="$HOSTNAME" \
  MACHINE_ID_SHA256="$MACHINE_ID_SHA256" HOST_BOOT_ID="$HOST_BOOT_ID" \
  OBSERVER_JSON="$OBSERVER_JSON" CAMPAIGN_JSON="$CAMPAIGN_JSON" \
  "$PYTHON_BIN" - <<'PY'
import json, os
payload = {
    "schemaVersion": "fhv-t4-supervisor-residual-state/v1",
    "expectedRunId": os.environ["EXPECTED_RUN_ID"],
    "expectedTargetSha": os.environ["EXPECTED_TARGET_SHA"],
    "expectedOrganizationId": os.environ["EXPECTED_ORGANIZATION_ID"],
    "expectedHostname": os.environ["EXPECTED_HOSTNAME"],
    "expectedMachineIdSha256": os.environ["EXPECTED_MACHINE_ID_SHA256"],
    "observedHostname": os.environ["HOSTNAME"],
    "observedMachineIdSha256": os.environ["MACHINE_ID_SHA256"],
    "hostBootId": os.environ["HOST_BOOT_ID"],
    "units": [
        json.loads(os.environ["OBSERVER_JSON"]),
        json.loads(os.environ["CAMPAIGN_JSON"]),
    ],
}
print(json.dumps(payload, separators=(",", ":")))
PY
)"
printf '%s\n' "$FHV_JSON_PAYLOAD"
