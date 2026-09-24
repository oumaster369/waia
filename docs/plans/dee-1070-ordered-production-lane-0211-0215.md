---
integrationIssue: DEE-1070
integrationTitle: "Ordered production lane for 0211–0215"
branch: dee-1070-ordered-production-lane-0211-0215
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1070
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: done
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: 640
  prUrl: https://github.com/oumaster369/waia/pull/640
  lastValidatedGitSha: 1a95e2a0a417f1cd498ef514ed58b7ae44aeb91e
  lastValidationAt: "2026-09-24T14:20:59Z"
  blockedReason: null
  nextAction: "Human squash-merge PR #640. Do not apply 0211–0215 until a later confirmation phrase."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1070 — ordered production lane for 0211–0215

Owner pre-approval (T3): extend the existing one-step operator `pnpm trader:post-h2:migrate` from `0209`/`0210` through `0211`, `0212`, `0213`, `0214`, and `0215`. The guarantees stay the ones already shipped for `0209`/`0210`. Production stays on `0210` until a later Human phrase names exactly one step.

## Scope

- One migration per invocation. The live journal must end exactly at the predecessor. Gaps, sparse apply, extra or unknown rows, wrong hashes, and a repeat are refused.
- SQL is read from the pinned Git blob. The migration and one journal row commit in one transaction.
- `--verify-only` and a secret-free receipt stay.
- Each step has its own catalog check before commit and again in a read-only transaction after commit.

Catalog checks:

- `0211`: version tables exist, immutability triggers exist on `trader_knowledge_edges` and `trader_market_predictions`, copied row counts equal the source counts, and UPDATE/DELETE grants on those tables are revoked.
- `0212` / `0213`: promotion tables, then deny-by-default RLS.
- `0214` / `0215`: console tables, then deny-by-default RLS. Trigger `trader_admin_change_log_trg` must be absent.

## Acceptance

- `pnpm trader:post-h2:migrate` accepts exactly one of `0211`–`0215` per invocation and refuses a gap, a sparse step, a wrong hash, and a repeat.
- Each step verifies its catalog before commit and again in a read-only transaction.
- Migration bytes `0205`–`0215` and `_journal.json` stay unchanged. Production stays on `0210` in this PR.

## WP-1 — Extend the operator through 0215

Pin `0211`–`0215` on the existing post-H2 operator, add the catalog checks above, and cover the ordered chain, a sparse `0212`, a repeat, and `--verify-only` on isolated PostgreSQL 17.

## Out of scope

Do not change migration bytes `0205`–`0215`, `_journal.json`, the H2 operator, C3, or FHV. Do not run `pnpm db:migrate:postgres` against production. Do not apply `0211`–`0215` in this PR. Do not enable `WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED`.

## Production effect, after a later ceremony

| Step | What the pinned SQL does |
|---|---|
| 0211 | Adds version tables, copies existing edge and verified-prediction rows, blocks UPDATE/DELETE with triggers, revokes those privileges. |
| 0212 | Adds human promotion proposal and research assignment tables. |
| 0213 | Enables deny-by-default RLS on those two tables. |
| 0214 | Adds the admin-console tables. No change-log trigger. |
| 0215 | Enables deny-by-default RLS on the console tables. |

## Validation

`pnpm lint`, `pnpm typecheck`, `pnpm build`, unit tests for the operator, and the existing opt-in PostgreSQL 17 integration lane on an isolated loopback database that is not port `54329` and not `.env.local`.

Catalog digests for `0211`–`0215` were re-derived on PostgreSQL 17.11 (`postgres:17-alpine`) at `127.0.0.1:55492`. The integration suite is opt-in and is not a GitHub Actions job, so this change does not add a CI step. The unit suite already runs in CI.
