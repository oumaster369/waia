---
integrationIssue: DEE-1115
integrationTitle: "Commit org live-permission transitions and their audit atomically"
branch: dee-1115-live-permission-atomicity
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1115
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementing
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Independent review, coordinated readiness and mandatory native PostgreSQL CI on the publication head."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1115 — org live-permission command atomicity

Parent DEE-596; completion audit D27 / M01 U02. On accepted base `55bcefa4128b716915574971a0a7f28c4f4b12f9`, the public PostgreSQL service commits the governance event, permission projection and Core audit in separate statements. An audit failure after `markEnabled` leaves `ENABLED` v3 visible to `assertOrgLiveEnabled`; normal retry refuses instead of supplying the missing audit. The event actor/digest and native projection change-log row still exist: this is a partial command, not an assertion of an unrecorded activation or a complete trading-authorization bypass.

## WP-1: one held transaction for each existing mutation

The public `createPostgresOrgLiveEnableService` is the sole correction boundary. Its five existing mutation methods own a native PostgreSQL transaction and create their repository and Core audit collaborators with that same transaction executor. All existing state-machine bodies, acknowledgement, configured cooling delay, version checks, caps, clocks and typed business refusals remain in place. A failed disable preserves the previously committed `ENABLED` state; a failed enable cannot newly grant it.

Before any transition state read, lock the existing scoped `organizations.id` row `FOR UPDATE`. That row exists before the first permission projection, so two first requests also serialize. Use explicit `READ COMMITTED` so the later state and event reads see the predecessor after a lock wait even when the session default is `REPEATABLE READ`. Snapshot scope, actor and scalar input properties before awaiting; use that same captured identity for the lock and transition. A missing Core organization refuses before effects.

The transaction contains database operations only, with no venue or other remote call. No schema, migration, historical repair, Core audit backfill or standalone repository redesign is needed. The low-level repository is still an executor-bound building block and is not claimed to provide standalone command atomicity.

### Caller inventory

| Existing consumer | Database supplied | Result of this change |
| --- | --- | --- |
| `scripts/trader/live-cli.ts::withOrgLiveEnableService` | Root `runtime.db` | Existing operator commands receive the atomic service. CLI is not executed for this proof. |
| `lib/trader/live/build-live-cli-deps.ts::buildLiveCliPostgresDeps` | Root `db` | Existing service composition receives the atomic factory; execution and connectors unchanged. |
| `lib/trader/live/admin-route-handler.ts` | Root `runtime.db` | Existing command handler invokes the atomic service. Authentication and permission decisions unchanged. |
| `lib/trader/admin-overview-handler.ts` | Root `runtime.db` | State/preview remain direct reads. |

None of these existing consumers passes an outer held transaction. No nested-isolation guarantee is claimed for a future caller that does so. `getState`, `preview` and the existing event-list repository read remain read-only and acquire no mutation lock. SQLite is unchanged.

## Native acceptance

Use the public real service, real schema/repositories/audit writer and loopback-only disposable PostgreSQL with the full existing migrations. Keep security, event/audit append-only and projection change-log triggers enabled. Fixture-only fault triggers are scoped to randomly generated synthetic organizations and removed afterward; append-only fixture evidence is retained. Observations use a distinct connection.

- For request, confirm, enable, disable and cancel, inject native `BEFORE` and `AFTER` failures at event, projection and Core audit writes. Each failure must preserve the exact prior durable rows; removing the fault and retrying commits exactly one revision, event, Core audit and change-log row. Verify the event digest chain and normal repeated-command refusal.
- Exercise the actual migration0216 projection change-log trigger with a failing change-log insert for all five commands. Rolled-back rows are absent; sequence allocation is not claimed to be gap-free.
- Observe two distinct blocked connections per command with session defaults set to repeatable read. After releasing the organization mutex, exactly one command succeeds and the other returns the existing refreshed-state refusal. Race confirmation against cancellation and check version enforcement.
- While one organization is blocked, a different organization can proceed. Mutating the caller's objects during the wait cannot change the locked organization, original actor or submitted cap.
- Preserve acknowledgement, cooling, cap, stale-version and tenant controls; test cancellation from both allowed states, plus explicit prior-authority preservation on failed disable. Invoke the actual `assertOrgLiveEnabled` guard after failures.
- Exercise the registered admin handler function against real PostgreSQL permissions and transactions. Unauthenticated/non-admin controls refuse. This fixture uses an injected local runtime; it does not claim a production HTTP/session or all-path disposal test.
- Reconnect and read state/preview/events with a read-only database session. Verify existing browser-role RLS and event/Core audit append-only refusals, using transaction-local grants that roll back.

The baseline native enable/audit failure is RED before the implementation. Final scoped tests and exact counts are recorded in the author handoff; mandatory CI registration and no-skips proof remain part of integration readiness.

## Verification and boundaries

Changed production file: `lib/trader/live/org-live-enable-service.ts`. Native suite: `tests/integration/postgres-org-live-enable-atomicity.test.ts`. Preserve existing governance, live authorization, tenant, CLI and admin-route unit tests. Run scoped ESLint and diff validation; root serializes full `pnpm lint`, `pnpm typecheck`, `pnpm build`, canonical/governance checks, required companion suites and exact-head CI before publication/merge.

Native faults prove rollback at the tested SQL boundaries and real concurrent ordering. They do not prove recovery from an unknown commit acknowledgement or every possible process/host failure. No production permission is mutated, no real trading enabled, no account or credential used, and no C3 worker changed. Org0, promotion, Risk, kill switch, execution, financial rules and authorization policies remain independent and unchanged. Historical partial records are not repaired or invented by this package.
