#!/usr/bin/env bash
# Record H-ARCH-1 artifact identity triad for FHV official-scale CI.
#
# Semantics (locked):
#   FINAL_HEAD   = exact feature-branch PR HEAD proposed for merge (40-char),
#                  or the pushed commit SHA on push workflows
#   EXECUTED_SHA = exact SHA checked out and executed by the workflow
#                  (synthetic merge commit on pull_request merge-ref checkouts)
#   BASE_SHA     = exact base used for pull-request integration testing,
#                  or github.event.before on push (may be all-zeros for new refs)
#
# Does not switch CI away from merge-ref execution. Proves parent linkage when possible.
set -euo pipefail

# shellcheck source=scripts/ops/_fhv-artifact-identity-names.sh
source "$(dirname "${BASH_SOURCE[0]}")/_fhv-artifact-identity-names.sh"

ARTIFACT_ROOT="${FHV_OFFICIAL_SCALE_ARTIFACT_ROOT:-.artifacts/fhv-official-scale}"
mkdir -p "${ARTIFACT_ROOT}"

EXECUTED_SHA="$(git rev-parse HEAD)"
EVENT_NAME="${GITHUB_EVENT_NAME:-}"
PR_HEAD_SHA="${PR_HEAD_SHA:-}"
PR_BASE_SHA="${PR_BASE_SHA:-}"
PUSH_BEFORE_SHA="${PUSH_BEFORE_SHA:-}"

if [[ "${EVENT_NAME}" == "pull_request" ]]; then
  if [[ -z "${PR_HEAD_SHA}" || -z "${PR_BASE_SHA}" ]]; then
    echo "BLOCKED_BY_PR452_H_ARCH_1_VALIDATED_HEAD_PUSH_MISMATCH: missing PR head/base SHA in event" >&2
    exit 1
  fi
  FINAL_HEAD="${PR_HEAD_SHA}"
  BASE_SHA="${PR_BASE_SHA}"
else
  # Push / non-PR: FINAL_HEAD is the commit under test; BASE is event.before when present.
  FINAL_HEAD="${EXECUTED_SHA}"
  BASE_SHA="${PUSH_BEFORE_SHA}"
fi

if [[ ! "${FINAL_HEAD}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "BLOCKED_BY_PR452_H_ARCH_1_VALIDATED_HEAD_PUSH_MISMATCH: FINAL_HEAD not 40-char sha (${FINAL_HEAD})" >&2
  exit 1
fi
if [[ ! "${EXECUTED_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "BLOCKED_BY_PR452_H_ARCH_1_VALIDATED_HEAD_PUSH_MISMATCH: EXECUTED_SHA not 40-char sha (${EXECUTED_SHA})" >&2
  exit 1
fi

printf '%s\n' "${FINAL_HEAD}" > "${ARTIFACT_ROOT}/${FHV_IDENTITY_FINAL_HEAD_FILE}"
printf '%s\n' "${EXECUTED_SHA}" > "${ARTIFACT_ROOT}/${FHV_IDENTITY_EXECUTED_SHA_FILE}"
printf '%s\n' "${BASE_SHA}" > "${ARTIFACT_ROOT}/${FHV_IDENTITY_BASE_SHA_FILE}"

PARENT1=""
PARENT2=""
PARENT_PROOF="not_applicable"
if [[ "${EVENT_NAME}" == "pull_request" ]]; then
  # Prefer raw commit headers: shallow depth=1 merge-ref checkouts can hide parents from
  # rev-list/rev-parse even though the merge commit object still records both parents.
  PARENT1="$(git cat-file -p HEAD | awk '/^parent / { print $2; exit }')"
  PARENT2="$(git cat-file -p HEAD | awk '/^parent / { if (++n == 2) { print $2; exit } }')"
  if [[ -n "${PARENT1}" && -n "${PARENT2}" ]]; then
    if [[ "${PARENT1}" == "${BASE_SHA}" && "${PARENT2}" == "${FINAL_HEAD}" ]]; then
      PARENT_PROOF="merge_ref_parents_match"
    elif [[ "${PARENT1}" == "${FINAL_HEAD}" && "${PARENT2}" == "${BASE_SHA}" ]]; then
      PARENT_PROOF="merge_ref_parents_swapped_ok"
    else
      echo "BLOCKED_BY_PR452_H_ARCH_1_VALIDATED_HEAD_PUSH_MISMATCH: merge parents (${PARENT1}, ${PARENT2}) do not match BASE_SHA=${BASE_SHA} FINAL_HEAD=${FINAL_HEAD}" >&2
      exit 1
    fi
  elif [[ "${EXECUTED_SHA}" == "${FINAL_HEAD}" ]]; then
    PARENT_PROOF="head_checkout_no_merge_ref"
  else
    echo "BLOCKED_BY_PR452_H_ARCH_1_VALIDATED_HEAD_PUSH_MISMATCH: expected merge commit parents for PR checkout (executed=${EXECUTED_SHA} final=${FINAL_HEAD} parent1=${PARENT1:-none} parent2=${PARENT2:-none})" >&2
    exit 1
  fi
fi

export ARTIFACT_ROOT FINAL_HEAD EXECUTED_SHA BASE_SHA EVENT_NAME PARENT_PROOF PARENT1 PARENT2
export FHV_IDENTITY_MANIFEST_FILE
node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.ARTIFACT_ROOT;
const payload = {
  schemaVersion: "fhv-artifact-identity/v1",
  finalHead: process.env.FINAL_HEAD,
  executedSha: process.env.EXECUTED_SHA,
  baseSha: process.env.BASE_SHA ?? "",
  eventName: process.env.EVENT_NAME ?? "",
  parentProof: process.env.PARENT_PROOF ?? "",
  parent1: process.env.PARENT1 ?? "",
  parent2: process.env.PARENT2 ?? "",
};
fs.writeFileSync(
  path.join(root, process.env.FHV_IDENTITY_MANIFEST_FILE),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8",
);
console.log(
  `artifact-identity finalHead=${payload.finalHead} executedSha=${payload.executedSha} baseSha=${payload.baseSha} proof=${payload.parentProof}`,
);
NODE
