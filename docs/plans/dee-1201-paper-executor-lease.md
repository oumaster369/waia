---
integrationIssue: DEE-1201
integrationTitle: "AI-TRADER: prevent duplicate or stranded paper executor leases"
parentIssue: DEE-1151
branch: dee-1201-paper-executor-lease
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: [WP-1-correction, WP-2-local-proof, WP-3-actual-main-caller-binding]
  remainingWorkPackages: [WP-4-publication-head-ci-and-independent-review]
  nextAction: "Publication-head CI and an independent exact-head review; this plan does not authorize merge."
provenance:
  createdFrom: "2026-10-01 cumulative AI-TRADER audit after Grok handoff"
  supersedes: null
---

# DEE-1201 — paper/mock executor lease identity and session correctness

## Context and scope

The exported helper currently has no non-test application caller. A bounded actual-module PostgreSQL reproduction nevertheless found three latent ownership defects: uppercase and lowercase spellings of the same organization UUID obtain separate account locks; a repeated claim on one session increments the reentrant PostgreSQL lock count and replaces its fence, leaving a lock that the old fence cannot release; rolling back a caller transaction removes session-GUC ownership while retaining its session advisory lock. This is not evidence of a production incident.

Preserve the paper/mock-only boundary and advisory-lock namespace. This correction does not wire a continuous host, issue live authority, change financial policy, apply a migration, or make a running cycle safe after its owner is lost. The future recurring owner must bind its effects to the current fence and reconstruct reality after failure.

## WP-1 — canonical identity and dedicated-session ownership

Validate the organization UUID and exact account key at every public lease boundary, canonicalize UUID spelling for lock identity, and validate nonblank holder identity. Require a reserved PostgreSQL session rather than an arbitrary pool. Use a module-private ownership registry keyed by the actual reserved handle, shared by all factory instances. Reserve PENDING synchronously before any await, and retain ACTIVE only after a confirmed grant. Before calling `pg_try_advisory_lock`, also refuse a backend that already holds an account-executor lock. A refused claim must not replace ownership or increment a reentrant count. Do not store ownership in transaction-rollback-sensitive session GUCs. Verify the current backend's actual lock in `holds`, and recheck captured ownership after awaiting SQL.

Release must match organization/account, fence and holder before changing a lock or its ownership record. An uncertain SQL result retains a TAINTED record and refuses further claims; the caller must close the backend rather than return it to a pool. A stale or wrong-holder release has no effect. Correct release makes the account available again; backend disconnection releases server locks. Returning a reservation to its pool is not backend disconnection: the owner must release its lease before returning the reservation, and must not reuse a released handle. This helper does not own or silently close the caller's pool.

## WP-2 — native proof and integration

Run the exact exported functions on a strictly identified disposable loopback PostgreSQL database, using only temporary session locks and transaction control and no application-table writes. Prove mixed-case concurrent claims have one winner; a second claim on the same occupied session, including another factory/account, refuses without altering the original fence; concurrent same-session claims do not strand a lock; wrong-holder/stale release cannot free ownership; transaction and savepoint rollback preserve a valid releasable session lease; valid release and actual backend disconnect permit a new owner. Test pool-handle refusal and invalid identities before database queries.

The native suite is in the existing executed-proof CI job and its no-skip guard, with narrow workflow path triggers. The two owned commits have been rebased onto the **prepared DEE-1212 head** `818d63246fa89841d6151c4772ce468310ea1592`; this is a prepared integration base, not current `main`. On this combined tree the capital job retains both the ordinary-paper-domain and account-executor-lease suites in its exact ordered 30-suite roster. The separate DEE-1200, DEE-1205, DEE-1211 and DEE-1212 native jobs remain intact. The exact-head native job, final independent review and applicable CI remain pending. Preserve the original counterexamples and failed attempts. No full local unit run is required.

## Local implementation proof

The exported implementation had three actual PostgreSQL counterexamples before correction: UUID case variants could acquire separate semantic locks; a repeated/reentrant claim could overwrite the fence while incrementing the session lock count; and `BEGIN; claim; ROLLBACK` removed GUC fence metadata while leaving the session advisory lock held. These are implementation defects reproduced with the exported helper on a reserved session, not evidence of a production incident. Original reproductions remain in `dee1201-account-executor-lease-counterexample.json` and `dee1201-rollback-counterexample.json` under the Oct 1 audit directory.

The correction uses a module-private `WeakMap` keyed by the actual reserved handle, with synchronous `PENDING` reservation and `ACTIVE`, `RELEASING`, and `TAINTED` states. It does not rely on transaction-sensitive GUCs. Concurrent release calls share one unlock operation. An uncertain SQL result taints that backend; the caller must close it rather than return it to a pool. This helper still does not own the backend lifecycle or provide a continuous executor owner.

The earlier local synthetic PostgreSQL 16 loopback run passed 8 tests, 0 failed, 0 skipped, with captured source pins unchanged during execution. Receipt: `dee1201-native-rollback-fix/receipt.json`; it remains historical and was not rerun on the prepared DEE-1212 base. Rebase range-diff is one-to-one for the two original owned commits. The seven non-plan implementation/test/guard paths remain byte-identical; the workflow also contains the same 181 inherited lines added between old base `7b0a9b72` and prepared base `818d6324` for the DEE-1211/1212 jobs. Subsequent plan-only metadata commits record the prepared base and current checks. The earlier 1201-only focused unit/CI-guard batch passed 95 tests; `dee1201-readiness/receipt.json` retains those logs. On the prepared DEE-1203 base, the lease/capital/PROFILE35 batch passed 97 tests and the separate graph/dedicated-proof-guard batch passed 40. On this prepared DEE-1212 tree, fresh scoped readiness passed 97 lease/capital/profile guard tests, 27 graph tests, lint (0 errors, 331 warnings), typecheck, build, canonical validation (288 documents), and both graph validators (Reality V2: 164 sources, 154 consumers, 27 connector references; Execution V2: zero violations). Logs are in `dee1201-after1212-readiness/`. These checks do not replace native proof on this combined head: exact publication-head CI must execute the combined native roster. The original pre-correction counterexample receipts and failed attempts remain retained.

## Acceptance

- Exactly one paper/mock owner can hold the same semantic organization/account identity across PostgreSQL sessions.
- A reserved session cannot accumulate hidden reentrant account locks or replace its active owner.
- Ownership checks and release use the canonical identity, actual backend lock, fence and holder.
- Native tests execute with no failed/skipped cases; missing, skipped or empty CI proof refuses acceptance.
- The no-runtime-caller limitation and remaining continuous-owner/recovery work stay explicit; no live, production or scientific readiness is claimed.

## Actual-main integration

Prepared head `665a48a9f721c2d3832ae1f2b6c85f7d159b83fb` is the recorded source. It was not mass-rebased. Only the DEE-1201 delta from prepared parent `818d63246fa89841d6151c4772ce468310ea1592` was applied onto main `520672258014ca4600b2343eef530a65dc38d769` (PR750). Historical local proof above stays bound to its earlier bytes.

The production scheduled caller is `custom-worker.ts`, which invokes `runScheduledNoncapitalPaperLoopFromEnv` and does not import this lease. The owner lock is transaction class `1125001` on the organization. This lease is session class `1151` on canonical `organization:account`. Holding one does not exclude the other, and this lease is still not an effect fence or a continuous executor. The scheduled-owner native suite now runs the real owner through startup, one repeated job, and a lease-backend restart while the real lease is held. That case is source-pinned with the lease modules. Exact publication-head CI and an independent review remain required. No deployment or activation is authorized.
