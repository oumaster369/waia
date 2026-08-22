---
integrationIssue: DEE-675
integrationTitle: "Reality V2 HTX Spot Canonical Truth Integration Batch"
branch: dee-675-reality-v2-htx-spot
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, postgres-ci, github-pr-ci]
requiredValidation:
  - focused-contract-tests
  - focused-postgres-tests
  - source-consumer-closure
  - lint
  - typecheck
  - build
  - full-frozen-head-unit-suite
  - pr-governance
  - independent-exact-head-adversarial-review
approvalGates:
  - plan-approved
  - t3-scope-preauthorized
  - integration-ready
  - dee-653-exact-head-admission
includedIssues:
  - id: DEE-676
    role: A-contracts-identities-validators
    completionPolicy: manual-at-integration-ready
    status: completed
  - id: DEE-677
    role: B-postgres-substrate-repository
    completionPolicy: manual-at-integration-ready
    status: completed
  - id: DEE-678
    role: C-ingest-projection-replay
    completionPolicy: manual-at-integration-ready
    status: completed
  - id: DEE-679
    role: D-consumer-cutover-closure
    completionPolicy: manual-at-integration-ready
    status: completed
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-validation
  currentWorkPackage: null
  completedWorkPackages: [DEE-676, DEE-677, DEE-678, DEE-679]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Freeze exact-head integration evidence, run the single full suite and PR-readiness gates, then obtain independent adversarial review."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-675 — Reality V2 HTX Spot Canonical Truth Integration Batch

## Ratified base and ownership

- Authoritative base: `b68290c3eb9e3a1f27b6e67219959ce033d7f1dc`.
- Parent Step-16 authority: DEE-652.
- Integration owner: one owner across DEE-676 → DEE-677 → DEE-678 → DEE-679.
- Integration boundary: one branch, one admitted/frozen manifest, one migration, one PR to `main`, one squash merge, one revert-PR rollback path.
- DEE-651 and DEE-653 were verified Done before work began. DEE-634 and DEE-620 remain separate Todo work.

## Human-ratified implementation policy

The first HTX spot MVP canonical allowlist contains only:

1. DEE-651 `ExecutionReportV2` records; and
2. raw HTX spot order, fill, balance, and account observations entering through already admitted connector boundaries.

WebSocket, chain, public market data, internal expectations, synthetic/modelled effects, simulator, paper, historical, and every other connector/source class are excluded from canonical admission until separately ratified. Unknown or excluded sources must be explicit and fail-uncertain; they may not be silently dropped or promoted.

Raw bytes remain in the existing encrypted raw-capture substrate under its unchanged retention and security policy. Reality persists immutable receipt/digest/reference lineage and normalized primitive assertions only. It never copies credentials, signed requests, raw bodies, or secrets.

All new Reality tables are organization-scoped, service-only, deny-RLS, append-only, bitemporal, and protected against cross-tenant access, concurrent duplicate admission, and check-then-act races. Only an explicit source-native correction/supersession may change canonical truth. Unresolved contradictions are quarantined; the last stable projection survives until an append-only release or supersession. Confidence/finality merit arbitration is forbidden.

## Frozen A API and file manifest

DEE-676 freezes these source identities:

- `EXECUTION_REPORT_V2`
- `HTX_SPOT_ORDER_REST`
- `HTX_SPOT_FILL_REST`
- `HTX_SPOT_BALANCE_REST`
- `HTX_SPOT_ACCOUNT_REST`

It freezes these subject classes:

- `ORDER`
- `VENUE_EVENT`
- `FILL`
- `BALANCE`
- `ACCOUNT`
- `POSITION_INVENTORY`
- `REALIZED_CASHFLOW`

The A contract distinguishes verified reports from unattributed/unverifiable reports, requires exact source lineage, valid time and database-authored knowledge time, forbids raw payload copies, limits Reality uncertainty markers to `SOURCE_CONTRADICTION` and `UNATTRIBUTED`, and rejects status-only fill certainty.

Frozen implementation surfaces:

- DEE-676: `lib/trader/reality/v2/contracts.ts`, `source-admission.ts`, `index.ts`, and `tests/unit/trader-reality-v2-contracts.test.ts`.
- DEE-677: `db/schema.postgres.ts`, `db/migrations_postgres/0160_trader_reality_v2.sql`, `db/migrations_postgres/meta/_journal.json`, `lib/trader/reality/v2/repository-postgres.ts`, PostgreSQL/migration identity tests, and the migration tracker.
- DEE-678: deterministic ingest, projection, replay modules and their focused unit/PostgreSQL tests. B and C are serialized.
- DEE-679: the pre-enumerated HTX/Execution ingress adapters, machine-readable repository inventory, static consumer-graph validator, package command, and closure tests. D must not create a new source class or child PR.

## Acceptance

### DEE-676 — A

Freeze immutable content-addressed contracts, source/subject identity rules, safe primitive assertion schemas, raw-reference lineage, and default-deny validators. A is complete only when named accepted paths validate, excluded paths fail, status-only fills cannot become exact fill truth, and the public API no longer needs B/C semantic changes.

### DEE-677 — B

Add exactly one next-numbered PostgreSQL migration containing the Reality source-report, truth-record, event-ledger, and projection-ledger tables. Implement the organization-scoped repository with database-authored knowledge time, append-only constraints, digest-chain/frontier integrity, source-native dedup, correction/supersession scope integrity, deny RLS, real-role CRUD denial, cross-tenant isolation, concurrency, and TOCTOU proofs.

### DEE-678 — C

Implement deterministic structural verification, ingest classification, source-native dedup, explicit correction/supersession, contradiction quarantine/release, stable fold, current/as-of projection, and restart replay. No confidence/finality merit arbitration is permitted. The same ledger and as-of coordinate must always produce the same digest/frontier.

### DEE-679 — D

Inventory every repository connector/source producer and Reality-relevant consumer. Wire the approved DEE-651 and HTX REST source classes through the frozen ingress boundary. Mark every other source explicitly excluded/fail-uncertain. Static and runtime closure must prove no bypass, no Expected-State import, and no silent data loss while preserving compatibility for every existing connector consumer.

## Validation and exact-head admission

Use focused tests during each work package. After D and the frozen manifest are complete, run one full frozen-head `pnpm test --run`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, migration/PostgreSQL integration, source-consumer closure, canonical/governance validation, and PR preflight. An independent reviewer must inspect the exact immutable head and report zero unresolved P1/P2. The PR must pass authoritative GitHub CI and a fresh unchanged DEE-653 T3 admission against the exact base/head before squash merge.

## Rollback and STOP conditions

Rollback is one revert PR; there is no destructive down migration, direct production mutation, or Execution Server action. Stop on any new raw source class, retention/security policy change, production/live/capital/holdout/destructive/Execution Server gate, semantic conflict, unadmitted surface, authoritative main/head change, or failed/missing evidence.
