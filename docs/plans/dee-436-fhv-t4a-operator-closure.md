---
integrationIssue: DEE-436
integrationTitle: "AI-TRADER: Close complete Human-executable FHV T4A operator surface"
branch: dee-436-fhv-t4a-operator-closure
riskTier: T2
prPolicy: one-pr
executionSurfaces: [local, cursor-agent, github-actions]
requiredValidation: [lint, typecheck, unit, build, validate-pr-governance]
approvalGates: [integration-ready, human-merge]
parentIssue: DEE-416
blocks: [DEE-424]
related: [DEE-435, DEE-437]
bindings:
  t4aScope: host-runtime-rehearsal
  t4bScope: worker-dashboard-tunnel-qualification
  t4bIssue: DEE-437
  pauseCycle: 40
  maxRuntimeMs: 300000
  operatorCliPrefix: "[fhv-t4-operator]"
  closureCliPrefix: "[fhv-t4-closure]"
  packageScripts:
    - trader:fhv:t4:verify-paused
    - trader:fhv:t4:verify-final
    - trader:fhv:t4:verify-deployment
    - trader:fhv:t4:verify-rollback
    - trader:fhv:t4:verify-seal
    - trader:fhv:t4:seal-evidence
    - trader:fhv:t4:verify-ceremony
    - trader:fhv:t4:wait-paused
    - trader:fhv:t4:wait-final
    - trader:fhv:t4:build-evidence-inventory
    - trader:fhv:t4:capture-continuity-after
    - trader:fhv:t4:verify-continuity
  humanDecisionToken: AUTHORIZE-T4A-T4B-CONTRACT-SPLIT
  model: C
  gate8SatisfiedBy: T4A_ONLY
  t4bDisposition: BACKLOG
  packet: docs/ops/T4_OPERATOR_PACKET_V5.md
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementation-active
  executionServerSurface: none
  t4Authorization: none
  blockedReason: null
provenance:
  createdFrom: chat
  groomedAt: "2026-07-24"
---

# DEE-436 — Close complete Human-executable FHV T4A operator surface

## Contract split

| Gate | Meaning | Blocks Historical Dataset Qualification? |
|------|---------|------------------------------------------|
| **T4A** | Execution Server host runtime rehearsal (this issue) | Yes |
| **T4B** | Worker dashboard tunnel qualification (`DEE-437`) | No — separate subsequent gate |

T4B is not part of T4A success and is not implemented/deployed in this batch.

**Human architecture decision (Model C):** `AUTHORIZE-T4A-T4B-CONTRACT-SPLIT` · `gate8_satisfied_by=T4A_ONLY` · `dee437_disposition=BACKLOG` · issued 2026-07-24T17:47:25Z. Ceremony must emit `T4A_RESULT=PASS`, `GATE8_RESULT=PASS`, `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE` — never `T4_RESULT=PASS`.

## T4A_REQUIREMENT_TO_EXECUTABLE_SURFACE_MATRIX

Every row is CLOSED. Zero MISSING / UNKNOWN / PROSE_ONLY / HAND_WRITTEN_APPROXIMATION / HUMAN_SET_AFTER_PROOF rows.

| ID | Requirement | Source contract | Owning file | Human executable command | Output schema | Success | Failure exit | Positive test | Negative test | Evidence file |
|----|-------------|-----------------|-------------|--------------------------|---------------|---------|--------------|---------------|---------------|---------------|
| R01 | Release SHA and tag identity | FHV-RELEASE-IDENTITY-CONTRACT + checkout worktree | `scripts/ops/fhv-release-checkout-identity.sh` (+ `execution-server-preflight.sh` SHA guard; Markdown contract linter `validate-fhv-release-identity.sh` remains docs-only) | `scripts/ops/fhv-release-checkout-identity.sh --repo-path "$CHECKOUT_ROOT" --target-sha "$EXECUTION_SERVER_TARGET_SHA" --release-tag "$FHV_RELEASE_TAG"` then `execution-server-preflight.sh --repo-path "$CHECKOUT_ROOT" --target-sha "$SHA"`; POST_AUTH proof via `trader:fhv:t4:record-checkout-identity` | JSON + `classification=FHV_T4_CHECKOUT_IDENTITY_OK` / proof digest | HEAD+tag peel == target SHA, clean tracked tree | nonzero | `fhv-t4-release-checkout-identity` tests | wrong SHA / dirty tracked tree / tag peel mismatch | `control/fhv-t4-checkout-identity.v1.json` |
| R02 | Fresh checkout and clean tree | rehearsal contract §3 | `scripts/ops/execution-server-preflight.sh` | `execution-server-preflight.sh --repo-path "$CHECKOUT_ROOT" --target-sha "$SHA"` | text | clean + SHA match | nonzero | existing | dirty tree | preflight output |
| R03 | Manifest identity | rehearsal launcher | `lib/trader/observability/fhv-rehearsal-launcher.ts` | `corepack pnpm@10 trader:fhv:rehearsal -- --target-sha … --run-id … --t4-deterministic-pause --fixture HTR_WP03_BENCHMARK` | `fhv-rehearsal-launch/v1` + `[fhv-rehearsal] runDir=` | runDir derived equals `$FHV_ARTIFACT_ROOT/RI-P7/fhv-ops-rehearsal/$FHV_RUN_ID` | nonzero | launcher unit tests | wrong fixture | `fhv-rehearsal-manifest.v1.json` |
| R04 | Deterministic pause armed | DEE-435 | `fhv-t4-deterministic-pause.ts` | `corepack pnpm@10 trader:fhv:t4:arm-pause` then `trader:fhv:t4:verify` | `[fhv-t4-operator] status=executed` + armed record | exact prefix status + digest | nonzero | fhv-t4-operator-cli tests | missing arm | `control/fhv-t4-pause-armed.v1.json` |
| R05 | Command ledger PAUSE | operator command v1 | `fhv-command-ledger.ts` | released arm-pause path | JSONL `PAUSE_AT_CHECKPOINT` | exact commandId/idempotency | nonzero | closure paused verifier | mismatch | `control/command-ledger.jsonl` |
| R06 | Command result PAUSE | command-result v1 | `fhv-command-ledger.ts` | arm-pause | `fhv-command-result/v1` | status=executed + enforcementApplied=true | nonzero | closure paused verifier | status=failed | `control/command-results/<id>.json` |
| R07 | Pause cycle 40 | constants | `fhv-observability.constants.ts` | `corepack pnpm@10 trader:fhv:t4:verify-paused` | `FHV_T4_PAUSED_VERIFICATION_PASS` | actualPauseCycle=40 | 1 | closure paused positive | wrong cycle | terminal + progress |
| R08 | Partial checkpoint identity | resume identity | `replay-checkpoint.ts` | `trader:fhv:t4:verify-paused` | checkpoint fields | safeResume=39, codeSha exact | 1 | paused verifier | wrong SHA | `replay-checkpoint.json` |
| R09 | Partial evidence frontier | streaming evidence | run-chain + checkpoint | `trader:fhv:t4:verify-paused` | `STREAMING_EVIDENCE_SEALED_PARTIAL` | exact terminal | 1 | paused verifier | wrong terminal | run-chain segment |
| R10 | Quiescent economic frontier | economic frontier v1 | `fhv-rehearsal-economic-frontier.ts` | `trader:fhv:t4:verify-paused` | `QUIESCENT_NO_ECONOMIC_STATE` | all zeros/false | 1 | paused verifier | totalOrderCount>0 | checkpoint.rehearsalEconomicFrontierState |
| R11 | RESUME command and result | operator CLI | `fhv-t4-operator-cli.ts` | `corepack pnpm@10 trader:fhv:t4:resume` | `[fhv-t4-operator] status=executed` | executed + result proof | nonzero | operator CLI tests | rejected | ledger + command-results |
| R12 | Resumed start index | resume proof | `fhv-resume-runtime-proof.ts` | `trader:fhv:t4:verify-final` | resume proof schema | resumeCycleStartIndex=safeResume+1 | 1 | final verifier negatives | wrong index | `fhv-resume-runtime-proof.v1.json` |
| R13 | fullHistoryRescanDelta zero | resume proof | `fhv-resume-runtime-proof.ts` | `trader:fhv:t4:verify-final` | integer 0 | delta===0 | 1 | nonzero rescan negative | delta=1 | resume proof |
| R14 | Partial authoritative segment | run-chain | `fhv-canonical-run-chain.ts` | `trader:fhv:t4:verify-final` | segment role+terminal | partial authoritative + SEALED_PARTIAL | 1 | final verifier | broken link | run-chain manifest |
| R15 | Continuation authoritative segment | run-chain | `fhv-canonical-run-chain.ts` | `trader:fhv:t4:verify-final` | STREAMING_EVIDENCE_OK | continuation authoritative | 1 | final verifier | wrong terminal | run-chain manifest |
| R16 | Canonical chain complete | canonical validator | `fhv-canonical-run-chain.ts` | `trader:fhv:t4:verify-final` | `validateFhvCanonicalRunChainCompletion` | ok + counts | 1 | canonical unit tests | gap/duplicate | run-chain |
| R17 | Alert-policy digest match | alert policy v1 | status + manifest | `trader:fhv:t4:verify-paused` / `verify-final` | digests equal | status.alertPolicyDigest==manifest | 1 | paused verifier | mismatch | status + manifest |
| R18 | Installed systemd unit digests | systemd units | `fhv-t4-closure-verifiers.ts` | `trader:fhv:t4:verify-deployment` | `FHV_T4_DEPLOYMENT_VERIFICATION_PASS` | installed sha256==rendered==record | 1 | deployment unit test | tampered unit | unit files + record |
| R19 | Deployment record identity | systemd revision v1 | `fhv-systemd-deployed-revision.ts` | `trader:fhv:t4:verify-deployment` + `fhv-systemd-verify-deploy.sh` | exact schema fields | all identities exact | nonzero | deployment tests | wrong tag | `.ops/fhv-systemd-deployed-revision.v1.json` |
| R20 | Legacy container unchanged | deployment record | deployed-revision + host probe | `trader:fhv:t4:verify-deployment` / rollback | name/image/running | exact + running true | 1 | rollback tests | image mismatch | probe + record |
| R21 | Disconnect/reconnect continuity | rehearsal contract | `fhv-t4-continuity-capture.ts` (snapshot v3) | packet captures observer+campaign systemd identities + ceremony; SSH events narrative-only | digests equal + continuity-verification proof | machine-derived observer restart + campaign unchanged | 1 | continuity capture tests | digest change / same InvocationID / campaign restart | continuity JSON pair + `fhv-t4-continuity-verification-proof.v1.json` |
| R22 | Observer restart continuity | rehearsal contract | `fhv-t4-observer-systemd-identity.ts` | same | InvocationID/MainPID/activeEnter change; boot ID unchanged | 1 | continuity + identity asserts | unchanged InvocationID | continuity JSON |
| R23 | Total five-minute budget | host-monotonic CLOCK_BOOTTIME | `fhv-t4-campaign-runtime-start.v1.json` + `prepareT4DeterministicRuntimeDeadline` | `trader:fhv:t4:verify-final` | shared elapsed≤300000 on CLOCK_BOOTTIME; `Date.now`/startedAtUtc informational only | one host-monotonic window bound to boot ID | 1 | `fhv-t4-host-monotonic-campaign` tests | boot ID change / deleted start / 300001ms | campaign runtime start + proof |
| R24 | Rollback complete | rollback-units.sh | `scripts/ops/fhv-supervisor/rollback-units.sh` + verify-rollback | preview then `--confirm`; then `trader:fhv:t4:verify-rollback` | `FHV_T4_ROLLBACK_VERIFICATION_PASS` | inactive/not-found + files absent | 1 | rollback tests | residual process | host probe JSON |
| R25 | No residual process | rollback verifier | `fhv-t4-closure-verifiers.ts` | `trader:fhv:t4:verify-rollback` | process list empty | zero matches | 1 | residual negative | process present | host probe |
| R26 | Complete evidence bundle | packet V5 | `trader:fhv:t4:seal-evidence` | seal with mandatory evidence-list | seal inventory complete | every required path present | 1 | seal missing negative | missing file | evidence-list + seal |
| R27 | Sealed evidence root digest | evidence seal v1 | `fhv-t4-evidence-seal.ts` | `trader:fhv:t4:verify-seal` | `FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS` | inventory+aggregate+metadata+root | 1 | seal tamper tests | root tamper | `SEAL_ROOT.sha256` |
| R28 | Machine-derived final PASS | ceremony aggregator | `fhv-t4-closure-verifiers.ts` | `trader:fhv:t4:verify-ceremony` | `T4A_RESULT=PASS`, `GATE8_RESULT=PASS`, `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`, `CONTINUITY_RESULT=PASS` (no `T4_RESULT` / `DASHBOARD_RESULT`) | all proofs re-validated | 1 | ceremony + packet regression tests | any failure | ceremony stdout |

### Matrix closure counts

```
T4A_MATRIX_MISSING_ROWS=0
T4A_MATRIX_PROSE_ONLY_ROWS=0
T4A_MATRIX_HAND_WRITTEN_APPROXIMATION_ROWS=0
```

## Acceptance

- R01–R28 matrix rows CLOSED with zero MISSING / PROSE_ONLY / HAND_WRITTEN_APPROXIMATION rows
- Model C token recorded: `AUTHORIZE-T4A-T4B-CONTRACT-SPLIT` · `gate8_satisfied_by=T4A_ONLY`
- [`T4_OPERATOR_PACKET_V5.md`](../ops/T4_OPERATOR_PACKET_V5.md) published with T4A ceremony fields (`T4A_RESULT`, `GATE8_RESULT`, `T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE`)
- Continuity capture CLI + verifier wired (`trader:fhv:t4:capture-continuity-*`, `verify-continuity`)
- Campaign runtime proof wired to rehearsal campaign runner (shared 300s monotonic budget)
- Full validation chain green: lint, typecheck, unit, build, validate:canon

## Do NOT

- Connect to Execution Server
- Execute T4A/T4B
- Create Cloudflare Tunnel
- Access historical dataset / blind holdout
- Authorize live trading
- Include dashboard success in T4A ceremony

## Validation

```bash
git diff --check
corepack pnpm@10 validate:canon
corepack pnpm@10 lint
corepack pnpm@10 typecheck
corepack pnpm@10 test --run
corepack pnpm@10 build
```
