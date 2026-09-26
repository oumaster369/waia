---
integrationIssue: DEE-1121
integrationTitle: "Connect durable noncapital paper analysis from source"
parentIssue: DEE-639
branch: dee-1121-durable-noncapital-analysis
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres, build, validate-canon, validate-pr-governance]
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
  lastValidatedGitSha: 683eaa8a8133494af0a9c452303a3585b8691fe6
  lastValidationAt: "2026-09-26T16:16:44.149101+00:00"
  blockedReason: null
  nextAction: "Complete independent final review; hold publication while the admitted payment train reserves main, then verify the accepted-base delta and all current-head CI. Full P10 remains open."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1121 — Durable noncapital paper analysis

## Admission and exact design provenance

Root admitted this implementation under DEE-1121 after exact independent design
review. Base: `8f60cb297d1bf080b419f4a6724050e3e0a298e5`.
The verbatim design below has SHA256
`bfb9baf8f11e8beb457c8d0af2b0ef39bf6a5cc53b54d011533b49e848e42b6e`.
Its original draft/admission disclaimer and pending-review wording are retained
as historical text; the issue admission and completed independent design review
supersede those two status statements. This is not implementation acceptance.

## WP-1 — Recorded source and fixed analytical evaluation

Add the strict versioned session/input/result contracts, full mandatory-domain
normalization at a persisted analysis PIT, exact source outcome references and
the fixed current evaluator. Retain explicit missing positive authority. Capture
all effective inputs and refuse incompatible configuration.

## WP-2 — Protected publication, completion and actual CLI

Add only additive PostgreSQL session/packet/companion storage and its own guards.
Compose actual early CLI mode, source publication, pool-owned transactions,
existing org lease/key exclusion and internal evaluator. Atomically commit the
old terminal receipt plus new companion; resume saved inputs/results before
collection. Preserve the old API and receipt grammar.

## WP-3 — Process and integration acceptance

Prove the actual caller with inert recorded HTTP only, fresh synthetic native
PostgreSQL, faults/crashes/contention, restart, tenant/isolation/RLS/append-only
controls and unchanged companion suites. Preserve all fifteen incoming mandatory
native suites and add the new source-to-restart proof. Root owns shared CI/proof
registration, broad readiness and publication; independent review follows the
frozen implementation.

## Acceptance Criteria

All six acceptance groups in the exact contract below must be demonstrated by
executed tests without skips. Source bodies, exact heads and raw evidence are
recorded separately from claims of authority. No production/provider/host/C3,
financial or live action is part of validation. No qualification, empirical
profile, relevance, new financial/scientific rule or full P10 completion is
created. Missing gates remain missing.

## Validation status

The plan was committed first at `235d63636d6e982373ff4be7d3dff994cb26dd37`.
The implementation now adds the explicit actual CLI branch, persisted full mandatory
domain input, fixed ordinary evaluator, session/predecessor state, and atomic v2
terminal plus analysis companion. Migration0219 is additive; all fifteen incoming
mandatory native registrations remain unchanged pending root's additive registration.

Author validation is complete within this bounded local scope. The final native
run on clean `602d30c39307052f10a966e10a62a2abe4f74231` passed 323 tests
in 17 suites with zero skips: all fifteen incoming mandatory suites, the new
34-case recorded-analysis suite, and the existing canonical PIT lineage companion.
The existing fifteen-suite executed-proof guard passed. All220 migrations were
applied to a fresh isolated database; teardown found zero sessions, injected fault
triggers/functions or disabled new guards. Evidence is in audit
`evidence/dee-1121/combined-1790434381914.*`.

Final `110909b564e2f8ffe1058adf18dad2c0dfe3d45a` changes only a test helper's
TypeScript environment annotation after two typecheck diagnostics; emitted
JavaScript is identical to602, and all production/native-test bodies are unchanged.
No native run is relabeled as110909. Fresh 108 tests in eight focused unit files,
zero skips, ran on the exact working bytes subsequently committed as110909;
`author-units-post-type602-source.json` records the tested hashes. Final typecheck,
scoped ESLint on fifteen changed TypeScript files and diff checks passed. The old
`author-units-current` log is separate, not a claimed rerun on602. Earlier failures,
corrections and the disclosed overwrite of an intermediate95-test raw unit artifact
are recorded in `VALIDATION-HISTORY.md`; final native and regression RED artifacts
are intact. No production migration, provider request, host or capital action occurred.

The independent source/native review at602 found no bounded blocker; final
annotation/document delta review and root full readiness, additive CI registration,
accepted-base integration and exact-head CI/publication remain outstanding. This
plan does not claim those root checks have run or that P10 is complete.

Root source review identified that a post-acquisition singleton refusal could
construct the shared global client before rejecting it. The entry now checks the
existing per-request-client setting before runtime acquisition. Five actual
flag-value controls failed before this repair and pass after it; this is a client
ownership correction, not evidence of an observed open socket. Exported APIs keep
typed operational results; the executable exits nonzero on any non-COMPLETE status
so a stopped sequence range cannot look successful to shell automation.

Independent review clarified E2: every explicit completion/replay invocation now
runs the fixed internal evaluator from its exact saved packet and compares the
complete saved analytical output. A self-consistent seal alone is insufficient.
An incompatible output refuses replay without rewriting history or selecting a
new PIT/source/authority. The prior successful union proof remains separately
attributed; the final323-test union ran against this corrected implementation.

A second review regression used the existing trusted canonical writer to seed a
valid self-sealed Observation with the consumed normalized digest but a different
payload or ingest time. This is an adversarial trusted-writer setup, not an
observed ordinary CLI or production incident. New packet publication/replay now
compares AVAILABLE canonical payload, kind, subject, provider, event/availability/
ingestion and trust anchor/revision to its own prepared normalized input. The
existing writer, trust policy and honest unavailable outcomes remain unchanged.
Both new source-binding cases and the resealed-output case were native RED before
the repair, with all existing SQL protection triggers enabled.

The native crash protocol distinguishes failure before COMMIT from loss of the
client after COMMIT was submitted: the latter may leave neither completion row or
both rows. Recovery must resolve the exact durable result without duplicates.
It never promises rollback of a commit already accepted by PostgreSQL.

The conservative evaluator runtime-import inventory and call-path review are
recorded in the audit evidence. The fixed path pins ordinary MI configuration,
registry order, recorded PIT/state and deterministic IDs; rejects the FHV timeline
skip flag; supplies no telemetry sink, historical profile or admitted Forecast
input. Inert controls verify replay without ambient UUID or wall-clock use. The
inventory is not a claim that every imported historical or capital path executes.

Explicit limits: a source summary receipt is not proof of every retained bar or
new scientific qualification. Release metadata is not binary attestation. Source
collection may leave unreferenced rows before packet publication. Deferred fences
are transaction-time guards under ordinary deferred settings. Session collection
is bounded, with no new daemon/renewal policy; no full P10 or live readiness claim.
The exact GitHub native proof service uses waia_it/5432; tests admit it only with
CI/integration/CLI flags and loopback, while local tests admit only the disposable
waia_dee1121 database namespace with waia_validate/54329.
Targeted unit/scoped lint are author-owned; native PostgreSQL requires an explicit
exclusive resource grant. Root runs full readiness and exact-head CI.

## Verbatim frozen design contract

<!-- BEGIN FROZEN CONTRACT bfb9baf8 -->
# Proposed implementation contract — ordinary durable noncapital paper analysis

Design freeze candidate for root/research_binding review, 2026-09-26. Source base `8f60cb297d1bf080b419f4a6724050e3e0a298e5`. Supersedes the unresolved E1/E2/E3 choices in `P10-SOURCE-FIRST-VERTICAL-COMPOSITION-8f60cb29.md` for this proposed slice only. No issue or code is authorized by this document; root admission remains required. New names below are proposed contracts, not claims that these types/tables already exist.

## One result and its limit

The existing paper CLI gains an explicit, bounded PostgreSQL **durable noncapital analysis** mode. It publishes an exact normalized mandatory-market packet, reloads it, runs the real existing analytical evaluator, and atomically records its analysis companion with the existing canonical NO_TRADE owner receipt. A fresh process resumes the same session/sequence from saved inputs before contacting a provider and produces/replays exactly one completion.

This is a vertical CLI→real source adapter→protected persistence→actual evaluator→lease owner→restart acceptance. It is not an unattached helper. It establishes reproducible observed analytics and the canonical prequalification terminal; it does not claim exact qualified Understanding, Forecast/Navigator admission, whole P10, continuous host qualification or capital authority. No provider is invoked during implementation acceptance: the actual public HTX adapter/gateway runs against an inert recorded transport in tests.

## E1 fixed — actual entry, normalized packet, time and source binding

### Entry and capabilities

Use `scripts/trader/paper-bar-close-loop.ts` with a new explicit mode, provisionally `--durable-noncapital`. Parse/select it **before** the old `DATABASE_URL` SQLite-only check, `getDb()`, risk-limit upsert, MockExchangeConnector, order repositories, reconciliation or risk/execution factories. Open the existing `getWaiaRuntimeDb` PostgreSQL runtime only; fail if it is not PostgreSQL; dispose the original runtime in finally. Do not use the legacy `runPaperCycleOnce` call graph in this mode because Guardian/order/account side effects precede its ordinary admission boundary.

The new branch constructs only the existing public-market `HtxBarPollSource`, source-publication repository, DB-clock lease owner and actual evaluator adapter. No connector credentials, order/cancel/sell/withdraw/transfer capability, capital callback, account risk writer or live-enable service is present. The old fixture/mock/historical paths keep their existing behavior and separate namespace. No production host/cron/flag is enabled by this package.

Required startup identity is captured before the first await: canonical lowercase UUID organization, exact nonempty account and analytical symbol, explicit session ID, nonnegative safe-integer startSequence, declared 40-hex release SHA and explicit immutable operating limits. Each invocation requests exactly startSequence through startSequence+maxCycles-1 (checked safe range); completed entries count as replayed acknowledgements, not new effects. A new session must start at sequence0; a later start requires its exact saved predecessor. Retrying the same invocation after commit replays the same requested range instead of silently choosing a new starting cycle. The fixed analysis interval is existing `1m`; accepted MTF lanes are exactly the existing `MTF_BAR_INTERVALS` list. Org/account fields are operator-selected scope, not a new proof of membership/account ownership. No venue account binding or live permission is inferred from this mode.

Session limits are explicit positive safe integers: max packet bytes, max bars per interval, max cycles and lease duration (within the existing lease API bound). They are recorded and never silently increased/defaulted on resume. These are admission/resource limits, not empirical sufficiency or trading thresholds. Existing gateway request sizes/timeouts remain unchanged. A result exceeding the selected limit is refused; no truncation or fabricated complete packet.

### Source capture and analysis time

Reuse `HtxBarPollSource.fetchMandatoryEvaluationBundle()`, which returns the full existing `GatewayPollResult`. No inquiry resolver, optional acquisition selection or optional-provider expansion is admitted. The underlying `pollEvaluationBundle()` without a selection already produces the mandatory HTX MTF/quote/depth/trades bundle. Do not use its narrower `fetchEvaluationBundle()` projection.

First look up the requested session/sequence under the captured scope. If a completed or pending published packet exists, reuse it before any provider call or new PIT timestamp. Only an unpublished next sequence may collect a new mandatory bundle. Capture its allowlisted parsed domain fields; this is not HTTP raw-byte retention. Headers, credentials, query strings, URLs, arbitrary exception text and arbitrary unknown payload keys are excluded.

After acquisition, obtain one timestamp from the existing PostgreSQL operational clock and persist it as `analysisPitAnchor` in the packet. This is a new observation-time analytic snapshot, not a replacement replay clock: once published, it never changes on retry or restart. Original captured event and ingestion fields are retained unchanged. Newly derived OHLCV summaries explicitly refer to the retained closed-bar subset and its actual last close; this is a distinct normalization, not a rewrite of the original summary. For consumed quote/depth/trade events and rebuilt retained OHLCV events, malformed/future chronology or an original ingestion time ahead of the anchor refuses the packet rather than rounding/backdating/clamping it into eligibility. Excluded open bars are recorded as exclusions; their future close does not pretend to be a consumed event.

`scheduledBarCloseTime` is the close time of the latest retained closed 1m bar; it is distinct from `analysisPitAnchor`. The old noncapital owner key remains that bar's close, with its original meaning. The companion clearly records both. Neither the companion nor the UI may claim the post-acquisition analytics were available at the earlier scheduled close.

For each MTF interval, validate exact symbol/interval, decimal OHLCV and ordered unique time identities. Retain bars with close time <= analysisPitAnchor and record the identities/digests of excluded not-yet-closed bars. Do not normalize open bars as closed. Preserve gap information; do not fill, interpolate or reindex gaps. If retained primary bars fail the existing minimum, refuse the packet. Empty non-primary lanes remain explicitly absent; they do not become SUFFICIENT.

Rebuild OHLCV summaries from the retained closed full bars using `normalizeOhlcvBarsObservation`, keeping original ingestion provenance and the correct retained last event time. Rebuild quote normalization from the exact quote and original provenance. For depth/trades, the gateway exposes normalized count/best/latest payloads, not full levels/trade arrays: retain those allowlisted payloads exactly and recompute only freshness/health/confidence/session metadata at analysisPitAnchor with the existing `scoreObservationReliabilityWithPolicy` and session classifier. Preserve UNAVAILABLE as UNAVAILABLE. Never fabricate missing arrays to call the full normalizers. Bind a new explicit normalization-contract version/digest to this transformation. No original summary receipt may be attached to changed normalized content.

Call the existing `fuseContextV1` with these validated rebuilt observations and analysisPitAnchor. It does not itself rescore observations; that work must already be complete. Reject unexpected optional lanes or malformed inputs before fusion instead of relying on its permissive filtering to hide them. Missing optional lanes remain omitted, not successful zero-valued observations.

### Exact publication

The immutable packet retains: session/sequence/scope; scheduled closed bar and analysis PIT; full retained MTF bars and exclusion manifest; exact quote and normalized observations actually used; rebuilt fused context; explicit normalization/evaluation contract and declared release metadata; exact prior completion/state digests; Source/trust/Observation receipt identities and status; and byte-exact canonical bodies/digests necessary to replay those joins. Fused context and summaries are independently recomputed at publication/readback, not accepted solely because the supplied hash matches.

Existing canonical PIT service/writers persist the exact rebuilt observations with `pitCutoffUtc=analysisPitAnchor`. They require the existing scoped Source/trust protocol; no source is automatically registered/trusted. A returned UNAVAILABLE/REJECTED source outcome is retained as such. Missing source/trust cannot produce an AVAILABLE canonical reference. Full retained bars remain recorded analytical inputs; the current summary's receipt does not become proof of every full-bar value or a new Measurement evaluator.

Source observations may be persisted idempotently before packet publication through the current public services; therefore a failure may leave unreferenced canonical source rows. The promised atomic boundary is the complete packet marker and later analytical completion, not rollback of all collector writes. Only after every expected candidate has an exact persisted outcome can one owner-fenced transaction insert the complete packet. No incomplete marker is consumer-visible, and no source failure/exception advances the processed prefix. A packet containing honest missing evidence can still be recorded and evaluated observationally, while its qualified prerequisites remain absent.

## E2 fixed — closed evaluator input and restart state

This mode has one fixed ordinary noncapital evaluation configuration: `miCoreEnabled: true`, `omitIntelligenceArtifacts: false`; no historical profile, no synthetic harness binding, no caller-supplied reconstruction, no runtime Intelligence/Knowledge authority, no PROFILE_RECEIPT, and no admitted Forecast runtime input. The existing evaluator therefore may produce observational legacy Understanding/reconstruction/MSV/hypotheses but must not produce an exact authoritative Understanding artifact or admitted Forecast. Never call a historical builder just to obtain its persistence envelope.

Use the current full `listMvpStrategyRegistry()` order and each exact strategy/version as recorded configuration. Revalidate that identity before first evaluation or unfinished-packet recovery; a mismatch refuses replay under changed semantics. Existing registry evaluation and confidence/formula/threshold code is unchanged. Signals are retained as observational results, never routed to a trading request.

A new session explicitly starts with `createEmptyHypothesisSessionState()`. Subsequent sequences take the exact prior companion's next session state and its digest. Empty state is never substituted after restart. The session stream is identified by org/account/symbol/1m/session/config digest; each packet pins expected previous completion digest and next sequence. The owner rechecks that predecessor under the org-wide lock on both packet publication and result commit, so two prepared inputs cannot fork a session.

Supply a deterministic artifact ID stream owned by this new recorded analysis namespace: each ID is derived from the exact packet digest, evaluator-contract digest, predecessor-state digest and monotonically increasing call ordinal. IDs are record-local opaque strings; they are not reused as venue/order IDs, historical IDs or qualification. Store and verify the output ID count/digest. This avoids the existing evaluator's random-ID fallback without altering scientific calculations or borrowing the numeric FHV namespace. An implementation must verify that every actual ID-consuming function accepts these ordinary string IDs before freezing its code.

Pass the saved analysisPitAnchor, copied bars/quote/fused inputs, fixed flags, saved prior state and explicit registry selection directly to `runEvaluationCycle`. No telemetry callback is injected into deterministic computation; emit a bounded summary only after durable publication. Recompute reconstruction through the current real function rather than allowing an unverified supplied body.

Reject `FHV_IDHPS_SKIP_REGIME_TIMELINE=1` before collecting or evaluating. `feature-engine-v0.ts::countBarGaps` reads that ambient flag directly, so pinning EvaluationCycleInput alone is insufficient. Freeze a reviewed transitive dependency/config inventory for the evaluator at implementation acceptance; any additional effective environment clock/random/config input found must be explicitly captured or refused, not silently ignored. This is a completion obligation for implementation validation, not an assertion that this design review audited every transitive function.

Persist the complete allowlisted analytical result and exact next HypothesisSessionState as an observational companion body. Include schema/version/content digest, recorded input digest and canonical noncapital completion reference. Recompute output on pending-packet recovery; compare immutable completed output on explicit verification. No latest source/Knowledge reads, provider calls, current Date.now substitution or hidden current registry fallback occurs during replay. Declared release SHA and configuration hashes remain metadata/integrity pins, not attestation of the executing binary.

## E3 fixed — companion, one owner, transactions, old records

Use a new additive normalized-input/session/analysis-companion schema. Existing v2 noncapital receipt grammar and table identities remain unchanged. Session header and complete packets/companions are append-only; no retroactive result enrichment. New tables must have exact tenant/FK/body-hash checks, authenticated/anon denial, mutation protection and their own owner commit-fence validation. Merely referencing a v2 row does not inherit its deferred fence.

The public composition loads the exact published packet and runs the fixed internal evaluator itself. Its input cannot contain analytical output, a resealed result or a caller-provided evaluator callback. Computation outside the final transaction is allowed only because the command retains its own immutable result locally; the private held writer receives that command-owned value. Digest binding alone never stands in for evidence that this evaluator ran.

A new public owning command accepts a genuine PostgreSQL pool (like the accepted feedback reader), captures scope/input before await and rejects reserved/transaction handles. Own `READ COMMITTED` before the first read; create only transaction-bound repository handles inside it. No hidden second pool. Keep any held-executor helper private within the owner implementation module; it is not a caller-supplied callback or optional validation hook. The existing public v2 command keeps its accepted semantics and is internally delegated to the same private held core where necessary; do not break previously accepted held-transaction callers of that old API.

Both packet publication and completion use `lockRuntimeOrganizationV2` with canonical captured org identity and `assertRuntimeDatabaseClockHolderV2`; check the holder after lock and before finishing durable effects. Lease scope stays org-wide. DB operational clock is never replaced by packet PIT. Retain default deferred commit fencing on the new tables; native tests must prove the transaction-time guard and accurately state its deferred-mode assumptions, not universal post-commit durability or external exactly-once execution.

Completion transaction order: org lock/holder → exact session/packet/prior completion read → verify packet/body/source references/config/output bindings → acquire/use the existing v2 natural key → insert existing v2 NO_TRADE receipt and new analysis companion → recheck holder → commit. The analysis and canonical terminal are separate explicitly identified results: post-acquisition observational analysis at analysisPitAnchor, and the existing restricted canonical terminal tied to the scheduled bar input. No positive canonical context is synthesized to make their times look identical.

At the shared v2 natural key:

- No v2 row or companion: insert both in one transaction, advancing the session's derived completed prefix exactly once.
- Matching existing complete packet+companion+v2 receipt: validate all recorded identities and return replay; do not re-poll or select a new PIT.
- Legacy v2-only row: return an explicit legacy-only conflict, with no companion insertion, session advancement or retrofit. Another preexisting caller can legitimately win this key; this is a truthful refusal, not a repairable missing analysis.
- Companion without its exact v2 receipt, wrong packet/config/predecessor or mismatching content: corruption/conflict refusal before any new effect; no latest fallback.

Unique constraints and protected links must prevent two companions for the same v2 key or session sequence. A separate process cannot create a parallel completion path. Reusing the same declared session with a different configuration/release refuses; new sessions do not override an occupied old v2 key. Independent account/session attempts still coordinate through the existing org lease/lock.

Packet publication is a preceding transaction; compute the real evaluator outside the final transaction, then verify its exact recorded input/config/predecessor before committing. Failed final writes roll back v2 receipt and companion together, leaving the immutable input available for retry. Crashes before input publication may recollect; crashes after publication must read that exact packet. The absence of a completion is not a successful cycle. Source collection leftovers are not counted as processed prefix.

## Fixed operating/error behavior

Use explicit bounded `maxCycles`; there is no new continuous daemon, automatic host deployment or lease-renewal policy in this slice. For each requested sequence, first replay its saved completed result or resume its published packet. Only a genuinely unpublished successor may poll. After a prior completion, wait for the next **strict** existing 1m bar-close cadence before a fresh acquisition (if exactly on a boundary, wait one full existing interval); cadence time is operational scheduling, never a replay PIT. The new packet scheduledBarCloseTime must strictly exceed its predecessor's. A repeated/regressing source bar returns a typed SOURCE_NOT_ADVANCED operational result and stops this bounded invocation without a new packet, companion or processed-prefix advancement. It does not loop until data looks favorable. Thus each requested missing sequence has at most one acquisition attempt per invocation, and maxCycles>1 does not immediately collide with the preceding v2 key. Claim/recheck with the existing DB-clock lease API; a busy/expired/lost lease stops this invocation with a typed operational result and no completed-cycle claim. Resume is a new invocation of the same session identity after valid owner acquisition. No command changes trading state.

Distinguish: completed/replayed analysis; recorded unavailable source status; invalid normalized input; legacy-only owner conflict; source/config/predecessor conflict; lease busy/lost; and infrastructure failure. Do not convert database/query errors to scientific unavailability or zero. Source operational failure before complete packet publication does not advance sequence. Keep payloads/credentials/SQL out of error text and progress logs. Exact result types/reason strings are mechanical local API details to finalize with tests, not new authority or policy vocabulary.

## Acceptance through the actual caller

Run the script's exported/invoked mode composition, with actual gateway and current evaluator, actual protected PostgreSQL writers and child-process recovery. The only inert replacement is bounded HTTP transport serving recorded public responses; no real network, host or trading action. Do not test only private helpers.

1. Two successive actual published/evaluated cycles using the real cadence/strict progression and a new-process restart of the exact requested sequence range: exact packet/prior-state/next-state/output/canonical terminal identities, zero capital dependencies constructed or called, full explicit missing authority retained.
2. Restart after complete input publication performs zero transport requests and zero PIT reselection; restart after completed result replays once. Kill/fail before publication, after input, after v2 insert, after companion insert, before final commit and after commit; no partial completion and retry remains valid.
3. Real Source/trust positive synthetic fixture and unavailable/inactive/unknown/cross-tenant controls; exact rebuilt normalized digest and consumed payload binding. Open MTF bars are excluded with manifest, closed bars unchanged, gaps retained, clock-skew/future/malformed input refused. Changed old summary receipts cannot satisfy rebuilt data.
4. Explicit registry/config/session/prior-state/ID determinism; incompatible FHV flag refusal; altered packet or configuration and modified caller object across await cannot affect the captured command. No synthetic historical authority or holdout path reachable.
5. Native two-process owner/key/session contention, loser semantics, stale/expired holder, read-committed postwait state, wrong tenant, exact append-only/RLS/body/FK checks and deferred fence. Preserve v2-only legacy replay through its old API, while new mode refuses retrofit. Ordinary historical/Forecast/ISG companions remain unchanged.
6. Exact CLI resource cleanup on success/failure; inspect import/construction boundary so branching after SQLite/mocks cannot falsely pass a "zero execution calls" assertion. No source capability exists on the replay-read path. Same-bar/regressing-source controls stop without advancing; caller-supplied output/evaluator hooks are not accepted by the public contract.

The slice passes only if the actual caller has this durable branch and all mandatory native/process cases execute without skips. A test-only new helper, hashes without input bodies, one successful fresh invocation or successful raw receipt is insufficient.

## Which choices are engineering and which remain outside

Engineering fixed here: explicit safe CLI mode, normalized domain retention, closed-bar filtering/PIT chronology, immutable session/config, deterministic operational IDs, versioned packet/companion, strict source joins, append-only isolation and owned transaction recovery. These implement the existing canonical source/PIT/reproducibility/no-bypass requirements without changing financial formulas or scientific confidence.

Not authorized or created: ordinary empirical profile requirements, new Measurement formula/source classification, question relevance mapping, a synthetic runtime hypothesis projector, a qualified package/qualification tuple, scientific/holdout/FHV evidence, Guardian continuous scheduling, source-storage retention policy for raw bytes, venue account binding, live enablement or C3 changes. Missing positive prerequisites remain missing. The prior detailed gap map remains the boundary for later P10 work.

## Evidence status

Source-first report and its immutable33-file manifest remain the discovery evidence. This contract also reads the existing actual paper CLI setup, HtxBarPollSource full-bundle seam, HypothesisSessionState, registry, freshness/fusion functions, noncapital owner/receipt, DB-clock fence and Feature Engine hidden FHV flag. Independent review is pending on this exact draft. No repository file, test, database, provider or shared checkpoint was changed; no execution count is claimed.

<!-- END FROZEN CONTRACT bfb9baf8 -->


## Root accepted-base integration and CI proof registration

Normal merge2698a856c3e1819d20cabb4d7865b6b729f35bbd integrates accepted21a60ec38573f0ca5c535992e9e09392c2aa78c9. The19 author paths and11 incoming authorization/numeric paths are disjoint and both complete binary patch directions are identical. Root additionally registers the new recorded-analysis native suite and its existing canonical PIT-lineage companion in the actual PostgreSQL authority job, mandatory no-skips result guard and all negative guard controls. All15 incoming suites remain mandatory, producing17 required suites on this base. Future accepted additions must be retained additively. This is executed-proof coverage only, not capital qualification.

Root current-base native/scoped/full readiness and final independent integration review are pending until their exact evidence is recorded; original author results retain their source attribution. Canonical PIT fixture cleanup temporarily disables append-only guards only for its existing disposable-fixture rows and restores them in finally; final native acceptance must confirm no disabled public user triggers or injected fault artifacts remain. No production schema application is implied by local migration acceptance.


Root first current-base readiness passed scoped tests, lint, typecheck, build, canon, governance and Execution graph, then the Reality graph correctly rejected its pinned inventory after the legacy CLI extraction. Independent immutable-Git/AST review proves exactly one consumer path swap (paper-bar-close-loop.ts → paper-bar-close-loop-legacy.ts), unchanged134 count, all133 common consumer contents identical and all26 connector references unchanged. The new file already matches the sole existing excluded script rule. Only the two reviewed consumer digests are updated; validator, rules, source discovery/admission, forbidden imports and compatibility counts are unchanged. The original failing log is retained. This is a checked inventory update, not a waived authority gate or new Reality source admission.


## WP-3 — root current-base and recorded-clock fixture acceptance

Accepted base21a60ec3 was normally merged with exact preservation of both source
patch directions. All15 incoming native suites remain required; recorded analysis
and canonical PIT lineage increase the mandatory proof to17. Legacy CLI extraction
changes one classified consumer path; actual AST reference discovery, all133 other
consumer blobs and26 connector references are unchanged. Inventory pins reflect
those exact source changes without widening rules.

A root native run on a4d27d96 passed319 of323 and refused four chronology paths.
The actual failing timestamps were not recorded; subsequent independent local
clock observations showed millisecond clock-domain offsets. The corrected fixture
executes the real gateway then waits only for the observed database clock to reach
the latest actual ingestion in the immutable bundle, with content hash checks and
a bounded timeout. Production chronology/source/PIT values are unchanged. Replay
asserts zero provider and clock-barrier calls. The original failed evidence remains.

Fresh e7f4bdbf acceptance passed34 affected cases and323 cases in17 suites. Final
readiness found a test-client statement_timeout typed as a string;11c83e5b uses
the driver's documented numeric milliseconds. Because that changes fixture JS,
root repeated the complete17-suite proof on a new database: **323 passed, zero
skipped**,220 migrations and zero remaining other sessions, faults or disabled
public guards. This final native evidence is attributed exactly to11c83e5b.

Root scoped acceptance passed229 assertions/18 files at62ae7bfc; full lint passed
there. Typecheck/build/canon/governance/both consumer graphs/final base diff passed
at11c83e5b. Earlier errors are retained. The intervening legacy-file correction
removes one duplicate EOF newline, emits identical JavaScript and updates only
the consumer content digest. Evidence is under the project audit directory
evidence/dee-1121/accepted-base-21a60ec3/, including final-readiness/,
typed-clock-native/ and eof-only-identity.json.

Final nonauthor review and exact-head PR CI remain mandatory. No production schema,
source qualification, assigned semantic profile, complete Understanding/Forecast,
C3, execution-host or live-capital action is accepted by these engineering results.

## WP-3 — accepted-base56ee65f0 source refresh

Normal merge `d4bdff0acdc7bcf6299b010887c4213abd9fc6eb` integrates accepted
`56ee65f00f3b19858d57ea8f3947d2867822e9ac` into the previously accepted local
`a1adde65fa97aa2b40c9f49ed883129101148bf6`. The only manual conflict was the
executed-proof unit's count:17 versus16 becomes18. Workflow and proof arrays are
the exact union of all16 incoming native suites plus recorded analysis and canonical
PIT lineage. Serial execution, the CLI flag and the separate incoming three-suite
canonical billing job/guard are preserved.

All22 original and30 incoming nonunion blobs are byte-identical to their respective
parents. Both nonunion binary patch directions are exact. No production, schema,
migration, fixture, source/PIT or chronology behavior changed in this refresh.
The frozen design text and the reviewed Reality consumer inventory are unchanged.

Fresh scoped validation at the exact merge head passed **183 assertions in13 files,
zero skipped**, scoped proof-script/unit lint and base diff checks. This includes
recorded analysis/CLI/clock/source companions, both proof guards, incoming billing
dependency units and both consumer-graph units. Raw conflicts, patch directions,
source identities and commands are in audit `evidence/dee-1121/accepted-base-56ee65f0/`.

No native database test, full lint/typecheck/build or provider/production/host action
was run for this source refresh. Prior323/17 native and full-readiness evidence stays
at its recorded source heads; it is not an18-suite proof on the new base. Fresh
native/current-head readiness, final independent review and PR CI remain pending.


## WP-3 — root current-base acceptance on 56ee65f0

At `683eaa8a8133494af0a9c452303a3585b8691fe6`, 2026-09-26T16:16:44.149101+00:00, root executed358 native assertions/18mandatory suites with zero skips on fresh isolated PostgreSQL16.14/all220migrations. All16 incoming capital suites plus recorded analysis and canonical PIT lineage ran; all teardown checks were zero. Root427 scoped assertions/29files and all9 repository readiness checks passed at the same source head. Exact command/source/result evidence is in audit evidence/dee-1121/accepted-base-56ee65f0. No production source or fixture implementation changed during this acceptance. This final plan-only commit records those actual results; prior failed chronology/timeout evidence remains historical and unaltered.

Independent current-base final review and exact-head CI remain mandatory, including the separate three canonical billing suites. Publication is briefly held while the newly admitted payment integration requires main56ee to remain fixed; further base changes require truthful re-evaluation, not a retroactive old-CI claim. FullP10, semantic/scientific qualification, production migration/host wiring and live activation remain open.
