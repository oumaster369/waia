---
integrationIssue: DEE-1003
integrationTitle: "Preserve DEE-991 checkpoint-audit WIP into canonical Git"
branch: dee-1003-checkpoint-audit-preservation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 4f41b4b93040317dc5cae6e1363fcc3797d070df
  lastValidationAt: "2026-09-13T08:33:00Z"
  blockedReason: null
  nextAction: "Open one PR to main; Human squash-merge. Parent DEE-991 remains In Progress."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Scope

User authorized next independent local work and parallel quality control on 2026-09-12.
Base: 6ab1b156a14fb883043f3c6c81c5365be858ffe2. One isolated worktree/issue.

Standalone local verifier for existing store artifacts only. No store factory, mkdir, new seal key, write, rename, builder, hydration of full corpus or external access. Authenticate bounded seal and raw manifest bytes before deserialization; verify evidence bytes without deserializing them; check private paths/owners/no symlinks, sizes, exact entry identity, manifest/chunk digests via bounded iteration. Never log key or raw data. Report integrity separately from unknown exact input/release reuse applicability. Do not claim a terminal result or recalculation avoidance from cache presence.

## Acceptance

Valid small package/evidence; tampered seals/payload/chunks; absent key; partial entries; symlinks/permissions; malformed/oversized metadata; unsupported format; callback/data leakage; no writes; no large memory hydration; immutable tree before/after.

## Exclusions

No push, merge, deployment, scientific computation or recovery on production. No
scientific-law changes, smoothing, release-cache relabeling, private exchange
credentials, capital or Human-gate bypass. Local tests are not production acceptance.
Exact publication approval remains separate. Preserve all unrelated work.

## Local implementation evidence

WP-1 standalone verifier implemented in scientific-checkpoint-audit-v1.ts.
31 new tests plus11 existing checkpoint-store regressions pass (42 total).
Focused ESLint passes; root review caused explicit VERIFIED_COMPLETED_ENTRIES naming
so partial artifacts cannot be mistaken for whole-run completeness. Root full tsc
found two typing errors; corrected locally before claiming publication readiness.
Final full tsc result is recorded in Linear, not inferred from Vitest transpilation.

No store factory/builders/hydration/writes in the verifier. It reads the existing
local seal key only when invoked; never exports/logs it. No production invocation.
Quiescent tree required; there is no filesystem snapshot/lock; reads may update atime.
Memory includes one bounded authenticated manifest and decoded inventory, not a
strict64-KiB total bound. Applicability/scientific validity/completeness NOT_ASSESSED.

WP-2 remains: trusted expected inventory and same-release/input applicability mapping,
operator audit runbook, final review/build/gates/CI and separately authorized execution
against production artifacts. No promise of recovered stage names or avoided reruns.

WP-2 progress (2026-09-12): explicit read-only CLI and operator runbook added.
CLI requires an exact directory and explicit quiescent-tree assertion (not a lock).
Exit 0 means completed-file integrity only; 2 means no completed entries; 1 refuses;
64 is invalid invocation. No scientific PASS/authority, writes or automatic recovery.
Six real subprocess CLI tests plus31 verifier tests PASS (37 total), focused ESLint
and full worktree typecheck PASS. CLI suppresses raw exceptions/paths/payloads.
Runbook: docs/ops/scientific-checkpoint-readonly-audit-v1.md.
Trusted expected-key inventory/applicability mapping, final build/review/publication
gates and production artifact audit remain incomplete. No production invocation.

Additional local verification 2026-09-12: independent read-only review found no
actionable P1/P2 within the bounded verifier/CLI scope. Standalone ESM bundle built
locally and the same six subprocess CLI cases also PASS against that actual artifact
using explicit WAIA_CHECKPOINT_AUDIT_TEST_BUNDLE. These are repeated acceptance cases,
not six additional unique tests. No transfer or production execution. Trusted expected
inventory/applicability and full publication gates remain unfinished.

## Separately authorized production diagnostic evidence

On2026-09-12 Human explicitly authorized delivery of the reviewed standalone utility
and read-only integrity verification of the existing store, without checkpoint changes,
key disclosure, application deployment or scientific rerun. This supersedes only the
earlier no-production-audit boundary for this exact diagnostic invocation.

Same bundle SHA2569998741dba3446305be75ec1b0f9bd9266efd8ce7e9e1208e8adfeea6e9cc698.
First SSH-only attempt lost its result: UNKNOWN, not PASS. Durable attempt02 completed
12:47:34Z, exit0 after8m56s:16945 completed entries,16940 evidence,5packages,
509661 chunks,33618366467 payload bytes,0partial directories. Existing seals and
completed bytes verified. Receipt SHA2567e80e6fb51a250d6c38ab1af2e6cc089694b017bc4497550dbe205d0d6e01869.
Read-only namespace, ownerUID100/GID101; private output outside checkpoints; no network.
Postflight root/key metadata and original container state unchanged. Diagnostic unit
stopped. Expected inventory/applicability/scientific validity remain unassessed;
this does not finish DEE991 or authorize a new computation/release. Runbook now requires
durable remote output and independently queryable exit status before a long audit.

## Original key identity follow-up — 2026-09-12

Local original-runtime key derivation and read-only expected-key seal lookup added.
41 new tests, plus31 verifier and6 CLI cases:78 PASS; focused ESLint and full
typecheck PASS. Independent bounded review raised four P2 edge cases (custom array
iteration, metadata getters, Buffer length shadowing, outer-list method injection);
all fixed with regression tests and re-reviewed with no remaining scoped P1/P2.
Existing application/store/scoring code unchanged. No new tool delivery or execution
against production checkpoints. Full publication gates and expected-input assembly
are not complete; this evidence does not mark WP-2 or DEE-991 Done.

Original image Node v22.23.2 confirmed from image metadata and an isolated
version-only execution of its Node binary. Auditor host v22.23.0 is not the original
runtime. Original launch bindings and qualification receipt digests read through an
allowlist; no credentials or personal fields exported.

Original file log records BTCUSDT:30 FORECAST_ANCHORS525547/525547 but truncates in
the third comparison at8000/10000. The same original container's last35 log lines
show all three comparison trials at10000/10000 and then non-finite differential;
container still exited1 at2026-09-12T04:43:00.377755027Z. File-log truncation must
not be used to contradict the more complete container result.

Inventory consistency hypothesis, NOT a verified key mapping:
ceil(525547/32)=16424 WF forecast batches;4*(4096/32)=512 KM batches;
4 whole KM replay entries; total16940 evidence entries, equal to the observed count.
Five packages are consistent with four reference packages plus the first selected
surface package. Counts alone cannot prove these identities, missing-stage coverage,
data provenance or reuse. Authenticate independent expected inputs before any reuse.

## Authenticated package-header discovery — 2026-09-12

Added allowlisted codec/v1 header projection, authenticated first-chunk inspection,
and explicit CLI --package-headers mode. No source/evidence payload reads, later
replica chunk reads, callbacks, writes, builders or full hydration. Existing
integrity/expected-key paths retain their separate limited claims.13 new tests:
total91 targeted cases PASS; focused lint/typecheck PASS; independent read-only
review found no P1/P2 in this bounded scope. Seven CLI cases also PASS against the
actual standalone bundle (repeated cases, not seven additional unique tests).

Bundle124787fb1457a056cf81ffdb03aebde17dc55b7838ff63a89778d2fb80a21275 delivered
separately under the existing DEE-991 diagnostic-delivery authorization. Original
approved integrity bundle9998741d... not overwritten. Initial command referenced
absent/usr/bin/node and was rejected before process/report creation. Actual path
/usr/local/bin/node verified, then one metadata scan completed13:27:43–13:27:48UTC,
exit0,stderr0bytes. PrivateNetwork, owner100:101, checkpoint path read-only,
MemoryMax768M/runtime300s; output outside checkpoints. Diagnostic unit stopped
after completion, confirmed not-found/MainPID0. Root/key metadata unchanged.

Report99d7883cfa44f57cc8f2d0dd4e9f4208cf85977df839135983790812019d85d0:
five headers on original90de233a, same qualified development digestafa2b5a...;
BTC/ETH horizons30/60, allK50/M80. SourceCount1578187 for30min,1578157 for60min.
Two BTC30 entries have identical generation/content/grid identities but different
cache keys. This confirms scientific-content identity of the two headers, not
their invocation roles or independent expected-input mapping. No deletion/relabel.
Whole-run qualification/actual offending differential remain unresolved.

## Authorized saved-score diagnostic — 2026-09-12, superseding unknown cause

Human explicitly authorized reading saved DEVELOPMENT/forecast payloads, applying
original scoring only, and recording internal hashes/metadata in WAIA DEE991/992.
Added bounded codec record decoder, authenticated canonical-source/evidence reader,
separate score CLI with original trial-ID/target-grid binding. No forecast builder,
bootstrap, qualification, checkpoint writes or automatic recovery. All14 library
files contributing bytes to bundle unchanged from original90de233a source.
102 targeted tests PASS; focusedlint/fulltypecheckPASS; actualbundle CLI valid/refusal
casesPASS. Independent review found sparse probability array P2; fixed/regression
through actualV8store, re-reviewed no remaining scopedP1/P2. No publication yet.

Bundleec0ac46322392b5e995b5b7fb70870eb45b5a1f9c461fe25f39d3e29c3a3726d delivered
as separate diagnostic, original artifacts retained. Single isolated owner100:101
pass completed13:50:38–13:51:54UTC/76s,exit0,stderr0. Networkdisabled,checkpointRO,
2GiBmemorylimit;peak460304384bytes. Source1578187/forecast525547;original3trialIDs
and targetgridMATCH. Rolling-w2000/v1 has7155 +Infinity differentials, baseline0 in
bucket0; challengerzeros0. Other4baselinecomparisons finite. No statistical PASS.
Receipt508aca24ba4bd7f80d84b832f55d5e3bf1ad493354af419cc576c4c6aef1769f.
Original failedcontainer andcheckpoint root/keymodificationmetadata unchanged.

DEE991commentdbc37390-5897-4909-a36f-168ea14bc6cc andDEE992comment
1d1db5d4-f648-4941-9c3c-90b5e71a45a3 successfully recorded with latest explicit
authorization. DEE992 descriptionnowreflectsobservedcause; scientificamendment
notratified. WP-2 exactexpectedinput/reuseapplicability andpublication remain open.


## Preservation into canonical Git — 2026-09-13 (DEE-1003)

This integration is byte-preservation of prior local-only DEE-991 WIP onto
canonical base 4ef038c6c0b1effa27e8cc23f024b9aaa2ffd650. It does not reopen
DEE-991 WP-2 (trusted expected inventory / applicability mapping). Parent
DEE-991 remains In Progress. The stale local branch dee-991-checkpoint-audit
is not published.

Previously undocumented late additions after the plan's last 16:57 evidence
entry:

- `verifyPreservedScientificPackageHydrationV1` in
  `scripts/trader/scientific-checkpoint-audit-v1.ts` (source mtime 2026-09-12 20:14)
- `tests/unit/scientific-package-readonly-hydration-v1.test.ts` (mtime 20:16)

These produced the four-package full-codec evidence recorded in Linear between
23:06 and 00:21 UTC. That evidence proves preserved-data integrity/readability,
not scientific admission.

Compatibility delta (test fixture only, Human-approved 2026-09-13):
`gaussian-pop-std/v1` → `gaussian-pop-std/v2` in
`tests/unit/scientific-checkpoint-audit-v1.test.ts` so the fixture matches
ratified DEE-992 `MANDATORY_BASELINE_IDS`. Production diagnostic logic is
unchanged. Literals `multiclass-log-score/v1` and
`terminal-multiclass-log-score/v1` remain the historically correct original
90de233a scoring contract.

Limitation (documented, not repaired): `evaluateMandatoryBaselineV1` on this
base calls `normalCdfCody715V2` (DEE-993). The preserved tool will not
reproduce byte-identical original 90de233a baseline probabilities when run against
this revision. Original receipts remain authoritative.

This batch: no scientific admission, no Forecast computation, no bootstrap
execution, no Execution Server interaction. executionSurfaces: [local].
