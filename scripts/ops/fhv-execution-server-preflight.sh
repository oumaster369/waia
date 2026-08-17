#!/usr/bin/env bash
# Candidate-neutral Execution Server preflight (DEE-536).
#
# Prepare only during software Build. Do not SSH to the candidate unless --execute
# is explicitly supplied by a Human on the operational host path.
#
# Target candidate only:
#   IP: 185.189.46.53
#   hostname: waia-dee536-execution-candidate
#   SSH identity: $HOME/.ssh/waia_cherry_dee536
#   checkout: /opt/waia/waia-dee536-hostqual
#   work root: /opt/waia/fhv-work (must be XFS)
#   Node: v22.23.0
#
# Usage:
#   ./scripts/ops/fhv-execution-server-preflight.sh --prepare-only
#   ./scripts/ops/fhv-execution-server-preflight.sh --fixture-local
#   ./scripts/ops/fhv-execution-server-preflight.sh --execute --release-sha <40hex>
#
# Terminal result (fixture-local or execute):
#   EXECUTION_SERVER_PREFLIGHT=PASS
#   EXECUTION_SERVER_PREFLIGHT=BLOCKED_<EXACT_REASON>

set -euo pipefail

readonly EXPECTED_IP="185.189.46.53"
readonly EXPECTED_HOSTNAME="waia-dee536-execution-candidate"
readonly EXPECTED_CHECKOUT="/opt/waia/waia-dee536-hostqual"
readonly EXPECTED_WORK_ROOT="/opt/waia/fhv-work"
readonly EXPECTED_NODE="v22.23.0"
readonly FORBIDDEN_PRODUCTION_HOSTNAME_RE='(prod|production|waia-live)'
SSH_IDENTITY="${FHV_EXECUTION_SERVER_SSH_IDENTITY:-$HOME/.ssh/waia_cherry_dee536}"

MODE=""
RELEASE_SHA="${EXECUTION_SERVER_TARGET_SHA:-}"

usage() {
  cat >&2 <<EOF
Usage:
  $0 --prepare-only
  $0 --fixture-local
  $0 --execute --release-sha <40hex>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prepare-only) MODE="prepare"; shift ;;
    --fixture-local) MODE="fixture"; shift ;;
    --execute) MODE="execute"; shift ;;
    --release-sha)
      RELEASE_SHA="${2:-}"
      shift 2
      ;;
    -h|--help) usage; exit 2 ;;
    *)
      printf 'EXECUTION_SERVER_PREFLIGHT=BLOCKED_UNKNOWN_FLAG\n'
      exit 1
      ;;
  esac
done

if [[ -z "${MODE}" ]]; then
  printf 'EXECUTION_SERVER_PREFLIGHT=BLOCKED_MODE_REQUIRED\n'
  exit 1
fi

emit_pass() {
  printf 'EXECUTION_SERVER_PREFLIGHT=PASS\n'
}

emit_blocked() {
  printf 'EXECUTION_SERVER_PREFLIGHT=BLOCKED_%s\n' "$1"
  exit 1
}

if [[ "${MODE}" == "prepare" ]]; then
  cat <<EOF
# PREPARED — do not run during software Build.
ssh -i "${SSH_IDENTITY}" -o StrictHostKeyChecking=yes root@${EXPECTED_IP} \\
  'set -euo pipefail
   hostname -f
   cat /etc/machine-id
   cat /proc/sys/kernel/random/boot_id
   uname -srm
   nproc
   free -b
   df -hT ${EXPECTED_WORK_ROOT}
   test -d ${EXPECTED_CHECKOUT}
   test -d ${EXPECTED_WORK_ROOT}
   node -v
   git -C ${EXPECTED_CHECKOUT} rev-parse HEAD'
# Bind: IP=${EXPECTED_IP} hostname=${EXPECTED_HOSTNAME} checkout=${EXPECTED_CHECKOUT}
# work_root=${EXPECTED_WORK_ROOT} node=${EXPECTED_NODE} identity=${SSH_IDENTITY}
# Then classify EXECUTION_SERVER_PREFLIGHT=PASS or EXECUTION_SERVER_PREFLIGHT=BLOCKED_<REASON>
EOF
  printf 'EXECUTION_SERVER_PREFLIGHT=BLOCKED_PREPARE_ONLY_NOT_EXECUTED\n'
  exit 0
fi

evaluate_facts() {
  local hostname_value="$1"
  local ip_value="$2"
  local node_value="$3"
  local fstype_value="$4"
  local checkout_exists="$5"
  local work_exists="$6"
  local checkout_sha="$7"
  local expected_sha="$8"

  if [[ "${hostname_value}" =~ ${FORBIDDEN_PRODUCTION_HOSTNAME_RE} ]]; then
    emit_blocked "OLD_PRODUCTION_HOSTNAME"
  fi
  if [[ "${hostname_value}" != "${EXPECTED_HOSTNAME}" ]]; then
    emit_blocked "HOSTNAME_MISMATCH"
  fi
  if [[ "${ip_value}" != "${EXPECTED_IP}" ]]; then
    emit_blocked "IP_MISMATCH"
  fi
  if [[ "${node_value}" != "${EXPECTED_NODE}" ]]; then
    emit_blocked "NODE_VERSION_MISMATCH"
  fi
  if [[ "${fstype_value}" != "xfs" ]]; then
    emit_blocked "WORK_ROOT_NOT_XFS"
  fi
  if [[ "${checkout_exists}" != "yes" ]]; then
    emit_blocked "CHECKOUT_MISSING"
  fi
  if [[ "${work_exists}" != "yes" ]]; then
    emit_blocked "WORK_ROOT_MISSING"
  fi
  if [[ -n "${expected_sha}" && "${checkout_sha}" != "${expected_sha}" ]]; then
    emit_blocked "CHECKOUT_SHA_MISMATCH"
  fi
  emit_pass
}

if [[ "${MODE}" == "fixture" ]]; then
  evaluate_facts \
    "${FHV_PREFLIGHT_FIXTURE_HOSTNAME:-$EXPECTED_HOSTNAME}" \
    "${FHV_PREFLIGHT_FIXTURE_IP:-$EXPECTED_IP}" \
    "${FHV_PREFLIGHT_FIXTURE_NODE:-$EXPECTED_NODE}" \
    "${FHV_PREFLIGHT_FIXTURE_FSTYPE:-xfs}" \
    "${FHV_PREFLIGHT_FIXTURE_CHECKOUT_EXISTS:-yes}" \
    "${FHV_PREFLIGHT_FIXTURE_WORK_EXISTS:-yes}" \
    "${FHV_PREFLIGHT_FIXTURE_CHECKOUT_SHA:-}" \
    "${RELEASE_SHA}"
  exit 0
fi

if [[ ! -f "${SSH_IDENTITY}" ]]; then
  emit_blocked "SSH_IDENTITY_MISSING"
fi
if [[ -z "${RELEASE_SHA}" || ! "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  emit_blocked "RELEASE_SHA_REQUIRED"
fi

# Human operational path only. Software Build must not reach here.
REMOTE_FACTS="$(ssh -i "${SSH_IDENTITY}" -o StrictHostKeyChecking=yes -o BatchMode=yes "root@${EXPECTED_IP}" \
  "python3 - <<'PY'
import os, socket, subprocess, json
def sh(cmd):
    try:
        return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ''
facts = {
  'hostname': socket.gethostname(),
  'ip': '${EXPECTED_IP}',
  'node': sh('node -v'),
  'fstype': sh('findmnt -no FSTYPE ${EXPECTED_WORK_ROOT} || stat -f -c %T ${EXPECTED_WORK_ROOT}'),
  'checkout_exists': 'yes' if os.path.isdir('${EXPECTED_CHECKOUT}') else 'no',
  'work_exists': 'yes' if os.path.isdir('${EXPECTED_WORK_ROOT}') else 'no',
  'checkout_sha': sh('git -C ${EXPECTED_CHECKOUT} rev-parse HEAD'),
}
print(json.dumps(facts))
PY")"

HOSTNAME_VALUE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["hostname"])' "${REMOTE_FACTS}")"
NODE_VALUE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["node"])' "${REMOTE_FACTS}")"
FSTYPE_VALUE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["fstype"])' "${REMOTE_FACTS}")"
CHECKOUT_EXISTS="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["checkout_exists"])' "${REMOTE_FACTS}")"
WORK_EXISTS="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["work_exists"])' "${REMOTE_FACTS}")"
CHECKOUT_SHA="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["checkout_sha"])' "${REMOTE_FACTS}")"

evaluate_facts \
  "${HOSTNAME_VALUE}" \
  "${EXPECTED_IP}" \
  "${NODE_VALUE}" \
  "${FSTYPE_VALUE}" \
  "${CHECKOUT_EXISTS}" \
  "${WORK_EXISTS}" \
  "${CHECKOUT_SHA}" \
  "${RELEASE_SHA}"
