---
integrationIssue: DEE-1212
integrationTitle: "AI-TRADER: execute issued-source DEVELOPMENT trials with immutable V2 diagnostic lineage"
parentIssue: DEE-1159
branch: dee-1212-issued-training-diagnostic
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: []
  remainingWorkPackages: [WP-1-owned-diagnostic, WP-2-explicit-cli, WP-3-native-fault-proof, WP-4-independent-review-and-ci]
  nextAction: "Implement the same-transaction V2 source diagnostic with source receipt and full ledger binding; preserve V1 behavior."
provenance:
  createdFrom: "Oct02 cumulative source audit; prepared dependencies DEE1211 4986eefb and DEE1207 b6c39819; actual-main rebind required before publication"
  supersedes: null
---

# DEE-1212 — issued-source DEVELOPMENT diagnostic composition

Design independently reviewed before implementation, 2026-10-02. Parent1159, dependencies1211/1207. Engineering implementation follows explicit user authorization; this plan never grants market payload or production authority. Existing qualified-source, empirical hypothesis, whole-family selection, full Guardian and scientific stages remain open.

## WP-1-owned-diagnostic — public boundary and ownership

New `runResearchIssuedTrainingDiagnosticPostgresV2(supplied: unknown)` accepts strictly `{organizationId, attemptId, trialIndex, limits:{maxBars,maxBytes}}`; Org0 only, trial0..31, bars1..4096, bytes<=32MiB. Request is parsed/copied before awaiting. No caller DB, bars, source receipt, executable, scorer, callback or model. Trusted host captures database URL and observed runtime once. A private max1 pool owns actual root driver BEGIN/COMMIT, SERIALIZABLE, finite lock/statement/connect/idle limits, at most3 retries of40001 only. Never manual reserved COMMIT recovery or ambient/global fallback DB.

Within that same transaction: read/lock exact V2 issued attempt, immutable source issuance and registered full-family spec; verify deterministic attempt ID, composite tuple, current deployment, exact declared trial and all supported policy BEFORE price/volume rows. Refuse V1-only/shadow identities. Recheck all1211 source rowset and source/window/volume binding using same snapshot, with bounds checked before materialization. Source/trial identities include issuance digest and distinct V2 ledger namespace. No fabricated V1 attempt or old diagnostic row.

Reuse existing modeled-stage engine. Supply a narrow internal structural source type shared with V1; this is not a public source/qualification port. A private transaction-bound Drizzle adapter may expose only methods required by the kernel; all SQL delegates to the owned raw transaction, never a pool. If driver codec binding is needed, use isolated options/proxy and explicit JSON encoding; never spread pool methods into the transaction. Native tests must prove callback failure rolls back all order/fill/frontier/result writes and nested operations remain on the same backend. Preserve V1 caller behavior and byte identities.

## Durable result and retry

Unnumbered test-only `trader_research_issued_training_diagnostics_v2`, PK(org,attempt,trial), immutable FK composite to V2 attempt/source/spec, unique distinct stage ID. Persist exact canonical trace/digest and current input-use receipt including source issuance. Existing V1 diagnostics and its V2 input-use schema remain historical, unmodified. New trace schema explicitly `waia.research.issued-training-diagnostic.v2`.

Under lock, existing result must pass full expected source/runtime/policy/input-use identity, all current orders/events/fills/economics/accounting-frontier digest, counts and final-frontier equality. Recompute only pure evaluator input-use on retry; no order effects. An absent result with any stage ledger refuses. New result and modeled effects commit atomically. Common read/digest/trace helpers may be extracted only if V1 semantics remain identical; no weaker duplicated verifier.

If COMMIT response is lost after candidate trace is constructed, close uncertain connection and open a NEW owned read-only snapshot. Verify the exact attempt/source/current rows/result and full ledger against candidate digest without replaying effects. Only confirmed exact persistence yields success. Unavailable/inconclusive confirmation returns COMMIT_UNCERTAIN with no diagnostic payload; later explicit retry can safely verify existing state. Errors before a candidate is constructed remain normal refusals. Never retry unknown transport faults as fresh execution. Concrete success/replay returns immutable trace, status COMMITTED/REPLAY, scientificallyQualified:false, capitalEligible:false, sourceAvailability:PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED. Guardian qualifications remain UNQUALIFIED.

## WP-2-explicit-cli — caller and limits

Add separate default-off `--run-issued-training=1` CLI route, no mode overlap with prepare-source or ordinary discovery. It accepts existing attempt+trial+explicit finite limits and Org0; authentication/CLI authorization before action. Database URL/release are host-owned. Does not generate/register a new spec, infer hypothesis, choose trial family, run validation/WF/blind, or activate scheduled/venue execution. Prints summary/digests and uncertainty, not market payload or connection secrets. Generic discovery stays truthful about missing composition.

## Acceptance

New synthetic native fixture composes actual1211 source issuance, actual experiment+V2 attempt registration and actual diagnostic. Required positive produces nonzero actual modeled decisions/fills and verifies nondefault parameters reach real evaluator. Required negatives: V1/shadow identity; changed spec/issuance/runtime/policy/trial before payload (spy/revoked price access acceptable); altered source rowset; same-count order/fill economics corruption; two connections; replay exact one ledger; callback rollback; real wire COMMIT acknowledgment loss; unavailable confirmation then later replay; request mutation after invocation; cross-org and overflow. V1 native suite remains in same CI roster. No real dataset, C3 or holdout.

Update input source manifests and path triggers, native named-case no-skip gate, relevant consumer inventories without weakening them. Targeted units/type/lint/build/canon/graphs, independent source/transaction review, full published-head CI. Root keeps publication serialized; prepared parent composition is not merged authority.

## Accepted preimplementation review constraints

The existing public V2 input loader opens its own pool and cannot be called inside this owner. Extract a same-transaction internal metadata reader; preserve old public API behavior. Only after policy/trial/runtime checks call same-tx row reader. Add an optional smaller/equal byte cap to sourceRowsV1 (default64MiB unchanged); new32MiB cap applies the entire observation+gap+training source snapshot and is checked from size metadata before SELECT materialization. maxBars limits the training slice; existing total-source10000 cap remains. Validate actual volume receipt/raw/base8-decimal semantics through existing shared validation, not outer digest alone. Reset candidate on each known40001 retry; unknown-commit verification performs no execution. V1 golden trace comparison and actual physical-backend/rollback proof are mandatory. Independent review: dee1212-preimplementation-independent-review.md.

## Concurrency correction admitted before code — 2026-10-02

Native regression exposed an existing SERIALIZABLE overlap: after waiting on an unchanged attempt row, the losing snapshot can still see no result and raise23505 on the deterministic accounting-frontier primary key instead of40001. Expanded V2 concurrency also failed. OriginalRED retained; no blanket23505 retry or weakened tests.

Only exact PostgreSQL23505/public.trader_accounting_frontier/trader_accounting_frontier_pkey after the owning transaction has rolled back can initiate a new READ ONLY confirmation. V2 reloads checked metadata/source/result/full ledger in its fresh owned snapshot; missing diagnostic refuses before payload. V1 reloads its established root preflight/source reader, then verifies a new read-only result/ledger snapshot without FOR UPDATE. Success requires all current immutable source/spec/runtime/input-use bindings, canonical trace and complete ledger to match. No result, orphan/poisoned ledger, different constraint or divergent bytes retain refusal. Never call the stage kernel on this recovery path. V1 canonical trace bytes remain unchanged. Unknown COMMIT recovery remains separate and additionally requires the captured candidate digest. Independent design: dee1212-frontier-conflict-readonly-recovery-review.md. Native exact-conflict injection with missing result and existing-ledger corruption must prove no re-execution.

## Replay-label integrity follow-up admitted before code (2026-10-02)

Independent review of the shared V1/V2 verifier found an existing V1 gap:
canonical resealing could alter seven visible trace lineage fields while the
input-use receipt and full current ledger stayed unchanged. Extend only the
V1 existing-result branch with the same exact current-source comparisons
already required by V2: source run, experiment spec, train partition, modeled
execution model, requested executable, requested PIT digest and bar count.
Require COMMITTED_TRACE_LINEAGE_MISMATCH on a changed field; no new ledger
work and no changed bytes for a valid historical trace. Preserve a synthetic
PostgreSQL RED with deliberately resealed labels before implementation, then
run the affected full native set and independent review. This is engineering
trace integrity, not source/PIT/scientific or financial-policy qualification.
