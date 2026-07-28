#!/usr/bin/env bash
# DEE-436 — governed Human-only FHV supervisor residual-unit recovery.
set -euo pipefail

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

PREVIEW=0
CONFIRM=0
SYSTEMCTL=""
PYTHON_BIN=""
SYSTEMD_DIR="/etc/systemd/system"
FAILED_RUN_ID=""
FAILED_TARGET_SHA=""
FAILED_RELEASE_TAG=""
EXPECTED_HOSTNAME=""
EXPECTED_MACHINE_ID_SHA256=""
EXPECTED_ORGANIZATION_ID=""
EXPECTED_OPERATOR_ID=""
RECOVERY_AUTHORIZATION=""

readonly RECOVERY_AUTH_LITERAL="AUTHORIZE-FHV-T4A-RESIDUAL-UNIT-RECOVERY"

usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-supervisor-residual-recovery.sh --preview ...bindings...
       fhv-t4-supervisor-residual-recovery.sh --confirm ...bindings...

Preview: read-only discovery + policy evaluation (zero mutations).
Confirm: requires FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION env exact literal.
Mutating phase stops/disables only waia-fhv-observer.service and waia-fhv-campaign.service.
Never deletes unit files or touches failed checkout/run/evidence.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preview) PREVIEW=1; shift ;;
    --confirm) CONFIRM=1; shift ;;
    --systemctl-bin) SYSTEMCTL="${2:-}"; shift 2 ;;
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    --systemd-dir) SYSTEMD_DIR="${2:-}"; shift 2 ;;
    --failed-run-id) FAILED_RUN_ID="${2:-}"; shift 2 ;;
    --failed-target-sha) FAILED_TARGET_SHA="${2:-}"; shift 2 ;;
    --failed-release-tag) FAILED_RELEASE_TAG="${2:-}"; shift 2 ;;
    --expected-hostname) EXPECTED_HOSTNAME="${2:-}"; shift 2 ;;
    --expected-machine-id-sha256) EXPECTED_MACHINE_ID_SHA256="${2:-}"; shift 2 ;;
    --expected-organization-id) EXPECTED_ORGANIZATION_ID="${2:-}"; shift 2 ;;
    --expected-operator-id) EXPECTED_OPERATOR_ID="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$PREVIEW" -eq 1 || "$CONFIRM" -eq 1 ]] || fail "exactly one of --preview or --confirm required"
[[ "$PREVIEW" -eq 0 || "$CONFIRM" -eq 0 ]] || fail "--preview and --confirm are mutually exclusive"

[[ -n "$SYSTEMCTL" && -x "$SYSTEMCTL" ]] || fail "--systemctl-bin required and executable"
[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || fail "--python-bin required and executable"
[[ -n "$FAILED_RUN_ID" ]] || fail "--failed-run-id required"
[[ -n "$FAILED_TARGET_SHA" ]] || fail "--failed-target-sha required"
[[ -n "$FAILED_RELEASE_TAG" ]] || fail "--failed-release-tag required"
[[ -n "$EXPECTED_HOSTNAME" ]] || fail "--expected-hostname required"
[[ -n "$EXPECTED_MACHINE_ID_SHA256" ]] || fail "--expected-machine-id-sha256 required"
[[ -n "$EXPECTED_ORGANIZATION_ID" ]] || fail "--expected-organization-id required"
[[ -n "$EXPECTED_OPERATOR_ID" ]] || fail "--expected-operator-id required"

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "Linux only"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=fhv-supervisor/_fhv-supervisor-common.sh
source "${SCRIPT_DIR}/fhv-supervisor/_fhv-supervisor-common.sh"

HOSTNAME="$(hostname -f 2>/dev/null || hostname)"
MACHINE_ID_SHA256="$(printf '%s' "$(tr -d '\n' < /etc/machine-id)" | sha256sum | awk '{print $1}')"
HOST_BOOT_ID="$(tr -d '\n' < /proc/sys/kernel/random/boot_id)"

if [[ "$HOSTNAME" != "$EXPECTED_HOSTNAME" ]]; then
  fail "hostname drift: expected ${EXPECTED_HOSTNAME}, got ${HOSTNAME}"
fi
if [[ "$MACHINE_ID_SHA256" != "$EXPECTED_MACHINE_ID_SHA256" ]]; then
  fail "machine-id drift"
fi

capture_unit_evidence() {
  local unit_name="$1"
  assert_allowed_unit "$unit_name"
  local unit_path="${SYSTEMD_DIR}/${unit_name}"
  local unit_file_exists="false"
  local unit_file_sha256=""
  local embedded_run_id="" embedded_target_sha="" embedded_org_id=""
  if [[ -f "$unit_path" ]]; then
    unit_file_exists="true"
    unit_file_sha256="$(sha256sum "$unit_path" | awk '{print $1}')"
    embedded_run_id="$(grep -E '^Environment=FHV_RUN_ID=' "$unit_path" | head -n1 | sed 's/^Environment=FHV_RUN_ID=//' || true)"
    embedded_target_sha="$(grep -E '^Environment=FHV_TARGET_SHA=' "$unit_path" | head -n1 | sed 's/^Environment=FHV_TARGET_SHA=//' || true)"
    embedded_org_id="$(grep -E '^Environment=FHV_ORGANIZATION_ID=' "$unit_path" | head -n1 | sed 's/^Environment=FHV_ORGANIZATION_ID=//' || true)"
  fi
  UNIT_NAME="$unit_name" UNIT_FILE_EXISTS="$unit_file_exists" UNIT_FILE_PATH="$unit_path" \
  UNIT_FILE_SHA256="$unit_file_sha256" \
  LOAD_STATE="$("$SYSTEMCTL" show "$unit_name" -p LoadState --value 2>/dev/null || true)" \
  ACTIVE_STATE="$("$SYSTEMCTL" show "$unit_name" -p ActiveState --value 2>/dev/null || true)" \
  SUB_STATE="$("$SYSTEMCTL" show "$unit_name" -p SubState --value 2>/dev/null || true)" \
  FRAGMENT_PATH="$("$SYSTEMCTL" show "$unit_name" -p FragmentPath --value 2>/dev/null || true)" \
  ENABLED_STATE="$(classify_systemctl_is_enabled "$unit_name")" \
  ACTIVE_CLASS="$(classify_systemctl_is_active "$unit_name")" \
  EXEC_START="$("$SYSTEMCTL" show "$unit_name" -p ExecStart --value 2>/dev/null || true)" \
  WORKING_DIRECTORY="$("$SYSTEMCTL" show "$unit_name" -p WorkingDirectory --value 2>/dev/null || true)" \
  ENVIRONMENT_FILE="$("$SYSTEMCTL" show "$unit_name" -p EnvironmentFile --value 2>/dev/null || true)" \
  EMBEDDED_RUN_ID="$embedded_run_id" EMBEDDED_TARGET_SHA="$embedded_target_sha" EMBEDDED_ORG_ID="$embedded_org_id" \
  "$PYTHON_BIN" - <<'PY'
import json, os
print(json.dumps({
    "unitName": os.environ["UNIT_NAME"],
    "unitFileExists": os.environ["UNIT_FILE_EXISTS"] == "true",
    "unitFilePath": os.environ["UNIT_FILE_PATH"],
    "unitFileSha256": os.environ["UNIT_FILE_SHA256"] or None,
    "loadState": os.environ["LOAD_STATE"],
    "unitFileState": os.environ["LOAD_STATE"],
    "activeState": os.environ["ACTIVE_STATE"],
    "subState": os.environ["SUB_STATE"],
    "fragmentPath": os.environ["FRAGMENT_PATH"],
    "enabledState": os.environ["ENABLED_STATE"],
    "activeClass": os.environ["ACTIVE_CLASS"],
    "isFailed": os.environ["ACTIVE_STATE"] == "failed" or os.environ["SUB_STATE"] == "failed",
    "execStart": os.environ["EXEC_START"],
    "workingDirectory": os.environ["WORKING_DIRECTORY"],
    "environmentFilePath": os.environ["ENVIRONMENT_FILE"],
    "embeddedRunId": os.environ["EMBEDDED_RUN_ID"] or None,
    "embeddedTargetSha": os.environ["EMBEDDED_TARGET_SHA"] or None,
    "embeddedOrganizationId": os.environ["EMBEDDED_ORG_ID"] or None,
}, separators=(",", ":")))
PY
}

emit_payload() {
  local phase="$1"
  local classification="$2"
  local before_observer="$3"
  local before_campaign="$4"
  local after_observer="${5:-}"
  local after_campaign="${6:-}"
  PHASE="$phase" CLASSIFICATION="$classification" \
  FAILED_RUN_ID="$FAILED_RUN_ID" FAILED_TARGET_SHA="$FAILED_TARGET_SHA" \
  FAILED_RELEASE_TAG="$FAILED_RELEASE_TAG" EXPECTED_ORGANIZATION_ID="$EXPECTED_ORGANIZATION_ID" \
  EXPECTED_OPERATOR_ID="$EXPECTED_OPERATOR_ID" HOST_BOOT_ID="$HOST_BOOT_ID" \
  BEFORE_OBSERVER="$before_observer" BEFORE_CAMPAIGN="$before_campaign" \
  AFTER_OBSERVER="$after_observer" AFTER_CAMPAIGN="$after_campaign" \
  "$PYTHON_BIN" - <<'PY'
import json, os
payload = {
    "schemaVersion": "fhv-t4-supervisor-residual-recovery/v1",
    "phase": os.environ["PHASE"],
    "classification": os.environ["CLASSIFICATION"],
    "failedRunId": os.environ["FAILED_RUN_ID"],
    "failedTargetSha": os.environ["FAILED_TARGET_SHA"],
    "failedReleaseTag": os.environ["FAILED_RELEASE_TAG"],
    "organizationId": os.environ["EXPECTED_ORGANIZATION_ID"],
    "operatorId": os.environ["EXPECTED_OPERATOR_ID"],
    "hostBootId": os.environ["HOST_BOOT_ID"],
    "beforeState": {
        "units": [json.loads(os.environ["BEFORE_OBSERVER"]), json.loads(os.environ["BEFORE_CAMPAIGN"])],
    },
}
if os.environ.get("AFTER_OBSERVER") and os.environ.get("AFTER_CAMPAIGN"):
    payload["afterState"] = {
        "units": [json.loads(os.environ["AFTER_OBSERVER"]), json.loads(os.environ["AFTER_CAMPAIGN"])],
    }
print(json.dumps(payload, separators=(",", ":")))
PY
}

BEFORE_OBSERVER="$(capture_unit_evidence "$FHV_OBSERVER_UNIT")"
BEFORE_CAMPAIGN="$(capture_unit_evidence "$FHV_CAMPAIGN_UNIT")"

if [[ "$PREVIEW" -eq 1 ]]; then
  emit_payload "preview" "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK" "$BEFORE_OBSERVER" "$BEFORE_CAMPAIGN"
  exit 0
fi

RECOVERY_AUTHORIZATION="${FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION:-}"
if [[ "$RECOVERY_AUTHORIZATION" != "$RECOVERY_AUTH_LITERAL" ]]; then
  fail "recovery requires exact env ${RECOVERY_AUTH_LITERAL}"
fi

recover_one() {
  local unit_name="$1"
  assert_allowed_unit "$unit_name"
  local active_state enabled_state
  active_state="$(classify_systemctl_is_active "$unit_name")"
  enabled_state="$(classify_systemctl_is_enabled "$unit_name")"
  case "$active_state" in
    active) "$SYSTEMCTL" stop "$unit_name" ;;
    inactive|not-found) ;;
    *) fail "unclassified active state for recovery: ${active_state}" ;;
  esac
  case "$enabled_state" in
    enabled) "$SYSTEMCTL" disable "$unit_name" ;;
    disabled|not-found) ;;
    *) fail "unclassified enabled state for recovery: ${enabled_state}" ;;
  esac
}

recover_one "$FHV_OBSERVER_UNIT"
recover_one "$FHV_CAMPAIGN_UNIT"
"$SYSTEMCTL" daemon-reload

AFTER_OBSERVER="$(capture_unit_evidence "$FHV_OBSERVER_UNIT")"
AFTER_CAMPAIGN="$(capture_unit_evidence "$FHV_CAMPAIGN_UNIT")"

for unit_json in "$AFTER_OBSERVER" "$AFTER_CAMPAIGN"; do
  ENABLED="$(printf '%s' "$unit_json" | "$PYTHON_BIN" -c 'import json,sys; print(json.load(sys.stdin)["enabledState"])')"
  ACTIVE="$(printf '%s' "$unit_json" | "$PYTHON_BIN" -c 'import json,sys; print(json.load(sys.stdin)["activeClass"])')"
  if [[ "$ENABLED" == "enabled" ]]; then
    fail "recovery verification failed: unit still enabled"
  fi
  if [[ "$ACTIVE" == "active" ]]; then
    fail "recovery verification failed: unit still active"
  fi
done

emit_payload "recovery" "FHV_T4A_RESIDUAL_RECOVERY_OK" "$BEFORE_OBSERVER" "$BEFORE_CAMPAIGN" "$AFTER_OBSERVER" "$AFTER_CAMPAIGN"
