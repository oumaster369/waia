---
integrationIssue: DEE-1213
integrationTitle: "AI-TRADER: bound scheduled noncapital database startup and commit confirmation"
batchMode: single-issue
branch: dee-1213-scheduled-db-deadline
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, native-postgres, worker-runtime, lint, typecheck, build, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: [WP-4]
  nextAction: "Complete exact-head validation and independent review, then publish the single DEE-1213 PR for required CI."
provenance:
  createdFrom: "DEE1213 contract and independent preimplementation design review, 2026-10-02"
  supersedes: null
---

# DEE1213 — scheduled database lifetime

Frozen before code on actual main `ef5c79ececf0606ab37963c08499cc54a078c6ce`.
Parent DEE639 remains open. User authorization covers bounded technical repair,
tests, PR and merge after all required checks and independent review. It does
not make this noncapital scheduled owner a continuous trading executor.

## Invariant and current defect

The closed NONCAPITAL owner owns one transaction and immutable receipt. Its
45-second public poll is bounded. Initial PostgreSQL startup and the fresh
lost-COMMIT verifier are not bounded across repeated clean startup EOFs. The
postgres3.4.9 per-attempt timer can restart indefinitely before SQL timeouts apply.

## Fixed technical contract

- Preserve the public45,000ms poll, database5,000ms lock and30,000ms statement
  limits, clock/freshness checks, transaction/advisory lock and receipt semantics.
- One60,000ms DB-operation cancellation deadline starts after the poll/binding,
  before connection creation, shared by primary operation and fresh confirmation.
  Return time additionally includes a separately measured finite teardown bound;
  no timeout may silently abandon a callback or transport.
- At most two private pools and three connection attempts each, at most six
  physical attempts overall; each connect is bounded by10,000ms and remaining
  shared time. Closed/aborted scope rejects every late open/reconnect/SQL attempt.
- Close only owned sockets/pools, await callback/rollback termination. Keep the
  public env-only API; no caller transaction/factory/deadline/verdict injection.
- Latch actual acknowledged root outcome before cleanup/post-await timer checks.
  The pre-COMMIT callback result is not acknowledgment. An acknowledged COMMITTED
  result stays COMMITTED during cleanup; telemetry errors remain observational.
- After ambiguous COMMIT, finish primary teardown, then freshly read the exact
  receipt only within the original time budget. Exact match alone can confirm;
  otherwise COMMIT_UNCERTAIN/report:null. Never repeat writes. Initial startup
  failure remains refusal/error; preserve verifier integrity refusals.

## Acceptance

Acceptance requires all named native cases with zero skips, the actual Worker
fault/TLS and established-session cleanup probes, unchanged immediate backend
absence assertions, bounded physical opens and no late reconnect, preserved
acknowledged COMMIT and exact-receipt uncertainty behavior. Lint, typecheck,
build, canonical plans, consumer graphs, independent review and all applicable
exact-head CI must pass before merge. Evidence remains limited to the supported
closed owner and runtime profiles; no production or scientific qualification.

## Work packages and implementation gate

1. Preserve a watchdog-contained native RED after genuine PostgreSQL COMMIT:
   proxy withholds acknowledgment then sends clean EOF to every fresh verifier.
   Independent witness proves one receipt/zero execution effects. Test only on
   a new dedicated loopback PostgreSQL16 target with exact role/database guards;
   the existing54329/P08 container is unrelated and must not be changed.
2. Prove and freeze the Worker socket/TLS/DSN adapter contract before production
   source changes. postgres workerd export needs raw.startTls and reader/writer
   lifetime compatibility; Node net.Socket is insufficient. Keep normal package
   exports, authentication/TLS policy and certificate checks. No ssl:false or
   Node-driver-forcing shortcut. Actual workerd TLS/abort/EOF/late-open evidence
   is mandatory; local cleartext startup capability alone does not satisfy it.
3. Root implements the narrow private owned transport and scheduled composition.
   Preserve all9 existing native scenarios and their positive verifier control.
   Add bounded ambiguous-commit/finite-connection/no-late-reconnect proof, direct
   replay without duplicate effects, initial EOF/silent refusal and cancellation.
   Test acknowledgment/deadline/cleanup races and TLS upgrade teardown.
4. Update exact named-case guards, source pins and additive CI path triggers for
   new helpers/harnesses; never weaken existing evidence. Focused units/native,
   Worker bundle/runtime, lint/type/build/canon/graphs, independent final review,
   all exact-head applicable CI and fresh admission before serialized squash.
   Full local units are not repeated solely to duplicate PR CI.

## Boundaries and rollback

No shared/global pool changes, M9/session-admission lifetime change, financial
or strategy/Guardian rule change, production deployment/migration, source/market/
holdout payload access, account/key mutation, scheduler enable or trading.
Production0229 prohibited;0230 deferred. Synthetic disposable fixtures may apply
the existing canonical migration journal and unnumbered proof draft only.
Rollback is a revert PR. Local capability and RED receipts cannot imply repair,
Forward Paper qualification, continuous operation or capital authority.

## Cancellation cleanup refinement — frozen 2026-10-02 before repair

The observed abort fixture remains RED: local socket closure and joined JavaScript
do not attest PostgreSQL backend exit. Capture `(pid, backend_start)` inside the
primary transaction before its callback/effects. Permit only that one primary
transaction. After primary teardown, use the sole fresh read-only verifier pool
to witness exact backend absence; reuse it for any ambiguous-COMMIT receipt read.
This preserves two pools / three opens each. A separately timed40,000ms cleanup
allowance starts when primary work settles, before local teardown. It grants only
cleanup reads, never new effects or extra receipt-confirmation authority: receipt
confirmation remains within the original60,000ms deadline.

Failure to obtain a valid identity or observe exit is explicitly unconfirmed
cleanup, never rollback proof. A witnessed backend exit is not COMMIT evidence.
Preserve acknowledged root results even if cleanup cannot be confirmed, emitting
a distinct operational cleanup diagnostic. Retain failed work as the cause when
cleanup is unconfirmed. Join all owned local tasks and verifier shutdown before
return; no third witness connection and no privileged backend termination.
The verifier is read-only and its local teardown is joined; this does not claim
an independently witnessed exit for its own backend. Transaction-pooling DSNs
cannot be assumed to provide the direct-session backend exit contract.

The actual Worker TLS fixture exposed local close without remote backend exit.
Only after a successful SQL response proves PostgreSQL protocol admission,
teardown of that Worker socket sends PostgreSQL Terminate
(`X`, length4) with a50ms flush allowance before aborting streams/native sockets.
The write remains in the owned task set and is joined after stream abort even
when the flush allowance expires. It sends no SQL, cancellation query or new
connection. Backend absence is still independently witnessed, never inferred
from flush success. Opening/TLS/authentication-stage sockets skip protocol flush. TLS-open alone
is never treated as PostgreSQL protocol admission.

This40s allowance is an enforced cancellation budget, not yet a universal finite
join proof: unresponsive native close or an arbitrary nonsettling callback remains
an admission limitation. Prove the closed production callbacks and supported
Worker/Node paths; do not weaken the immediate native PID-absence assertion.


## Worker transport profile — frozen before implementation, 2026-10-02

The compatibility spike uses the normal postgres3.4.9 workerd export and public
cloudflare:sockets API. Separate Node and Worker transport implementations stay
private to this owner; the public env-only entrypoint cannot select a factory,
supply a callback or override limits. Runtime selection must be proved in the
actual bundled Worker and Node native fixture, with no forced driver export.

Supported DSN is one explicit postgres/postgresql TCP host/port/database with
no fragment, duplicate query keys, socket/path/host/port overrides or multi-host
fallback. Initially accept only the sslmode query parameter: remote endpoints
require verify-full; insecure/ambiguous remote profiles refuse before dialing.
Explicit disable (or existing omitted local SSL mode) is confined to literal
loopback synthetic fixtures, never a remote fallback. Do not copy production
secrets into tests or rewrite production configuration. A deployment must check
its actual DSN profile separately; this document does not assert it matches.
Application review narrowed Node support to the existing cleartext loopback
synthetic fixture only: a Node TLS request refuses before dialing because the
driver replaces socket listeners during TLS upgrade, defeating explicit lifetime
ownership. The scheduled production caller is a Worker; other Node CLI owners
are unchanged. This is an explicit unsupported profile, never a TLS downgrade.
The Worker adapter retains verified native TLS, hostname binding and the normal
postgres authentication/protocol. No ssl:false shortcut for remote connections.

The private pool seals before cancellation/teardown, caps actual physical opens
at three, tracks initial and upgraded transports plus every reader/writer task,
and cancels/aborts owned streams before closing. A detached old socket's close
failure must never skip the upgraded socket. Synchronous startTls failure must
close the owned native transport and converge through bounded pool termination.
A late opened resolution after abort must never hand a usable socket to postgres.
Initial-open cancellation must independently reject even when native opened
remains pending: prove query, pool and transport settle before releasing a
deterministically deferred opened promise, then reject any late handoff.
A fulfilled transaction result is latched before cleanup and cannot be relabeled
uncertain solely because cancellation occurs during cleanup.

The audit-only spike now proves trusted/untrusted/wrong-host TLS and clean EOF,
silent startup, silent TLS-upgrade, early TLS EOF and injected synchronous TLS
refusal against actual workerd. The initial stalled TLS cleanup counterexample
is retained; force-aborting the pending reader/writer repairs that tested path.
This is transport feasibility only. Deterministic deferred-open proof paired
with actual Worker connect-refusal evidence remains pending, and actual scheduled
owner composition, Node PG transactions, immutable exact receipts and acknowledged
commit/cleanup races require fresh evidence on the final application source.
