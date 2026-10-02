---
integrationIssue: DEE-1205
integrationTitle: "AI-TRADER: serialize scheduled noncapital cycles with durable retry receipts"
parentIssue: DEE-639
branch: dee-1205-scheduled-noncapital-owner
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation, no-production-migration]
state:
  status: in-review
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  nextAction: "Complete independent review of the actual-main diff and require every applicable exact-head CI check before squash merge."
provenance:
  createdFrom: "Root and independent source review 2026-10-01; explicit autonomous engineering authorization"
  supersedes: null
---

# DEE-1205 — durable scheduled noncapital ownership

This plan preceded implementation. The original prepared dependency base was
`65f44002601c405032cc791490c851ea60d2db1f`: DEE-1202 on prepared PR732 plus
the source-equivalent DEE-1204 commit. That base is retained as proof provenance.
After both prerequisites merged, only this child's changes were replayed onto
actual main `895fab5e6cf06777d8727778928b6fca4fb7eb0d`. Functional native-proof
source bytes are unchanged; the earlier nine-case PostgreSQL receipt remains
source-bound evidence. Actual-main local readiness has passed; independent
review and every applicable exact-head GitHub check govern final admission.

## Scope and non-goals

Deliver the actual scheduled **NO_TRADE / noncapital** database phase with
transaction ownership, a durable receipt for each closed bar, exact retry and
truthful commit/rollback reporting. Keep the fixed unqualified Decision,
prequalification envelope and disabled legacy submission. Unexpected
actionability is a refusal; no configurable callback can substitute authority
or an effect-bearing pool port. No live connector, qualification, financial
policy, production migration or external venue fence is introduced.

The existing MockExchangeConnector uses seed prices, zero fees and initial
balances/positions. Its checkpoint cannot establish realistic Forward Paper.
Do not turn its checkpoint into market-economics evidence. Refuse unresolved
ordinary orders before reconciling them against fresh ephemeral mock state. In
this first owner slice, **any** existing row with both historical identifiers
null and mock/paper execution mode, including a terminal row or a malformed
venue pairing, refuses the cycle: a terminal fill can already have changed cash
or positions, and the fresh seed connector cannot reconstruct that economics.
The owner neither adopts nor mutates a foreign-venue row.
Historical and half-tagged rows are outside the ordinary domain and remain
untouched.
Qualified modeled execution and full recurring capital ownership remain
DEE-639/640 work after this bounded operational prerequisite.

## WP-1 — closed transaction owner and scheduled composition

- Capture and freeze the resolved config and full deployment release identity.
  Canonicalize the configured organization UUID before the first await so case
  variants cannot split the advisory lock, config digest or receipt identity.
  Poll a bounded immutable market bundle outside the root DB transaction using
  the existing permitted information path. The closed public GET poll has one
  45-second technical deadline over the full acquisition/retry chain; expiration
  aborts transport and cannot enter the database phase even if a provider later
  returns degraded evidence. A losing owner may have polled;
  it must have no database effects.
- Enter a real root Drizzle transaction. Use a fixed server-owned organization
  and scheduled-domain transaction advisory lock, never a caller-selected
  domain or a `holds()` check followed by a pooled write. This works with the
  repository's transaction pooler; do not depend on ReservedSql.begin.
- Revalidate closed-bar identity/content, the existing freshness law and exact
  org/account/config/release after ownership. Instance-local cycleId is not a
  durable bar key. The input projection excludes only instance-local cycle
  labels among consumed fields; bar/quote timestamps, fused knownAt and
  freshness evidence remain bound. A same-bar refetch with revised evidence
  may honestly refuse as a conflict rather than replay.
- Construct all DB ports on that same transaction, including risk-limit
  initialization, repositories, reconciliation, audit and kill projections.
  Preserve DEE-1202 fixed domains and both-null historical identity. No pool
  backed V2 admission/submit or optional callback/provider escapes this factory.
- Keep the actual bounded cycle path and current authority refusals. Preserve
  generic/historical callers. Buffer completion telemetry until confirmed
  root commit and discard it on rollback.

## WP-2 — append-only receipt and restart/uncertainty handling

Use a versioned append-only record with a unique organization/fixed-domain/
closed-bar identity. Bind account, exact semantic input/config/release digests,
outcome and database commit evidence. Exact retry returns the committed result
without repeating effects; same bar with different bound data refuses. Account
labels in one organization cannot bypass the organization/domain lock.

Persist the receipt atomically with the owned DB phase. Unknown commit is not
success: only a fresh exact receipt read can confirm it; otherwise return an
explicit uncertain outcome and do not blindly rerun. A process crash must not
leave a completed receipt without its DB effects or emit successful completion
before commit. The scheduled handler surfaces `COMMIT_UNCERTAIN` as a secret-free
operational error event without a duplicate cycle-complete event. Bound locks/
transactions with existing operational limits.

Any schema additions and strict execution-proof wiring are synthetic-only in
this issue. Keep canonical production migration journal unchanged; 0229 stays
prohibited and 0230 deferred. Missing production capability cannot silently
fall back to the old unfenced worker.

## WP-3 — actual boundary proof and review

Real synthetic PostgreSQL must exercise two independent pools, concurrency,
rollback, restart/exact retry, same-bar conflict, stale/invalid identities,
unknown commit and no completion before commit. Prove loser writes zero
limits/reconciliation/audit/receipt rows; different orgs proceed. Existing
ordinary unresolved orders refuse before false NOT_FOUND_AT_VENUE escalation;
historical and half-tagged rows remain untouched. Deliberate foreign pool-port
and actionability injection refuse. No callback-only mock is a native proof.

Run focused units, lint/typecheck/build, canon and both consumer graphs,
source-bound native proofs and independent adversarial review. Preserve exact
required/applicable CI checks on the final actual-main head. No redundant full
local unit suite; no evidence or test weakening.

The dedicated `dee1205-scheduled-noncapital-postgres` CI job uses only
`postgresql://waia_it:waia_it@127.0.0.1:5432/waia_dee1205` on a fresh
PostgreSQL 16 service. It applies the canonical journal, then the native test
applies this issue's unnumbered synthetic receipt DDL. A source manifest binds
the reviewed PR head, owner/repository/worker, native test, ACK-loss proxy,
draft DDL, plan, proof scripts and workflow bytes before execution. The result
guard requires the exact native file, all assertions passed and zero skips;
missing report, stale source or another database is a failed check.

## Completion limits

DEE-1202 and DEE-1204 must merge before publication. This child can close only
the scheduled NO_TRADE owner scope. Scientific qualification, realistic Forward
Paper, full Guardian/recovery, account/capital binding and operator activation
remain explicit dependencies and cannot be inferred from a committed receipt.
