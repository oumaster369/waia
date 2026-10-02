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
  completedWorkPackages: []
  remainingWorkPackages: [WP-1-owner-and-receipt, WP-2-native-proof, WP-3-actual-main-and-ci]
  nextAction: "Implement the independently reviewed complete-family owner, preserving nonqualifying authority and exact terminal accounting checks."
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

## Required evidence
Unit strict request/canonical immutable receipt; negative/zero/precision/tie cases; missing/extra/reordered/mismatched trial summary rejection, no invented financial policy. Native uses actual source issuance and multiple actual1212 diagnostic runs, complete family vs absent trial, foreign org, current release mismatch, resealed metric, trace/ledger corruption, atomicity, distinct concurrent owners, lost-COMMIT confirmed and inconclusive, no later writes/reconnect after abort. Existing V1/V2 diagnostic proof must remain valid after verifier composition changes. Dedicated strict named-test/source-manifest CI proof and exact consumer inventories; no tests removed/weakened.
Local focused checks + lint/type/build/canon/graphs/proof guards; full unit only PR CI. Independent design then source review. No deployment or production DB, real market/C3/holdout, live action, new strategy/financial/scientific rule. Root owns critical implementation; Luna can own isolated fixtures and inventories once source shape is frozen.
