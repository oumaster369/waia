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
  onMerge: keep-open-until-t4a-evidence
state:
  status: step26-corrective-pending-release
  repositoryImplementation: merged
  releaseToMain: v2026.07.31.3fa104c-released
  mainToDevBackSync: completed-v2026.07.31.3fa104c
  releasedPacketAudit: passed-v2026.07.31.3fa104c
  executionServerSurface: step26-failed-run-evidence-only
  t4Authorization: none
  t4AuthorizationMeaning: no-currently-reusable-authorization-after-failed-run-and-recovery
  t4aExecuted: false
  t4aExecutedMeaning: no-accepted-successful-t4a-execution
  t4aAttempted: true
  t4aAttemptRunId: fhv-t4a-20260731t144326z-1b0cf364-3fa104c
  t4aAttemptDeployAuthorizationIssued: true
  t4aAttemptLastSuccessfulStep: 25
  t4aAttemptOutcome: step26-failed-not-accepted
  t4bExecuted: false
  linearDee436: in-progress-keep-open
  lastReleasedSha: 3fa104c03e440a9ccf2949a1a571939eeb2d453f
  lastReleasedTag: v2026.07.31.3fa104c
  failedRunId: fhv-t4a-20260731t144326z-1b0cf364-3fa104c
  failedRunLastSuccessfulStep: 25
  failedRunStep22: PASS
  failedRunTerminalFailure: FHV_T4A_STEP_26_FAILED
  failedRunRootCause: zero-length-child-PATH-incompatible-with-shebang-env-bash
  recoveryId: fhv-t4a-recovery-20260731t150735z-20b85a28-3fa104c
  recoveryClassification: FHV_T4A_RESIDUAL_RECOVERY_OK
  correctiveBranch: dee-436-fhv-t4a-step26-restricted-path-repair
  blockedReason: "Step 26 corrective PR pending Human merge, release promotion, back-sync, fresh PRE_AUTH namespace, and fresh T4A execution with Human evidence acceptance."
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
| R02 | Fresh checkout and clean tree | rehearsal contract §3 | `scripts/ops/fhv-service-user-checkout.sh` + `fhv-service-user-install-deps.sh` | service-user checkout + frozen install + shell identity verifier | JSON + ownership checks | service-user owned checkout + node_modules | nonzero | host-runtime closure tests | operator clone / missing deps | checkout + install proof |
| R03 | Manifest identity | rehearsal launcher | `lib/trader/observability/fhv-rehearsal-launcher.ts` | `corepack pnpm@10 trader:fhv:rehearsal -- --target-sha … --run-id … --artifact-root "$FHV_ARTIFACT_ROOT" --t4-deterministic-pause --fixture HTR_WP03_BENCHMARK` | `fhv-rehearsal-cli-result/v1` JSON + runDir/manifestPath | runDir derived equals `$FHV_ARTIFACT_ROOT/RI-P7/fhv-ops-rehearsal/$FHV_RUN_ID` | nonzero | launcher + host-runtime closure tests | missing artifact-root | `fhv-rehearsal-manifest.v1.json` |
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
corepack pnpm@10 test --run tests/unit/fhv-t4-*.test.ts
corepack pnpm@10 test --run
corepack pnpm@10 build
```

## Bootstrap / privilege / pause closure (PR #424 corrective batch)

Closed on branch `dee-436-fhv-t4a-operator-closure`:

- One privilege model: POST root (`id -u` = 0) + `runuser` for FHV service user mutations
- PRE_AUTH SSH stdin streaming from `FHV_LOCAL_RELEASE_ROOT` (zero remote script staging)
- Host preflight v2: root-only, systemd PID 1, min free disk, embedded CLOCK_BOOTTIME sample
- Explicit `--node-bin` / `--git-bin` / `--python-bin` propagation through render/install/checkout
- Controlled `REHEARSAL_PAUSED` exit 0 without final runtime proof; `REHEARSAL_OK` requires final proof
- Completed campaign systemd semantics: inactive/success, ExecMainCode=1 (CLD_EXITED), retained timestamps
- Bounded `fhv-t4-campaign-wait-completed.sh` before identity capture
- Post-restart observer re-qualification: wait → identity → signed status → continuity-after
- Hermetic packet simulation tests (`fhv-t4-packet-simulation.test.ts`)

**Linear completion:** keep-open until corrected dev→main release, mandatory main→dev back-sync, independent audit of released Packet V5, Human AUTHORIZE-FHV-OPS-DEPLOY, and separately authorized T4A Execution Server evidence. Repository merge into `dev` does **not** imply Linear Done.

## Post-merge state (PR #424, 2026-07-26)

| Field | Value |
|-------|-------|
| Repository implementation | **merged** into `dev` |
| Release to `main` | **pending** |
| Main→dev back-sync | **pending** after release |
| Released Packet V5 audit | **pending** |
| Execution Server authorization | **not issued** |
| T4A | **not executed** |
| T4B | **not executed** / DEE-437 **Backlog** |
| Linear DEE-436 | **In Progress** / keep-open |
| PR | https://github.com/oumaster369/waia/pull/424 |
| Merged at | `2026-07-26T11:15:55Z` |
| Feature head | `ff25f962f8f61f5a05fc370ac0575dfc810227ad` |
| Published `dev` merge commit | `899868676e7cd1fc31898865fc5dcab7394e5daf` |
| Pre-merge `dev` | `a4f6e056599909875e4b1f5d3f4e83837a66e40f` |
| Current `main` | `d4c0cf8f6f338fb4efa66679d1137bf26aa1adbd` (pre-DEE-436 — not T4A target) |
| Expected merge strategy | squash |
| Actual merge strategy | merge commit |
| Human deviation | `ACK-DEE-436-MERGE-COMMIT-DEVIATION-AS-IMMUTABLE-HISTORY` |
| History posture | immutable; no revert, reset, or rewrite authorized |
| PR head CI | runs `30198806872`, `30198806862`, `30198806867` — **success** |
| Post-merge CI | run `30199806304` — **success** |
| Execution Server access | **none** in merge or reconciliation sessions |

Repository acceptance is complete: R01–R28 matrix, Packet V5, and closure verifiers are on `dev`. Issue completion remains blocked by corrected dev→main release, mandatory main→dev back-sync, independent audit of the exact released Packet V5 blob, Human `AUTHORIZE-FHV-OPS-DEPLOY`, and successful T4A Execution Server evidence. T4B remains separately governed under DEE-437 (Backlog).

## Step 26 forensic failure and corrective (2026-07-31)

| Field | Value |
|-------|-------|
| Last released SHA | `3fa104c03e440a9ccf2949a1a571939eeb2d453f` |
| Last released tag | `v2026.07.31.3fa104c` |
| Failed run ID | `fhv-t4a-20260731t144326z-1b0cf364-3fa104c` |
| PRE_AUTH | PASS |
| Steps 1–25 | PASS |
| Step 22 | PASS (`FHV_T4A_STEP_22_OK`) |
| Step 26 | FAIL (`FHV_T4A_STEP_26_FAILED`) |
| Terminal error | `/usr/bin/env: 'bash': No such file or directory` |
| Root cause | Identity shell readers invoked repository scripts with `PATH=""`, breaking `#!/usr/bin/env bash` interpreter resolution |
| Attempt facts | Human `AUTHORIZE-FHV-OPS-DEPLOY` was issued; T4A run executed; Steps 1–25 passed; Step 26 failed; T4A not completed or accepted; authorization not reusable after recovery |
| Field semantics | `t4Authorization:none` = no currently reusable authorization; `t4aExecuted:false` = no accepted successful T4A; `t4aAttempted:true` records the failed forensic run |
| Recovery ID | `fhv-t4a-recovery-20260731t150735z-20b85a28-3fa104c` |
| Recovery result | `FHV_T4A_RESIDUAL_RECOVERY_OK` |
| Final unit state | observer + campaign disabled/inactive/dead, `isFailed=false` |
| Corrective branch | `dee-436-fhv-t4a-step26-restricted-path-repair` |
| Required next lifecycle | corrective PR → Human merge to `dev` → release to `main` → back-sync → exact released Packet audit → fresh PRE_AUTH → fresh T4A run |

Historical failed-run and recovery evidence is immutable forensic-only. It must not be reused, repaired, or counted as T4A PASS.
