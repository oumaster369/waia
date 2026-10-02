---
integrationIssue: DEE-1222
integrationTitle: "AI-TRADER: select complete issued DEVELOPMENT trial families with immutable nonqualifying receipts"
parentIssue: DEE-1159
branch: dee-1222-complete-training-family
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: [WP-1-owner-and-receipt, WP-2-native-proof]
  remainingWorkPackages: [WP-3-actual-main-and-ci]
  nextAction: "Obtain final independent prepared-source review, then integrate onto actual main after DEE1212 and pass exact-head CI."
provenance:
  createdFrom: "Oct02 root source audit and Linear duplicate clearance; independent design review before code; prepared on DEE1212 56fa1436 pending mainline"
  supersedes: null
---

# DEE1222 — pre-implementation design, 2026-10-02

Parent1159; publication dependency1212. Linear contract created08:25:24Z before code. Duplicate clearance: all seven prior1159 children plus latest30 WAIA issues. No existing family selector. This is engineering selection under the already immutable spec objective, never qualification or capital permission.

## Closed owner
Add an explicit select-issued-training CLI mode and one server export accepting unknown strict {organizationId,attemptId,limits:{maxBars,maxBytes,maxTraceBytes}}. Capture before first await; same Org0,1..4096 bars and1..32MiB source budget as1212; aggregate trace budget1..32MiB. No caller scores/source/SQL/scorer/model/callback/runtime identity. Capture trusted runtime/DB URL once, one180s command-wide signal+monotonic deadline shared through execution/retries/confirmation, existing owned bounded pool.

Prefer keep the new selection owner adjacent to existing private heldExecutor/ownedSession/readInput/executeOrVerify in issued-training owner, or extract an internal shared verifier only without exposing a public authority port. Do not call runResearchIssuedTrainingDiagnosticPostgresV2 to read. The existing private executeOrVerify(...undefined,true) already refuses absent rows and never calls the stage kernel. Reuse that branch in the same held transaction for each declared trial.

## Preflight and consistency
One owned SERIALIZABLE transaction, max3 known40001 retries. Lock the V2 issued attempt; validate deterministic attempt ID, org, exact issued-source/spec/runtime/policy tuple before payload. Read all diagnostic metadata (indices, tuple, schema/digests, octet lengths) and require exactly indices0..N-1 with N equal immutable orderedTrials.length. Reject extra, legacy, missing, conflicting identities and aggregate trace byte overflow before price or trace materialization. A missing trial never triggers execution.

After metadata gates, sequentially verify all existing committed trials in the same snapshot using1212 actual source-row/input-use/current-ledger verification. Do not hold complete traces for all trials; reduce each to an ordered compact immutable trial summary. Recheck common source/spec/train/runtime/policy equality. Each iteration checks command deadline. Source reads may be sequentially repeated initially for correctness; bounded total family and bytes/deadline prevent unbounded work. Optimization must not weaken consistency or introduce cached authority.

## Metric authority and deterministic rule
Independent pre-code review identified a completeness prerequisite: every declared trial must be terminal-flat. Every scoped durable order must be in canonical TERMINAL_ORDER_STATES (FILLED/CANCELLED/REJECTED/EXPIRED/FAILED); all other states including RECONCILIATION_REQUIRED refuse. Every actual final frontier position must have quantity, gross basis and net basis equal to decimal zero; retained zero-quantity map entries are allowed. The trace must agree: empty openPositions/openOrderIds and netUnrealizedPnl equal to zero. A partially filled CANCELLED order with residual position refuses. Any unfinished trial refuses the entire family before comparison. Never force-close a position, switch to a NAV objective, or drop a trial to obtain a winner. This prevents realized-only ranking from hiding unrealized losses or pending fills without changing the frozen objective.
Current trace verifier checks canonical trace, identities, full ledger digest/counts/frontier and source, but it does not independently bind netRealizedPnl to current accounting. Before selection load that exact final durable accounting frontier via existing repository inside the same held transaction; recompute computeAccountingSemanticDigest and require equality to stored and trace finalAccountingDigestHex plus exact org/account/run/sequence. Require canonical fixed decimal netRealizedPnl and equality to trace.netRealizedPnl. This blocks a resealed trace metric without trusting its new hash. No JS floating-point comparison.

Apply only existing objective train-after-cost-realized-pnl: compareDecimal, strictly greater replaces incumbent, equality keeps earliest declared index. All-negative and zero-trade completed families still receive an engineering selected index, with scientificQualified:false/capitalEligible:false and no positive-edge claim. Never remove failed/missing trials, optimize on validation/blind or create a new profitability floor.

## Receipt and persistence
Dedicated unnumbered synthetic SQL draft. Append-only table keyed(org,attempt), FK exact issued attempt/source/spec tuple, strict schema/canonical-json/hash checks, deny browser/public and mutation/truncate triggers using existing draft pattern. No production journal.
Receipt has version, DEVELOPMENT_NONQUALIFYING_SELECTION_ONLY authority, false qualification/capital flags, PIT/source availability not established; org/attempt, registered spec/family digest and full declared family binding; source run/issuance/train partition; observed executable/runtime and effective policy/model identities; frozen objective/tie-break; ordered summaries for EVERY index with parameters, trace/stage/scope/ledger/frontier digests, canonical realized PnL and counts; selected index/parameters and digest. Do not copy full fills/decisions into receipt. Hash canonical bytes; exclude wall-clock from deterministic identity.
Replay re-verifies all current trial evidence and recomputes full receipt before returning existing result; byte mismatch refuses, no overwrite. One insert and any local owner work are in same txn; no modeled order writes anywhere in this owner.
Unknown COMMIT only after captured complete candidate may initiate fresh owned READ ONLY confirmation of exact persisted receipt AND complete source/family evidence. No candidate => refuse. Inconclusive=>COMMIT_UNCERTAIN/null. Confirmation never writes or executes trials. Known unique conflict only exact new receipt PK may fresh-read confirm after rollback; no blanket23505 handling/retry. Use same remaining command deadline.

## Acceptance
Unit strict request/canonical immutable receipt; negative/zero/precision/tie cases; missing/extra/reordered/mismatched trial summary rejection, no invented financial policy. Native uses actual source issuance and multiple actual1212 diagnostic runs, complete family vs absent trial, foreign org, current release mismatch, resealed metric, trace/ledger corruption, atomicity, distinct concurrent owners, lost-COMMIT confirmed and inconclusive, no later writes/reconnect after abort. Existing V1/V2 diagnostic proof must remain valid after verifier composition changes. Dedicated strict named-test/source-manifest CI proof and exact consumer inventories; no tests removed/weakened.
Local focused checks + lint/type/build/canon/graphs/proof guards; full unit only PR CI. Independent design then source review. No deployment or production DB, real market/C3/holdout, live action, new strategy/financial/scientific rule. Root owns critical implementation; Luna can own isolated fixtures and inventories once source shape is frozen.

## Verification record — 2026-10-02
The design was committed before implementation as a4a5e7a9. The initial native run retained seven passes and three fixture failures. Allowed fixed thresholds were restored and synthetic bar sequences corrected; no runtime or financial rule was weakened. The full corrected run passed ten of ten with zero skips, and the unchanged diagnostic call chain passed sixteen of sixteen on the modified owner. Both receipts capture 4,311 unchanged source pins. These are synthetic local checks, not CI or scientific qualification.

Independent review found the CI bootstrap's fresh-schema precondition inverted; repair and focused proof are required before readiness. Additional native assertions must demonstrate distinct realized economics, terminal orders with residual positions, and foreign-org/current-release/current-ledger refusals through this new owner. The canonical validator also rejected the nonstandard acceptance heading; only its heading was corrected, preserving the pre-code criteria. Exact main integration and published-head CI remain pending.

Those proof refinements are now implemented. The final isolated suite passes thirteen of thirteen, with zero skips and 4,311 unchanged source pins. The fresh-schema guard was repaired and checked against an actual fresh PostgreSQL16 database with the current 230-entry journal and all six drafts. An intermediate run correctly refused the source-writer role after the temporary bootstrap database added cross-database grants in the same disposable cluster; its failed receipt is retained. Removing only that temporary database restored the original restricted environment; neither code nor role checks changed for the successful rerun. Future concurrent bootstraps need separate clusters because this role intentionally rejects extra database grants.

Current targeted units pass105/105 across eight files, including15 proof-guard cases and27 graph assertions; lint has zero errors (331 existing warnings), typecheck/build and both graph validators pass. Canon validation passes after the heading-only fix. The new CI manifest pins150 paths, including the added accounting/order-state authority dependencies and new CLI test; existing jobs are unchanged. Prepared source remains based on DEE1212 56fa1436 until publication dependencies are mainline; final independent review, actual-main binding and all applicable published-head checks remain outstanding. All receipts are synthetic engineering evidence, not profitability, source/PIT qualification, capital eligibility or readiness for live operation.

## Resource-order correction admitted before code — 2026-10-02
Root and independent review identified that extracting schemaVersion with a PostgreSQL JSONB cast in the initial metadata query parses trace text before enforcing the aggregate trace-byte bound. Correct this with two phases in the same held snapshot: first only tuple/digest/index/octet-length metadata, then the existing exact roster and aggregate byte budget checks; only afterward parse and validate every declared trial's V2 schema before any source payload verification. Retain each trial's readCurrentTrace schema validation as defense. Never defer a later trial's schema rejection until after an earlier trial has read source payload.

Add native proof that an over-budget malformed trace refuses with TRACE_BYTE_LIMIT before any JSON parse, and that a later legacy-schema trace refuses the full family before even a deliberately too-small source-byte budget is evaluated. Preserve all thirteen existing cases, current financial/objective/authority rules and the shared deadline. Re-run affected native proofs and obtain independent delta review; the preceding prepared review is historical until this correction is accepted.
