---
integrationIssue: DEE-435
integrationTitle: "AI-TRADER: FHV T4 deterministic runtime and systemd deployment record"
branch: dee-435-fhv-t4-deterministic-runtime
riskTier: T2
prPolicy: one-pr
executionSurfaces: [local, cursor-agent, github-actions]
requiredValidation: [lint, typecheck, unit, build, validate-pr-governance]
approvalGates: [integration-ready, human-merge]
parentIssue: DEE-416
dependsOn: [DEE-433, DEE-434]
bindings:
  t4DeterministicPauseManifestField: t4DeterministicPause
  deterministicPauseAtCycle: 40
  pauseArmedRecord: control/fhv-t4-pause-armed.v1.json
  systemdDeployedRevisionPath: .ops/fhv-systemd-deployed-revision.v1.json
  legacyDockerRecordPath: .ops/deployed-revision.json
  legacyContainerName: ai-trader-execution-host
  legacyContainerImage: waia-execution-host:bp6
  observerLocalhost: 127.0.0.1:9471
  operatorCliSubcommands: [status, arm-pause, resume, verify]
  packageScripts:
    - trader:fhv:t4:status
    - trader:fhv:t4:arm-pause
    - trader:fhv:t4:resume
    - trader:fhv:t4:verify
  opsScripts:
    - scripts/ops/fhv-systemd-record-deploy.sh
    - scripts/ops/fhv-systemd-verify-deploy.sh
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  executionServerSurface: none
  t4Authorization: none
  blockedReason: null
provenance:
  createdFrom: chat
  groomedAt: "2026-07-24"
---

# DEE-435 — FHV T4 deterministic runtime and systemd deployment record

## Context

T4 operator packet audit identified two released gaps:

- `BLOCKED_T4_DETERMINISTIC_PAUSE_SURFACE_MISSING`
- `BLOCKED_T4_DEPLOYED_REVISION_CONTRACT_GAP`

## Goal

Deliver the minimum complete correction for a deterministic, truthful, executable T4 operator surface without connecting to the Execution Server or running T4 in this batch.

## Scope

| Surface | Binding |
|---------|---------|
| Rehearsal manifest | `--t4-deterministic-pause` sets `t4DeterministicPause=true` and `deterministicPauseAtCycle=40` |
| Pre-arm gate | `assertFhvT4PauseArmedBeforeCampaignStart` in campaign CLI before `runFhvRehearsalCampaign` |
| Observer runtime | Passes `targetSha` and `commandEnforcementEnabled` into observer state for T4 pre-arm validation |
| T4 operator CLI | `status`, `arm-pause`, `resume`, `verify` against localhost observer `127.0.0.1:9471` |
| Systemd deployment record | `.ops/fhv-systemd-deployed-revision.v1.json` (separate from legacy `.ops/deployed-revision.json`) |
| Legacy container preservation | `ai-trader-execution-host` / `waia-execution-host:bp6` recorded in systemd revision |

## Do NOT

- Connect to Execution Server
- Run T4 on host
- Release promotion or back-sync in this batch

## Acceptance criteria

- Campaign refuses start without armed deterministic pause when manifest has `t4DeterministicPause=true`
- Pause occurs exactly at cycle 40 when pre-armed
- RESUME completes with `fullHistoryRescanDelta === 0` and `REHEARSAL_OK` (validated in integration tests elsewhere)
- T4 operator CLI covers positive and negative paths
- FHV systemd deployed-revision record is atomic and truthful
- Full validation chain green

## Related documents

- [`docs/ops/FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md`](../ops/FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md)
- [`docs/ops/FHV-RELEASE-IDENTITY-CONTRACT.md`](../ops/FHV-RELEASE-IDENTITY-CONTRACT.md)
- [`docs/ai-trader/AI-TRADER-FHV-SYSTEMD-DEPLOYMENT-RECORD.md`](../ai-trader/AI-TRADER-FHV-SYSTEMD-DEPLOYMENT-RECORD.md)
