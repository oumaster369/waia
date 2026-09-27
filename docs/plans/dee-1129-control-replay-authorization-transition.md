---
integrationIssue: DEE-1129
integrationTitle: "Retain Control Replay authorization transition and enforce launch resume linkage"
parentIssue: DEE-644
branch: dee-1129-control-replay-authorization-transition
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, process-integration, native-postgres-companion, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 0f0e4b9bb880ef43f4c53cee38fb80bfadd9dc84
  lastValidationAt: "2026-09-27T00:50:58.577130+00:00"
  blockedReason: null
  nextAction: "Obtain independent final inventory/metadata review and root publication preflight; fresh exact-head PR CI remains required. Local source, native and readiness evidence are complete with explicit executed-head attribution."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1129 — Control Replay authorization transition

## Admission and implementation barrier

[DEE-1129](https://linear.app/deepsense/issue/DEE-1129/ai-trader-retain-control-replay-authorization-transition-and-enforce) is admitted under DEE-644, backend/T3, on accepted `9a4d1a73fa421961058d3733e11ea47ec7d147ec`. The historical completed DEE1121 branch and its evidence are preserved; this is a new single-issue branch and plan. DEE1125 and all pending release work are separate.

Frozen proposal SHA256 `9ddada38f940c5058c0888155b45f1395768eef42bdbab1cd5075a3eacd855b6`, independent review SHA256 `56362152e7c396e9f44816fc256ebf993bc16544623782dec08b4b9a5d5a78b1`, and root admission below establish the exact scope. The four refinements supersede only corresponding original wording. This commit is **plan only**, before implementation; no executable test or readiness success is asserted. The eight necessary bounded-reader plumbing paths below remain a finite admission request until root explicitly accepts them. No code may start before that barrier is released.

## WP-1 — Native transition and actual bounded-read plumbing

Implement the admitted unchanged native consume transform plus retained exact Ai/Ac under the existing consume lock, fixed immutable pair/initialization protocol, same-descriptor metadata bound and native claim expectation. Preserve all native digest/identity and legacy omitted-profile semantics. First obtain explicit acceptance of the finite extra paths; do not hide unbounded repeated reads behind preflight or copy codecs into an alternative authority path.

## WP-2 — Public launch resume and actual CLI joins

Wire both public Control Replay entries and both real CLI first authorization reads. Preserve one-shot and Human issuance requirements; consume under the single lock before launch products, keep Ai for launch/claim/two-run identity, Ac for consumed admission, reject incomplete or history-less strict resume and preserve old artifacts. Add native read-only terminal linkage and full claim stability. No driver, qualification or campaign authority is added.

## WP-3 — Actual process compatibility and controlled acceptance

Prove all A1–A12 and four refinements with real native serializers/owners, bounded temporary metadata, actual child-process lock/CAS/publication boundaries and actual CLI launch/resume. Record invalid fixture/setup failures separately from genuine REDs. Run the existing restricted positive CLI PostgreSQL companion only under a separate root grant, with zero skips. Preserve legacy body equality and all native recovery/TEST_ONLY gates. Root coordinates full lint/typecheck/build, CI and publication after frozen independent review; no real campaign/host/provider/C3/live action occurs.

## Validation status and limits

Current local implementation and controlled proof are complete; the historical plan-first and initial scoped checkpoints below are retained as dated provenance. The final local acceptance section states exact executed heads and the remaining independent review/CI gates. No real authority issuance or campaign operation occurred. Initial WAL is fixed-path empty bytes, not a header or power-loss proof; transition lock ends before the driver and does not establish active-driver exclusion. PG/AD-6c composition and real campaign completion remain separate.

## Finite extra-scope request

# DEE1129 — finite bounded-read plumbing request

Status: plan-first request, **not additional executable-scope admission**. Base `9a4d1a73fa421961058d3733e11ea47ec7d147ec`. Original five production paths remain admitted; the eight additional paths below require the controller's explicit acceptance before any executable edit. No application tests, campaign, database, native companion or host was run for this map.

## Fixed internal profile and snapshot primitive

Use one internal optional literal `metadataReadProfile?: "CONTROL_REPLAY_TRANSITION_V1"`. Its sole defined cap is 1,048,576 bytes; no number, reader, validator, prevalidated receipt, authorization body or callback is accepted by public Control Replay launch/resume/CLI. Those owners supply the literal themselves on every listed metadata call. Omission preserves existing native/legacy behavior; an unsupported profile value refuses. This profile supplies a resource bound only, never authority or successful validation.

A new dependency-free I/O leaf opens once, reads file metadata from that same descriptor, refuses a non-regular/oversized selected file before file-sized allocation, and reads at most the cap plus a single-byte overflow probe through the same descriptor. Read loops handle partial reads. A concurrent growth/shrink or incomplete read refuses; pathname replacement cannot switch the opened snapshot. Parse JSON only after the bounded snapshot is complete. Return exact bytes/text for retained identity and existing native decoding. Close the descriptor on every exit. Do not claim protection against arbitrary malicious in-place filesystem races or universal campaign-input memory bounds. UTF-8 byte length, not JavaScript character length, owns the cap. The one-byte probe is finite overhead and is not accepted as payload. Existing native schema/body/digest validation remains authoritative.

Use the existing serialization and native digest algorithms on that bounded snapshot. The raw-byte SHA256 of Ai/Ac is separate from their native digests. Bound new history publication and strict-profile native metadata serialization before publication; no owner writes an unsupported oversized metadata artifact and calls it complete. A snapshot helper does not accept an alternative source pathname chosen by a transition sidecar.

## Original five production paths: exact scope

| Path under repository | Changes and callers |
|---|---|
| `lib/trader/observability/fhv-full-historical-auth.ts` | Retain the existing generic consumer and private unchanged consumed-body projection/server clock. Add the admitted history-owning consumer on the **same** `.consume.lock`; use strict bounded read and bounded CAS, not a second public consume invocation. Add optional fixed profile to `readFhvFullHistoricalAuthorizationReceipt(path, options?)` and `assertFhvFullHistoricalAuthorizationReceiptForLaunch(input, options?)`, preserving omitted default; private native decode shares existing digest/exception behavior. New consumer owns source read, Ai publication, native CAS, observed Ac read, Ac and pair publication. No public supplied Ai/Ac or held-lock bypass. |
| NEW `lib/trader/observability/fhv-control-replay-authorization-transition.ts` | Own fixed run lock and paths, strict pair/initialization reads, bounded native launch/campaign/claim/journal/T reads and all immutable joins; fixed cap on four sidecars. Select only current native T plus its completed native claim join. Return `checkpointEvidence: "NOT_ASSESSED"` with observed claim generation/frontier; do not assert a checkpoint path/content identity or open the bulk checkpoint-bundle reader. No helper calls terminal reconciliation or fabricates T. |
| `lib/trader/observability/fhv-control-replay-execution.ts` | Snapshot caller primitive fields before first await, preserve capability reference, enforce exact resolved run directory. Pass the fixed profile to launch validator, native launch/campaign writers/readers, prepare, recover and takeover. Replace both direct resume launch-receipt byte reads and direct auth reads with actual bounded snapshot calls. Strict transition admission precedes mutable recovery; Ai supplies launch/claim/result identity, Ac supplies consumed-state validation. Update existing `readFhvControlReplayLaunchAuthorizationDigest` to use the same bounded native authorization read. No unrelated result/freeze/checkout/volume payload cap. |
| `lib/trader/observability/fhv-authorization-claim.ts` | Existing locked takeover gains the admitted optional expected immutable identity, mandatory at new owner. Read and validate expectation inside `.claim.lock` before patch. Add optional fixed profile to native claim/T readers and claim writer; thread it through `claimFhvAuthorizationExclusive`, `beginFhvAuthorizationRunning`, `commitFhvAuthorizationEpoch` and the private transition/CAS. No change to legacy lease, state, generation, digest, recovery or finalization algorithms. Strict read-only terminal join compares **full** validated claim digest before/after. |
| `scripts/trader/fhv-control-replay-cli.ts` | Bound **both** initial authorization reads at current lines376/384, before either run's consume/initialization; preserve existing freeze/qualification first reads and their guards. Snapshot invocation fields before awaits. Public owners remain mandatory; retained Ai goes into two-run original-authorization fields. Existing malformed/oversized errors are typed failure output, with no new flag/capability or reader injection. |

## Eight extra production paths requested before code

| # | Exact additional path | Minimal signature/caller change and reason |
|---|---|---|
| E1 | NEW `lib/trader/backtest/streaming-evidence/bounded-metadata-read.ts` | Fixed profile/type/cap, bounded same-descriptor byte/text read and supported-size assertion only. Imported by native metadata readers and the atomic compare primitive; independent of authorization/transition modules, preventing import cycles. Omitted legacy reads remain in their existing owners. No external I/O callback or authority object. |
| E2 | `lib/trader/backtest/streaming-evidence/atomic-file-write.ts` | Add optional fixed `metadataReadProfile` to `writeFileAtomicCompareAndReplace(input)` only. Under it, bound expected/next UTF-8 sizes and replace line206's current-content `readFileSync` with the same-descriptor bounded leaf **before** comparison/temp creation. Preserve default read, comparison, error ordering where unchanged, temp/fsync/rename/parent-sync, lock and cleanup algorithms. This is necessary because a bounded initial auth/claim read does not bound the primitive's subsequent compare read. No change to generic exclusive publication or lock steal/release policy. |
| E3 | `lib/trader/observability/fhv-artifact-authority-chain.ts` | `assertFhvAuthorizationReceiptForExecution(input)` gets only the optional fixed profile field and passes it to its actual auth reader at208. All purpose/scope/dataset/freeze/one-shot/consumed checks and exceptions remain. No prevalidated-source argument; other artifact validators untouched. |
| E4 | `lib/trader/observability/fhv-full-historical-launch.ts` | Extend internal `validateFhvFullHistoricalLaunchInput(input, options?)` with fixed profile and forward it to the authority-chain auth read plus the **second** public launch/private resume auth assertion. Add fixed-profile options to `readFhvFullLaunchReceipt(path, options?)` and `writeFhvFullLaunchReceipt(input, options?)` for actual bounded read/serialization. Control Replay supplies these options; legacy public Full Historical callers retain default. No changes to qualification/freeze/checkout/host/holdout semantics, legacy launch/resume ordering or engine. |
| E5 | `lib/trader/observability/fhv-official-campaign-identity.ts` | Native `readFhvOfficialCampaignIdentity(runDir, options?)` uses bounded read only for fixed profile; optional matching strict writer serialization bound, passed from new owner. Preserve fixed native filename, projection/digest and collision behavior. This avoids copying the codec into a shadow validator. |
| E6 | `lib/trader/observability/fhv-launch-journal.ts` | `readFhvLaunchJournal(runRoot, options?)` gets actual bounded read; strict-profile initial writer enforces supported bytes before publication. The initial marker and existing recovery chain select profile; ordinary legacy journal advances retain current default. No journal frontier, schema, rebuild or advance algorithm change. |
| E7 | `lib/trader/observability/fhv-execution-checkpoint.ts` | Add optional fixed profile to `prepareFhvOfficialLaunchExecution(input)` and `recoverFhvExecutionWalForResume(runDir, options?)`. Forward through both existing claim reads217/245, native initial claim/write/claim/begin and journal write, recovery journal read1176, two-phase cleanup, and private `reconcileFhvJournalClaimCatchUp`→`commitFhvAuthorizationEpoch` read/CAS. This is call plumbing only: unchanged WAL traversal/truncation, checkpoint selection, cleanup, fence/generation, catch-up, clone/evidence algorithms and returned execution object. Profile is not propagated into the separate long-running driver discarded by this wrapper. |
| E8 | `lib/trader/observability/fhv-two-phase-recovery.ts` | `cleanupFhvTwoPhaseResumeState(runDir, options?)` forwards fixed profile only to journal read46 before any deletion/truncation. All recovery decisions, checkpoint reads and cleanup operations unchanged. Other callers retain default. |

Total proposed production inventory: **13 paths = original5 + extra8**. No dataset, freeze, qualification, checkout/host, campaign-result, checkpoint-bundle, WAL algorithm, economic driver, native receipt schema, database, migration, profile registry, authorization issuer or TEST_ONLY allowlist edit. Further path need stops for a concrete scope decision; no silent scope growth.

## Complete selected call chains

1. Actual CLI → bounded auth1 and auth2 → public launch/resume → fixed-profile full-launch validator → authority-chain bounded auth read → second launch/resume bounded binding read. Do not merely cap before the existing unbounded chain.
2. Fresh launch's run lock → history owner/native consume lock → bounded Ai → exclusive original → unchanged native transform → bounded atomic compare → observed bounded Ac → exclusive Ac/pair → consume release → native launch/campaign metadata → prepare: strict claim/write/locked reads/CAS + actual empty WAL + strict initial journal → bounded readback → initialized marker → run-lock release → unchanged driver.
3. Resume's run lock → strict pair/currentAc/launch/campaign/claim/journal/initialized history → recover: strict journal read before native WAL effects → expected-identity takeover: strict locked claim read/CAS → prepare: strict claim→two-phase strict journal before cleanup→catch-up strict claim/CAS→strict claim reread → immutable readback → run-lock release → unchanged driver. Native recovery may traverse the full WAL; lock is phase-limited, not duration-bounded.
4. Terminal observation → strict claim1 → strict current nativeT (if any) → strict claim2 → compare complete authorizationClaimDigest → classify exact native linkage or typed refusal. Checkpoint evidence is explicitly NOT_ASSESSED; observed native claim frontier is not a verified checkpoint, and no bundle is loaded in this read-only result. No reconciliation/write, and no inference of T from result labels.

All additional calls in chains2/3 are synchronous within the existing local ownership sequence; this does not turn read/compare/rename into a malicious-filesystem atomic CAS or prove active-driver exclusion. The documented valid owner protocol and existing fences remain distinct.

## Additional concrete tests for the plumbing

The chosen no-bundle terminal output is within the original conditional rule: a checkpoint reference must be validated if asserted; this output asserts none. Existing native prepare/recovery may still read checkpoint bundles under their unchanged contract. No1MiB claim is made for those bundle payloads.

Add two bounded unit surfaces, subject to this same finite request:
- NEW `tests/unit/fhv-control-replay-metadata-read.test.ts`: descriptor-based exact1MiB and plus-one, multi-byte UTF-8 and trailing whitespace, partial read, growth/truncation, nonregular file and cleanup; preserve legacy uncapped native-reader behavior when profile omitted, native parser/digest exceptions, and no arbitrary callback path.
- NEW `tests/unit/fhv-control-replay-native-read-plumbing.test.ts`: actual authority-chain and second launch/resume bindings, native launch/campaign/claim/journal/T readers, locked native claim/CAS and prepare/recover/two-phase/catch-up propagation. Include replacement between outer admission and nested auth validation, both resume launch-receipt byte reads, journal replacement before two-phase cleanup, and claim catch-up/locked takeover. Record underlying bounded read reachability with test-only filesystem instrumentation; no supplied success reader. Put oversize replacement at the *second* native read/CAS to prove a preflight alone cannot pass. Verify no CAS/temp/rename or recovery cleanup/truncation after the appropriate strict refusal. Legacy fixed-time generic consume body/bytes and native claim/journal compatibility controls remain.

Retain all original A1–A12 unit/process/CLI proof obligations, plus:
- both real CLI first authorization files: exact-limit proceeds to unchanged downstream authority boundary, plus-one refuses before either consumption/launch/claim/recovery;
- actual public launch/resume independent of CLI: cap enforced within validation, not only at the command;
- actual auth/claim CAS current file substituted/grown above cap after its first bounded read: typed refusal before replacement;
- full-claim-content change with same immutable tuple during T join refuses; stable full digest succeeds;
- initial WAL marker records fixed path+zero bytes, separate native journal/claim, not a header; later valid WAL advancement is not compared to initial empty content;
- process SIGKILL boundary evidence separately attributed from filesystem/power durability; no auto unlink/steal;
- unchanged legacy omitted-profile call chains, one-shot and restricted TEST_ONLY guards.

Reviewability: the maximum named implementation inventory is13 production paths +8 original/requested test/helper paths +1 plan. This modestly exceeds the ~20-file target because the resource bound must pass through existing native readers/CAS rather than shadow codecs or a partial first-read guard. All eight additions are mechanical I/O-profile plumbing in one connected transition command; there is no independent feature to split. Prefer no edits to existing companions unless new assertions are actually necessary; their execution is not a file change. Native algorithms and schemas stay unchanged.

No tests are executed at this planning barrier. The actual positive existing CLI PostgreSQL companion needs a separate grant. Scoped unit/process work starts only after the controller accepts this finite extra-path request and releases the code barrier.

## Root admission (verbatim)

Issue: DEE-1129
URL: https://linear.app/deepsense/issue/DEE-1129/ai-trader-retain-control-replay-authorization-transition-and-enforce

# Controller admission — Control Replay authorization transition

Admitted on accepted main 9a4d1a73fa421961058d3733e11ea47ec7d147ec, after independent design review 56362152e7c396e9f44816fc256ebf993bc16544623782dec08b4b9a5d5a78b1 and frozen proposal 9ddada38f940c5058c0888155b45f1395768eef42bdbab1cd5075a3eacd855b6. Root read both complete texts and the actual consume/takeover/resume/CLI first-read seams, verified27 artifacts and all20 pinned sources unchanged on this base. This issue owns one connected technical repair, not execution of parent644's real-data campaigns. Parent644 and its exact host/scientific preconditions remain open and unchanged.

The user delegated technical implementation, tests, independent audit and checked merge. Risk tier T3, execution label backend. No new financial or scientific meaning is selected. This issue is independent of pending1125 schema and of the unresolved PG/AD6c runtime composition; no migration allocated or required.

Explicit compatibility choices:
- Preserve old valid native receipt read compatibility; history-less consumed Control Replay cannot use the strict new resume path. Never reconstruct Ai from Ac or rewrite old two-run receipts.
- Preserve and refuse consumed-but-incomplete initialization and ambiguous native products; no automatic repair, reissue or history migration.
- Existing or abandoned locks produce typed refusal. No unlink/steal, timeout ownership inference or new lease policy.
- Observe actual native T only; no result-label synthesis, reconciliation write or campaign PASS by sidecar presence.

Required M01 refinements, binding over original proposal wording:
1. Apply1MiB before full materialization/JSON parse for exactly both current authorizations, four fixed history artifacts, native launch receipt, campaign identity, claim, launch journal and native terminal metadata. Include first CLI auth reads376/384 and actual public launch/resume. Use a same-open-file bounded read or equivalently truthful bound for the consumed snapshot. Exact-limit and plus-one CLI/service tests must prove no consume/recovery effects. Unrelated freeze/qualification/checkout/host/dataset/campaign/checkpoint payloads retain existing readers/gates and are outside this new cap. Scope is not universal hostile-filesystem protection.
2. Terminal join stability compares validated full authorizationClaimDigest before/after, including state/generation/frontier/terminal pointer. A same-Ai tuple with changed full digest is read-changed/refusal; unchanged full digest is the positive control.
3. Initial WAL identity is the actual fixed path and zero-length/empty bytes plus separate claim/journal identity, not a nonexistent native WAL header digest. Later advancing WAL must not match initial empty bytes. Prove process-crash behavior only; existing empty-file creation is not fsynced power-loss proof. Missing prerequisites after restart refuse.
4. Initialization lock is phase-limited and released before driver. Recovery may traverse existing WAL/catch-up; no fixed duration, bounded whole-campaign recovery or active-driver exclusion claim. Do not change takeover/lease/fencing semantics to manufacture those guarantees.

Implementation initially uses the five production paths and exact test/plan boundary in the frozen proposal. Before executable code, author must commit the actual canonical issue plan on accepted main, enumerate precise bounded-read call plumbing and ensure it can fulfill the required first-read bounds. If any additional production reader/validation path is necessary, present the exact minimal path/signature/caller diff for root admission before editing it; do not substitute a post-parse size check. No arbitrary reader injection, callback authority, source-body fabrication or TEST_ONLY bypass.

Reuse the completed clean DEE1121 checkout at /Users/legco/Projects/waia-wt/dee-1105-epistemic-input-binding, preserving original dee-1121-durable-noncapital-analysis branch and all retained evidence. Start a new issue-named branch from exact9a4d only after issue creation. Commit plan first, then root checks that finite plan/read-plumbing before code. No direct main/push/publication by author. Scoped unit/process work allowed only after that barrier; PG/heavy require a separate sole-resource grant. Fresh native positive existing CLI companion must run with its unchanged actual profile and0skips. Root owns final independent audit, rendered preflight, publication, all exact-head CI and checked merge.

Validation is frozen A1–A12 plus the four refinements, with actual public launch/resume, shared native consume races, recorded real process kill boundaries, native terminal joins, actual CLI entry, current capability refusal, legacy body equality and honest counts. Canonical lint/typecheck/build/governance/scoped verification and exact-head CI required. No remote host, real campaign, authority issuance, blind holdout, C3, provider/credential, production SQL or live trade action in this package.

The full original reviewed proposal below remains source-attributed; its proposal/status/controller-choice wording is superseded only by this admission and the refinements above. Its other scope, ordering, failure matrix and acceptance requirements remain binding engineering intent.


## Frozen proposal (verbatim)

# Control Replay: retain the actual authorization transition and enforce its joins

Status: **source-only implementation proposal; not admitted code and not executed proof**.

Source: accepted `9d2a97768d34738a412f6a02a6dd31b35fbe2ef6`. The repository used to read immutable Git objects is not an author checkout for this task. No repository, DB, campaign, host, authorization, credential, or qualification state was changed.

## 1. One bounded delivery

Proposed issue: **“Control Replay — retain issued/consumed authorization and enforce launch/resume claim linkage.”** Recommend a new executable child of **DEE-644**, related to **DEE-643** and historical **DEE-524**, with one backend owner. The controller determines the issue number, risk label, exact admission and checkout before implementation. Do not reopen the historical completed implementation or broaden DEE-643 into this repair.

The delivered behavior is concrete: the existing Control Replay CLI and its public launch/resume functions retain the original authorization before consuming it, retain the actual consumed receipt, create and check `claim(Ai)`, and refuse recovery from missing or conflicting transition evidence **before** WAL recovery or claim takeover. A reader reports a terminal link only from an actual native terminal artifact and its matching claim. Successful ordinary initialization and already initialized resume remain useful positive paths. This is not a permanently unavailable host-admission helper.

This selects only the architecture-independent part of prior recipe §9, SHA256 `ad9a242854c6cca5e93955baa61518126e6a75a64d158fd62c32ee57e62a5185`, supported by M01 review SHA256 `f6773c25194f99113e0654dd89b483fa61f78a0e59a6b8c3dd40e5a33749ac26`. It does **not** implement the conditional PG/file-checkpoint driver composition from that recipe. Its automatic recovery profile is deliberately finite: resume a fully initialized recorded run; refuse ambiguous or incomplete initialization. More ambitious recovery of an interrupted initializer is not silently included.

## 2. Dedupe and existing ownership

Read-only Linear observations are retained in `linear-dedupe-raw.json`; reduced counts and titles are in `linear-dedupe-summary.json`.

| Observation | Meaning for this proposal |
|---|---|
| DEE-643 and DEE-644 are Todo; each direct-child query returned zero children and `hasNextPage=false`. | No existing direct child was discovered to own this narrow repair. This is not a global absence claim. |
| Queries `authorization`, `claim`, `authorization transition`, `one-shot`, `consumeFhv` returned respectively 87, 77, 75, 73, 0 entries, each without a next page. Returned titles/statuses were inspected; search is broad and descriptions may be truncated. | No exact active repair was identified in these bounded results. Controller should recheck before creation because Linear can change. |
| DEE-524 Done: durable server-owned claims/finalization; parent DEE-518. | Existing lifecycle vocabulary and native writer behavior are inherited. Historical Done is not proof that the current Control Replay composition retains Ai. |
| DEE-529 Done: restricted TEST_ONLY Control Replay authority and parity. | Preserve that capability boundary; this proposal grants no new test or capital capability. |
| DEE-538 Done: historical two independent real-data replay gate. | Neither redo that campaign nor lend its old result to the repaired release. |

DEE-518 WP-FHV-SERVICE describes durable claims, durable finalization and bounded metadata (`docs/plans/dee-518-…md:1986–1998,2848–2870`). ADR-0025 AD-6a distinguishes software correctness from actual host qualification; AD-6c keeps verified journal/checkpoint/WAL authority. The new history is **not** a replacement recovery frontier, a host receipt, or a new Human authorization. Existing current release, qualification, freeze, purpose, one-shot and holdout checks stay in place.

## 3. Exact source observations and caller boundary

All line references below are to the pinned source. `caller-searches.json` records symbol and module-specifier searches, including imports/aliases/reexports that reference these modules. This is a bounded call inventory, not a proof about arbitrary computed imports.

| Actual entry/source | Observed behavior and required change |
|---|---|
| `scripts/trader/fhv-control-replay-cli.ts:336–545`, public `runFhvControlReplay`; package command `trader:fhv:control-replay`; direct main `:547–564` | Both runs select `executeFhvControlReplayLaunch` or `resumeFhvControlReplayLaunch`. The CLI reads the **current** authorization digest. On resume that is Ac. Keep Ac for consumed-state admission; get Ai from the retained transition for claim and existing `run*AuthorizationReceiptDigest` fields of the two-run receipt. |
| `fhv-control-replay-execution.ts:246–316` | Current launch validates, writes launch/campaign metadata, consumes authorization, ignores the returned Ac, then initializes a claim with the original input Ai. Retain the original bytes under the consume lock and make complete initialization explicit before driver entry. |
| `fhv-control-replay-execution.ts:318–413` | Current resume validates Ac, recovers WAL, takes over the claim, and passes Ac to the prepare function. Add mandatory exact transition/claim checks before these mutations; pass Ai to claim-linkage inputs. Keep Ac validation and unchanged consumed timestamp. |
| `fhv-control-replay-execution.ts:105,144` and result construction below `:212` | The current wrapper discards `launchExecution`; chronological/scientific results are separate. A result classification is not native T. No T may be synthesized from `FHV_CONTROL_REPLAY_CEREMONY_PASS`, a parity digest, or the CLI's PASS label. |
| `fhv-full-historical-auth.ts:221–277` | Existing consumer owns `.consume.lock`, reads Ai, creates Ac using a server timestamp and the existing native field projection, then atomically replaces the receipt. Ai's native digest and Ac's native digest differ. Extracting a private held-lock core is allowed; nesting a second call to the public lock owner is forbidden. |
| `fhv-authorization-claim.ts:87–119,215–250,293–310` | Claim stores its authorization input digest. Takeover currently validates state under `.claim.lock`, but has no expected immutable-identity comparison. A narrow expectation checked **inside** that locked transition is required for the Control Replay caller. |
| `fhv-execution-checkpoint.ts:189–308` | Existing claim path requires RUNNING but does not check the supplied authorization identity. New initialization writes ISSUED→CLAIMED→RUNNING **before** creating WAL and journal. Therefore RUNNING alone does not prove initialization finished. Do not change shared checkpoint algorithms in this slice. |
| `fhv-full-historical-launch.ts:898–932` | Launch receipt derives its directory from `artifactRoot/runId`, whereas the Control Replay service accepts optional `runDir`. The new owner must reject a different resolved `runDir` before effects; do not lock or record one directory while writing another. |
| `fhv-authorization-claim.ts:319–473` | Actual native T reader and writer exist. `reconcileFhvTerminalState` can write T or complete a claim; it is **not** a read-only history reader. The new reader does not invoke it. |

Legacy production consumer: `executeFhvFullHistoricalLaunch` at `fhv-full-historical-launch.ts:1103–1188` calls the shared generic consume function at `:1158`. Its resume remains at `:1190–1295`. Those functions reject CONTROL_REPLAY and remain outside the new mandatory retained-history profile. `scripts/trader/fhv-authorize-full-cli.ts` is the issuance owner, and `fhv-full-run-cli.ts` is the legacy launch caller; do not change either. Artifact-authority-chain readers and existing receipt codecs remain compatibility consumers. Direct generic-consume tests/helpers remain valid callers and retain their one-winner/reconsume behavior.

## 4. Native identities must remain distinct

| Name | Exact object and comparison |
|---|---|
| **Ai** | Exact originally observed V1 authorization bytes, native `computePayloadDigest` body digest; schema/purpose/run/org/operator/release/tag/qualification/dataset/manifest/freeze/oneExecution validated. `consumed === false`; do not reconstruct by deleting fields from Ac. |
| **Ac** | Exact bytes reread after the existing consumer actually writes its consumed V1 receipt, with `consumed === true` and its actual server `consumedAtUtc`. Validate native digest and the exact old consume transformation from saved Ai using this observed time. Do not guess or regenerate the time. |
| **claim(Ai)** | Native V2 claim uses `computeStableJsonDigest`; `authorizationReceiptDigest === Ai.authorizationReceiptDigest`, plus equal purpose/run/release/dataset/manifest/freeze and absence of the forbidden Control Replay parent receipt. Org/operator authority comes from Ai plus existing validated launch/freeze; the claim schema itself does not contain those fields. |
| **T** | Native V1 terminal at its existing fixed path; native stable-JSON digest; exact run and completed-claim pointer. Its presence does not follow from Ai, Ac, initialization, result label, or a receipt file count. |

File SHA256 values identify retained **bytes**. They are never substituted for native digests and are not authentication. These local artifacts depend on the existing trusted file owner and existing Human-issued authorization. No new caller-provided `authorized`, `qualified`, `passed`, receipt body, evaluator, or validator callback is accepted as authority.

## 5. Fixed retained artifacts and bounded API

Use one fixed directory under the already resolved run: `control/authorization-transition.v1/`. Do not add a caller-selected transition directory or a “latest receipt” search.

1. `issued.v1.json`: byte-for-byte original native Ai, published exclusively **before** changing the mutable authorization file.
2. `consumed.v1.json`: byte-for-byte observed native Ac, published exclusively after successful native CAS and readback.
3. `pair.v1.json`: new content-digested sidecar, published last for the pair. Binds schema/profile, exact run/purpose/org/operator/release/tag, qualification/dataset/manifest/freeze identities, fixed relative filenames, both native digests and both byte SHA256 values. No future T field is required or fabricated.
4. `initialized.v1.json`: new content-digested sidecar published exclusively only after actual `prepareFhvOfficialLaunchExecution` succeeds and the owner rereads the actual launch receipt, campaign identity, initial claim, WAL identity and launch journal. Contains their exact identities, the pair digest, original claim snapshot and initial frontier/generation. It records **completed initialization**, not the current recovery authority. Mutable journal/WAL/claim bytes need not equal their initial bytes after legitimate progress.

Each new sidecar uses an explicit schema/profile constant and the existing stable canonical digest utility with its own named digest field. Readers verify schema and every stored field; reject unknown profile, incomplete body, invalid native/sidecar digests, altered bytes, foreign scope, extra filename/path redirection and unsupported native receipt schema. A fixed 1 MiB per transition/native metadata file is a parser/materialization bound, not a financial threshold; a larger artifact is unsupported and cannot be partially read as valid. No run-directory scan or campaign-size-dependent history is introduced.

Suggested narrow APIs (names can be mechanically adjusted in the admitted plan):

- `consumeFhvControlReplayAuthorizationWithHistoryV1({ authorizationReceiptPath, artifactRoot, runId, expectedIssuedReceiptDigest, expectedIdentity })`: owns the existing consume lock; reads and validates current Ai itself; no supplied Ai/Ac body and no “lock already held” public switch. Lives with the existing auth consumer so its native transform is shared privately.
- `readFhvControlReplayAuthorizationTransitionV1({ artifactRoot, runId, authorizationReceiptPath, expectedIdentity })`: validates retained pair/current native receipt and returns separately typed Ai/Ac identities. It cannot issue or consume authorization.
- `assertFhvControlReplayInitializedTransitionV1(...)`: validates the pair, initialized snapshot, launch/campaign, and immutable current claim identity before recovery. Current frontier validity remains with existing native readers/recovery algorithms.
- `readFhvControlReplayTerminalLinkV1(...)`: read-only discriminated result, described below. It neither invokes terminal reconciliation nor writes/completes any claim.

Copy primitive request/identity fields before the first await. Freeze-owned receipt bodies are read/validated snapshots; subsequent caller mutation cannot switch paths/scope. Existing trusted TEST_ONLY capability is not cloned, widened, or newly accepted at a public CLI flag.

## 6. Lock and publication order

Single-host supported profile; use the existing local exclusive-file primitive. This does not claim distributed locking, malicious filesystem protection, or whole-campaign execution exclusion.

**Order:** fixed per-run `control/.authorization-initialization.lock` → existing `<authorizationReceiptPath>.consume.lock` → release consume lock after retained pair completion → existing per-claim `.claim.lock` through native helpers. Never acquire consume from inside a claim lock. Never wrap the public consumer in another consume lock. New run initialization ownership remains held through complete initialization-marker publication, and is released before the long-running driver begins. A resumed transition takes the same short run lock through its admission/recovery/takeover/prepare segment. Existing runtime lease/fence algorithms remain authoritative afterward; this proposal does not add a new lease duration, dead-process heuristic or parallel-run authorization.

Fresh launch selected order:

1. Snapshot input; enforce CONTROL_REPLAY and exact resolved run directory. Complete all existing read-only checkout/authorization/freeze/dataset/host/purpose validation, without relaxing bounded/unbounded distinctions.
2. Acquire run initialization lock. Reject existing conflicting launch/claim/initialization history. Recheck the exact native authorization identity while acquiring the existing consume lock.
3. Publish original Ai. Use the private unchanged native consume transformation and CAS exactly once. Reread Ac; validate the transformation and retain Ac, then pair sidecar. Release consume lock in `finally`.
4. Write existing launch receipt **with Ai**, existing campaign identity, and call existing prepare **with Ai**. Reread the actual native initialization products, then publish `initialized.v1.json`. This marker must not precede WAL/journal creation.
5. Release run lock; enter the unchanged driver. Driver refusal cannot be described as a rolled-back authorization: after step 3 the one-shot receipt stays consumed. No automatic reissuance or decrement occurs.

This deliberately moves consumption before launch metadata publication for the new Control Replay owner. A competing consumer can therefore prevent initialization before launch/claim effects. Storage failure after consumption is a documented consumed-but-incomplete state, not a multi-file transaction rollback.

For the generic legacy consumer, preserve its public signature, exact Ac field projection/serialization/timestamp source, same lock path, reconsume refusal and lock release. The new consume path and the old one must compete on the **same** lock, including when called from different processes. Do not expose the private held-lock core.

## 7. Resume, partial state and terminal meaning

### Resume of a completely initialized run

Run existing validation against the current **Ac** exactly as today. Under the run lock, require retained original Ai, observed Ac/pair and initialized marker, then compare current Ac to retained Ac including `consumedAtUtc`, native digest and bytes. Require existing launch receipt to reference Ai. Validate current claim's immutable identity against Ai and native snapshots. Only then run the existing WAL recovery, exact claim takeover and prepare operations. Pass **Ai** to claim-linkage inputs while keeping Ac for consumed-state validation. Never call consume on resume.

Add a narrow optional expected immutable-identity object to existing `takeoverFhvAuthorizationRunning`; enforce it in the existing locked transition before any patch/write. It is **mandatory at the new Control Replay call site**, absent at legacy callers. This preserves legacy lease semantics while ensuring a changed claim cannot be accepted by a state-only takeover. The new short run lock serializes cooperating Control Replay transition calls; it does not replace the existing execution fence or establish atomicity of arbitrary low-level writers.

For the Control Replay result's existing `evidenceChain.authorizationReceiptDigest` and the CLI two-run receipt's `runOneAuthorizationReceiptDigest` / `runTwoAuthorizationReceiptDigest`, use retained **Ai** consistently on launch and resume. Ac is an explicitly named separate transition value, never substituted in those original-authorization fields. Keep existing V1 receipt codecs and collision checks. A previously written receipt using Ac that conflicts with the corrected value is refused as an immutable conflict, not overwritten or silently migrated. No old artifact is rewritten.

### Explicit finite failure/retry matrix

| Durable observation | Automatic behavior |
|---|---|
| No retained Ai and no native consumption | Ordinary validated launch may start; no historical evidence is invented. |
| Ai retained; mutable receipt still identical Ai; no pair/launch/claim; prior owner released lock normally | Same exact launch may finish this consumption once. Exclusive retained Ai must match bytes; a different request refuses. |
| Existing native receipt is consumed but original Ai is absent | `ORIGINAL_AUTHORIZATION_UNAVAILABLE`; read-only old native receipt remains readable, but strict new Control Replay resume does not guess Ai from Ac. |
| CAS may have succeeded, but retained Ac/pair absent or incomplete | `AUTHORIZATION_TRANSITION_INCOMPLETE`; no reconsume, reissue, claim creation, driver call, or timestamp reconstruction. Preserve files for separately admitted recovery. |
| Complete pair, but no initialization marker; absent/ISSUED/CLAIMED/RUNNING claim or missing WAL/journal | `AUTHORIZATION_INITIALIZATION_INCOMPLETE` before cleanup/takeover/driver. RUNNING by itself is insufficient. No automatic creation or “repair” of these ambiguous products. |
| Complete initialization, current Ac and immutable claim identity valid | Existing exact resume/recovery path proceeds; no second consume. Existing native frontier refusal remains a refusal. |
| Any initialization/consume/claim lock already exists, including one left by a killed child | Typed `INITIALIZATION_OWNERSHIP_UNRESOLVED` or the corresponding typed native lock refusal. Do not unlink, steal after timeout, infer ownership from PID reuse, or fabricate a receipt. |
| Changed retained bytes/native current receipt/launch/claim identity or unsupported schema | Typed invalid-history/conflict refusal before mutable recovery effects. |

The selected automatic profile intentionally refuses incomplete initialization instead of implementing a new recovery architecture. It still repairs normal launch and fully initialized resume. A future operator-controlled quiescent recovery command would be a separate admission; no instruction here authorizes manually deleting locks or altering consumed receipts.

### Actual T after execution

The read-only terminal result is one of:

- `TERMINAL_NOT_AVAILABLE`: valid running history and no native T. This is not a failure of issued authorization and not a final success proof.
- `TERMINAL_PENDING_CLAIM_COMMIT`: valid native T exists but current native claim has not committed that terminal pointer. Reader does not complete the claim or authorize another execution.
- `TERMINAL_LINKED`: native T schema/digest/run valid, current COMPLETED claim has exact T pointer and immutable Ai linkage. Report the actual claim generation/frontier and existing checkpoint evidence available through native readers; never call an initial marker a current checkpoint. Where a checkpoint reference is asserted, validate its native bundle and exact referenced terminal snapshot rather than trusting a pathname.
- Typed invalid or missing-completion-evidence refusal for corrupt/foreign T, mismatched completed claim, unsupported claim state, or COMPLETED-with-missing-T. Do not call the mutating `reconcileFhvTerminalState` from this reader. A separately existing native reconstruction path is unchanged, but it is not run merely to make this read appear complete.

Read the claim before and after the terminal join; changed native claim identity during the read returns a retryable read-changed result, never a mixed snapshot success. This is bounded local consistency, not source authentication. Current Control Replay discards `launchExecution`; it may legitimately end with no native T. This repair makes that absence visible and does **not** cure PG/file-finalization composition or qualify a campaign. The CLI can include an additive per-run transition/terminal-status summary; existing economic/parity classification and authority gates remain unchanged. No terminal outcome is a prerequisite to issuance.

## 8. Exact implementation boundary

Five production paths, plus tests and the canonical issue plan:

| Path | Allowed delta |
|---|---|
| `lib/trader/observability/fhv-full-historical-auth.ts` | Private unchanged held-consume core; new mandatory retained Control Replay consume path and exact native pair validation. No issuance change. |
| NEW `lib/trader/observability/fhv-control-replay-authorization-transition.ts` | Fixed run lock, immutable pair/init readback, strict initialized-history and read-only terminal join. Keep native auth/pair primitives in the auth module to avoid a runtime import cycle. |
| `lib/trader/observability/fhv-control-replay-execution.ts` | Mandatory launch/resume wiring, exact run-directory rejection, correct Ai versus Ac parameters and actual post-call terminal observation. No new driver, host admission or economic algorithm. |
| `lib/trader/observability/fhv-authorization-claim.ts` | Only exact optional takeover expectation checked inside the existing locked transition; Control Replay supplies it. Native schema, general completion/reconstruction and lease semantics unchanged. |
| `scripts/trader/fhv-control-replay-cli.ts` | Both actual launch/resume runs use the retained identity; two-run receipt references Ai; additive typed transition failure/status output. No new capability/skip/repair/authorization flag. |
| NEW `tests/unit/fhv-control-replay-authorization-transition.test.ts` | Native artifact/identity/failure/terminal matrix; compare native legacy behavior. |
| NEW `tests/integration/fhv-control-replay-authorization-transition-process.test.ts` and NEW `tests/helpers/fhv-control-replay-authorization-transition-worker.ts` | Real forked process barriers, death, lock and actual CLI invocation tests on temporary files. |
| Existing `tests/unit/fhv-control-replay-cli.test.ts`, `fhv-auth-concurrent-consume.test.ts`, `fhv-terminal-reconcile-red.test.ts` | Focused added assertions where needed; preserve existing restricted positive caller and generic legacy companions. Do not weaken skip/profile guards or replace actual callers with synthetic success ports. |
| NEW `docs/plans/dee-<admitted-id>-control-replay-authorization-transition.md` | Commit admitted contract before code; record exact source/test/runtime identities and honest scope. |

No planned edit to `fhv-full-historical-launch.ts`, `fhv-execution-checkpoint.ts`, receipt codecs, atomic-file primitives, host qualification modules, scientific/chronological drivers, database schema or migrations, authority issuers, checkpoint budgets, profile registries, TEST_ONLY capability allowlists, CI weakening, C3 or financial gates. If actual implementation needs any of these, report the concrete reason and amend admission before expanding.

## 9. Required executable acceptance after admission

Nothing in this section was executed for this proposal. Capture meaningful baseline failures separately from invalid fixture/setup failures; use existing actual serializers, readers, consumer, claim and WAL/journal initialization. Do not prove the repair by inspecting an isolated new validator alone.

| ID | Actual proof required |
|---|---|
| A1 | Fixed native Ai consumed through new owner: exact original bytes retained before mutation, exact observed Ac retained, Ai≠Ac, unchanged immutable fields and actual consumedAt; actual claim points to Ai, initial WAL/journal exist before marker. Native digest and file-byte digests are checked in their respective domains. |
| A2 | Actual public launch then initialized resume: admission sees Ac; immutable launch, claim and two-run authorization references remain Ai; consume count remains one; consumedAt unchanged. Caller mutation during an await cannot change paths/scope. |
| A3 | Wrong org/operator/run/release/tag/purpose/freeze/dataset/manifest/qualification/oneExecution, wrong Ai, changed Ac, mismatched runDir and retained-body tampering refuse before launch/claim/recovery/driver effects. Cover valid native digests with wrong bound identities, not only corrupt JSON. |
| A4 | Saved Ai missing, incomplete Ac/pair, claim ISSUED/CLAIMED, RUNNING without WAL, RUNNING without journal or without marker, foreign native claim, and conflicting immutable marker each produce the exact documented refusal. Existing files stay unchanged by the refused resume. |
| A5 | Two actual child processes compete on the same run/auth; exactly one native consumption and one initialization. Also race the **legacy generic consumer** against the new consumer on the same authorization: same consume lock, one winner, no nested-lock deadlock. Different runs/authorizations are not globally serialized. |
| A6 | Actual child killed after acquiring run lock, after Ai publication, after native CAS, after Ac publication, after pair, after ISSUED/CLAIMED/RUNNING and before WAL/journal, and after complete marker. Distinguish killed-owner lock refusal from clean-exit partial-state refusal. The parent observes real file boundaries/barriers; no sleep-to-guess race, no fabricated phase-success callback. No automatic lock removal or reissue. |
| A7 | Claim replacement immediately before locked takeover is rejected by the exact expectation inside `.claim.lock`, without patching the foreign claim. Wrong generation/frontier evidence retains the native refusal. Concurrent cooperating transition entry proves exclusive initialization; do not claim this proves whole-driver single ownership. |
| A8 | Issued/consumed admission does not require T. Native T + completed matching claim produces TERMINAL_LINKED; absent T, foreign run, corrupt digest, claim pointer mismatch, RUNNING+T and COMPLETED-with-missing-T have the stated distinct outcomes. Reader performs no writes/reconciliation. A caller PASS string/parity receipt cannot substitute for T. Positive native T fixture is labeled protocol proof, not measured PG campaign completion. |
| A9 | Spawn the **real existing CLI file** with bounded temporary fixture inputs, and invoke its actual `--resume` path. Assert protocol artifacts and typed refusals from real entry wiring. Without a granted TEST_ONLY port, the CLI's unchanged downstream `TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED` refusal is expected: this is a successful transition-boundary test and a failed campaign, never CLI/campaign PASS. Do not add an environment bypass to make it succeed. |
| A10 | Run the existing authorized `fhv-control-replay-cli.test.ts` positive application caller with its existing restricted PostgreSQL test helper after a separate local/native grant. Preserve actual capability/profile assertions and exact skipped count. This complements, not replaces, the spawned CLI checks. |
| A11 | FULL_HISTORICAL generic consume output, concurrent one-winner behavior, one-shot literal/issuance gates, existing native terminal reconstruction, checkpoint resume and purpose separation remain unchanged. Prove before/after native body equality at fixed test time where refactoring the private transform; do not run an official holdout or real campaign. |
| A12 | Existing immutable old two-run receipt containing Ac conflicts with corrected Ai reference and is preserved; old native V1 readers still read valid files. History-less strict Control Replay resume explicitly refuses; no silent fallback/migration. |

Suggested scoped sequence: new unit/process tests; existing `fhv-auth-concurrent-consume`, `fhv-bootstrap-fault-injection-red`, `fhv-terminal-reconcile-red`, `fhv-wal-checkpoint-resume`, `fhv-official-path-blockers-red`, `fhv-public-ceremony-red` and the actual Control Replay CLI test. Confirm exact applicable suites and profile guards on the implementation base. The named rehearsal `fhv-terminal-precedence.test.ts` concerns a different campaign terminal surface; passing it cannot substitute for A8. Keep original native checkpoint tests only as inherited compatibility proof, not proof of the unresolved PG driver composition.

Process tests can use a **test-only worker/preload** to pause on real filesystem publication calls, with IPC barriers and explicit SIGKILL, without adding production fault flags or supplied success callbacks. After admission, validate the chosen interception mechanism observes actual completed write/fsync boundaries; a before-write pause must not be mislabeled durable publication. Linux native directory-durability behavior and local development behavior must be attributed separately. Inspect child exit/teardown and raw artifacts, not only parent assertions.

Controller schedules scoped lint/typecheck/build and authoritative PR CI after independent review. Any PostgreSQL native companion requires a separate explicit resource grant; source/fixture tests require no actual venue or host. No blanket full-unit rerun is prescribed, and no new CI count is claimed in this source-only proposal.

## 10. Completion statement and limits

The bounded software repair is complete only when actual public launch/resume/CLI wiring, exclusive native consumption, immutable retained Ai/Ac, claim(Ai), partial-state refusal, terminal observation and legacy compatibility are implemented and proved at an exact reviewed commit. A new helper passing alone does not finish it.

No new financial/scientific threshold, host budget, authorization issuer, live capability, allocation policy, qualification PASS or holdout decision is required to implement this slice. Root must explicitly admit the described compatibility behavior: history-less consumed Control Replay runs cannot use strict resume, and clean partial initialization is preserved/refused rather than guessed/repaired. These are reviewable software choices, not a request to run or authorize any campaign.

Remaining separate contracts: actual PG/AD-6c persistence/recovery composition; actual final-run extent/source capability; host measurements and FirstLive/audit producers; campaign-qualified T and actual two-run outcome. The new transition history neither chooses nor certifies them. Existing consumed evidence, failed runs and historical receipts stay intact.

## Finite scope admission and code release (supersedes earlier pending request)

# DEE1129 finite scope admission and code release

Root admits the exact bounded-read request `2ab583ad27f699bd9699dd4310ccc0f98315c7ab39a748f51f27456ad6a8228f` and independent plan review `84ca05b8b4edfa7fce60b0a115b1ffa097ed840e27db93200cc496254a9445a4` on actual one-file plan commit `d81eb64ba336e6566d8cdb21c3482456a5a542eb`, direct child of accepted `9a4d1a73fa421961058d3733e11ea47ec7d147ec`.

Root read the complete request, unique canonical plan sections and complete independent report, verified clean exact branch/ancestry/one-file delta and exact embedded root admission, original proposal and request. Original sources/proposal/review remain immutable. This releases only the admitted engineering work below; it is not implementation acceptance.

The allowed production boundary is exactly the original five plus E1–E8 in the request: one passive bounded-metadata-read leaf and seven existing native I/O/validation propagation paths. Two additional unit files are admitted exactly as named in the request. The original six test/helper surfaces remain as proposed; running other existing companions does not itself authorize edits. This is one connected caller repair. Preserve all native validation, purpose/source/qualification, receipt/digest, consumed transform/timestamp, recovery/journal/fencing, legacy omitted-profile behavior and existing capability boundaries.

The fixed internal profile is `CONTROL_REPLAY_TRANSITION_V1`, with1,048,576-byte metadata capacity and no public configurable limit, supplied reader/body/validation result or global mode. Mandatory public Control Replay owners select it. Cover both CLI first reads, nested auth validations, native byte comparisons, claim creation/locked transitions, journal cleanup/catch-up and the atomic compare reread. Serialization bounds apply before publication of selected generated metadata and sidecars. Unrelated payloads and checkpoint/WAL algorithms remain outside this profile.

Additional root/M01 clarification: open selected metadata in nonblocking read mode for this POSIX profile, or a demonstrated equivalent that cannot wait indefinitely opening a FIFO; use same-descriptor fstat, reject nonregular files and close on every exit. Include an actual FIFO/no-writer test proving prompt refusal/cleanup, with a bounded parent timeout so a regression cannot hang acceptance. Keep partial-read, byte-limit, growth/truncation and same-open-file tests. Do not claim hostile-filesystem or power-loss guarantees.

Terminal output explicitly uses `checkpointEvidence: NOT_ASSESSED`: native T ↔ current full validated claim digest ↔ Ai only, with observed claim frontier distinguished from checkpoint validation. No bundle identity assertion, bulk bundle read, reconciliation mutation or result-label synthesis in this reader. Initial empty WAL and phase-limited lock/process-crash limits remain exact.

Author must append this finite admission/FIFO clarification to the canonical plan and commit that metadata before the first executable edit. After that plan-only commit, the code barrier is RELEASED for WP1–WP3 within the exact named boundary and targeted unit/process tests on temporary synthetic inputs. No further permission handshake is needed for that sequence. Send the admission commit identity and then implementation progress. If a further source path is genuinely needed, describe the concrete reason before expanding.

No PG or heavy build grant is included. Existing positive CLI native companion and full readiness require root-scheduled isolated resources after source/scoped checks. No push/PR by author, remote host/provider/credential/production/C3 activity, real campaign, authorization issuance or real trade. Root owns independent final implementation review, actual rendered preflight, fresh exact-head CI and normal guarded integration. Parent644 and whole-plan qualification remain unfinished.

## Author scoped implementation checkpoint

WP1/WP2 are implemented on accepted `9a4d1a73fa421961058d3733e11ea47ec7d147ec`; WP3 remains incomplete until native positive CLI, full readiness and independent review. The implementation is confined to the admitted13 production files, six changed/new test/helper files and this plan. No migration, issuer, driver, scientific threshold, host/provider or real campaign was changed or run.

Executed author scoped acceptance before this commit: **112 assertions in10 actual test files,0 failures,0 skips**. This includes49 transition/adversarial cases, the byte-bound/FIFO and native-reader controls, real child-process/SIGKILL/actualCLI protocol cases, and unchanged generic-consume, terminal, Full Historical launch, bootstrap, two-phase and WAL/checkpoint companions. All fixtures are controlled local temporary data. Spawned CLI still fails its unchanged missing TEST_ONLY capability gate after native initialization; this is not campaign PASS. Scoped ESLint exits0 with16 warnings (12 inherited locations and four test-only discarded-digest bindings); diff-check passes. Actual legacy consumer loaded from immutable9a4d and the current generic consumer produce identical consumed bytes at fixed time; the new retained consumer is compared against that generic body in the scoped suite.

Evidence is external under `evidence/dee-1129/author`: `scoped-freeze.json/.log`, `scoped-freeze-eslint.log`, `scoped-tested-source.json`, and `legacy-baseline-comparison.json`. Tests ran on precommit executable bytes, pinned individually in the source manifest; they must not be represented as an execution of a later commit without exact byte comparison. No PostgreSQL, full typecheck/build/lint or new native-positive test has run. Existing restricted native CLI test now asserts Ai-linked two-run output, exact Ac preservation, resumed output equality and caller-input snapshot across its first await; these new positive assertions remain unexecuted pending the separate resource grant.

Retain raw initial failures: the six native-reader/CAS baseline cases are genuine product REDs. The initial process11PASS/1FAIL used an invalid CLI flag, corrected in the test. Adversarial24PASS/9FAIL and47PASS/2FAIL were incorrect expected refusal-code labels; actual sources already refused. Those are fixture expectation corrections, not additional repaired product defects. New frozen aggregate supersedes them only for current scoped acceptance; no raw evidence is overwritten.

Limits remain unchanged: phase-only run lock, no lock stealing, consumed-but-incomplete failure refusal, no power-loss proof, no active-driver exclusion, no fabricated terminal, checkpointEvidence NOT_ASSESSED, no PG/file-driver or scientific qualification closure.

## Accepted-base refresh authorized before integration

Root reports PR685 accepted after33 checks and actual main `59e41f0f3a7861e7ecb49e68e5c7a49e10423637`. Preserve this author snapshot, then merge that exact accepted commit normally (no rebase/force). Incoming24 paths are source-disjoint from this implementation. Verify both complete binary patch directions, every own/incoming blob, all221 SQL/journal identities and the existing21 capital plus3 billing/2 payment/4 observation suite registrations. No DEE1129 migration or CI-count change is authorized here. A new current-base native/full proof must retain the old scoped attribution; no inheritance is described as a rerun. Root owns publication and grants native/heavy resources separately after source freeze.

## Accepted generated inventory amendment — before pin edit

The following controller admission is embedded verbatim before the one-field inventory change. Production and test source remains `52597f1399d580ad7e4de0f9eedf4eaa1e7029b8`; the initial Reality graph refusal remains retained. This amendment records scope only, not a successful corrected check.

# DEE1129 generated Reality consumer content pin

2026-09-27 00:45:32 UTC. The unchanged required Reality graph rejected source52597 because two already-inventoried, already-reviewed consumers changed: lib/trader/observability/fhv-control-replay-execution.ts and scripts/trader/fhv-control-replay-cli.ts. Root independently recomputed the actual exported AST discovery:140 identical consumer paths, pathDigest efcb30555d0322f78322222bfa51ef424bf2d6ca0b426c476b0c3cc731519f7a,26 connector references; accepted base content734c564e66e884e8cd829d63ffcc40226b581c14d892b613cacc281a88c29931 becomes332107bb5fbe99700a970449ed56658ae0e36d03e8f1617db86968d9cabe20a2. Their existing EXCLUDED_OR_LINEAGE_ONLY and EXCLUDED_RESEARCH_OR_OPERATOR_SURFACE dispositions remain appropriate: this repairs local authorization transition evidence and adds no Reality ingress or external connector effect. Author independently verifies155 sources/path/content unchanged and exact26 reference closure. Root receipt: accepted-base-59e41f0f/root-reality-inventory-reconciliation.json. The initial graph failure is retained.

Admit ONE additional nonproduction path docs/ai-trader/reality-v2-source-consumer-inventory.json, changing ONLY consumerDiscovery.sortedContentDigestHex to the source-derived value above. No rule/disposition/root/method/import marker/validator/source pin/path count or financial authority change. Record this exact finite amendment in the canonical plan in a plan-only commit before updating the inventory field, then proceed without another handshake. Run the actual unchanged Reality graph and existing graph adversarial/unit guards plus diff check, preserving prior seven-step outcomes and raw failure. Reuse native25/3 and unchanged executable readiness with exact source comparison; no redundant full rebuild/native run for this metadata-only edit. Independent M01 must verify the exact final metadata diff/head; publication remains root-owned. No production, campaign, host or trading operation.

## Final local acceptance on accepted 59e41f0f

The clean implementation snapshot `9cd54cdb739b00c1a858bb0f5da5f71830131178` was normally merged with accepted `59e41f0f3a7861e7ecb49e68e5c7a49e10423637` as `52597f1399d580ad7e4de0f9eedf4eaa1e7029b8`. All20 original own paths and24 incoming paths were disjoint and preserved; both complete binary patch directions, all221 SQL/journal identities and all21 capital/3 billing/2 payment/4 observation registrations were verified. No migration or suite registration changed. Original raw failures and prior-base proof remain immutable.

At exact52597, typecheck, lint, build, canon, PR governance and Execution graph all exited0. The unchanged Reality graph initially refused its stale content pin; that original exit1/log/report is retained. Root and author separately computed the same140 consumer paths and26 connector references, with only the two already-classified Control Replay consumers changing bytes; all155 source paths/content and every disposition/rule remain unchanged. After plan-only admission `5a8a8f50`, inventory commit `0f0e4b9bb880ef43f4c53cee38fb80bfadd9dc84` changes only `consumerDiscovery.sortedContentDigestHex`. At that pin head, the actual Reality graph passes155/140/26, the unchanged adversarial graph suite passes **9 assertions/1 actual file/0 skips**, and diff-check passes. The final eight-step readiness receipt combines six source-identical successful52597 checks with these corrected graph/diff runs; it does not claim eight new executions. Production/test/validator/native bytes remain exactly52597.

Controlled actual native proof at52597 uses a **new initially-empty isolated PostgreSQL16.14 database** `waia_dee1121_dee1129_59e41_author`: **25 assertions/3 actual existing suites/0 skips** (`fhv-control-replay-cli`, `fhv-official-path-blockers-red`, `fhv-public-ceremony-red`). All221 applied SQL hashes/timestamps match actual SQL/journal identities. The positive existing TEST_ONLY application caller proves original Ai linkage for both runs, capture before the first await, exact consumed Ac preservation and immutable two-run output across initialized resume. Teardown reports0 other sessions,0 disabled user triggers and0 fault functions. No PostgreSQL17 or real campaign qualification is claimed. The PG grant is released.

Earlier scoped **112/10/0 skips** binds to exact preserved precommit executable bytes, not a fabricated later run; current-base incoming guard **59/3/0 skips** executed at52597. Original six native-reader/CAS baseline failures are genuine product REDs; bad initial CLI flag/refusal-code expectations remain separately labeled fixture errors. Legacy generic consumed bytes match the immutable9a4d implementation at fixed time. No full capital-union rerun was needed for the disjoint accepted-base change; exact-head authoritative CI remains required.

External evidence directory: `evidence/dee-1129/accepted-base-59e41f0f/`, including `source-preservation.json`, `migration-identities.json`, `proof-sets.json`, `author-native/acceptance.json`, `author-readiness.json` (retained initial refusal), `author-readiness-final.json`, `author-inventory-correction.json` and `author-final-source-carry.json`. The substantive independent review at52597 is `milestone-audits/M01/review-DEE1129-52597f13.md`, SHA256 `1a272d25df0c5ee15198c3d2be2d57e488ab5d57054297b0fffdad4e6494c4a1`; narrow final metadata review and root rendered publication preflight remain separate gates. This final canonical update changes only documentation, with no repeated executable/native test claim.

The implementation remains a transition repair: no automatic stale-lock stealing, incomplete-state repair, active-driver exclusion, power-loss proof, terminal synthesis, checkpoint validation, scientific qualification, production/host/provider/C3 operation or financial activation. Parent DEE644 and whole AI-TRADER completion remain open.
