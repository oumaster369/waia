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
  nextAction: "Run exactly one renewed full suite on the clean frozen head, then obtain one fresh independent exact-head adversarial review with zero unresolved P1/P2."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-675 — Reality V2 HTX Spot Canonical Truth Integration Batch

## Ratified base and ownership

- Authoritative base: `d45bb9b11b21c7217eed5957eecdb629d309f4c6`.
- Base refresh: Human/controller-authorized on 2026-08-22 after a read-only overlap audit proved the sole base advance, DEE-672, is a non-overlapping Finance UI/Wrangler change. The unpublished train was mechanically rebased from clean head `561e003e5428272ff126b295a231a5eae74c8cd3` to `cbb9c6bb41c038101778f03a572561d75419fe98`; its cumulative binary patch SHA-256 remained `4f7e794e2872f439e8c01001eb33b508651546fbbd2dcd6734f644feccdc50a3`. All DEE-672 and DEE-674 paths remain byte-identical to `origin/main`.
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
- DEE-679: the pre-enumerated HTX/Execution ingress adapters, machine-readable repository inventory, static consumer-graph validator, package command, and closure tests. D binds all current connector, Execution V2, and market-data source surfaces—including historical, fixture, scenario, synthetic/modelled, holdout, research, and barrel paths—to an explicit disposition. D must not create a new source class or child PR.

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

## Changed-head remediation authorization — 2026-08-22

Human authorization resumes this same train and branch to remediate the four confirmed exact-head findings only: canonical-ledger-derived projection persistence and intent-specific writes; strict source/transport metadata; a database-authored monotonic per-scope knowledge frontier with exact as-of replay; and default fail-uncertain ingress plus whole-repository source/consumer closure. This authorization retains migration `0160`, creates no new API/table/source/task/branch/PR/migration number, and invalidates the earlier frozen-head suite/review evidence. After refreeze, exactly one renewed full frozen-head suite and one fresh independent exact-head adversarial review are required.

The first changed-head remediation was completed in four file-disjoint child commits. Its frozen evidence was invalidated when the Human authorized the following exact additional guard remediation on 2026-08-22, starting from clean head `3462378d9ad660291ed1aa3002e62734f3579ea6` on unchanged base `d45bb9b11b21c7217eed5957eecdb629d309f4c6`.

The additional authorization remains inside the existing A/B/C/D surfaces and unpublished migration `0160`: immutable raw-capture source/account admission binding; one protected per-scope frontier relation plus narrow security-definer allocation/consumption; exact `quarantineEventId` episode linkage; strict nonblank account scope; and the associated contract, repository, projection, ingest, PostgreSQL, inventory, manifest, and provenance updates. It creates no source class, external API, migration number, task, branch, or PR. The canonical raw-capture registry feed remains the existing `raw-foundation` identifier; no `htx_private_spot_*_rest_v1` classification is admitted.

Focused remediation evidence is green: 26/26 affected contract/projection/ingress/migration/consumer-graph tests, typecheck, a fresh empty PostgreSQL migration through `0160`, and 6/6 PostgreSQL adversarial tests covering cross-organization/account/source relabeling, immutable admission identity, forged/SET-LOCAL/reused reservations, reversed-start monotonic frontier, blank scope, forged/double quarantine episodes, exact release linkage, double release, and six-table deny RLS. The AST inventory is mechanically refreshed at 149 source files / 115 consumers / 25 connector references with regenerated path/content digests. The file-disjoint A→B→C→D remediation implementation head is `53f8a84c8ce4555c5c9cccbe3e28d8ad32d98fcb`; this integration-only provenance seal freezes the complete diff for the one renewed full suite and one fresh independent exact-head review.

That freeze was invalidated by the exact-head review findings subsequently authorized by the Human on 2026-08-22 from clean head `15af6f1321adaeada0697184d716b9558d1d7424` and unchanged base `d45bb9b11b21c7217eed5957eecdb629d309f4c6`. The authorized remediation is limited to preserving a missing source-native correction target as a truth-null `QUARANTINED` episode with `CORRECTION_TARGET_NOT_FOUND`; rejecting `SOURCE_CONTRADICTION` append against a related stable truth already superseded; and correcting stale current-evidence wording. No new table, API, source class, migration number, task, branch, or PR is introduced.

Renewed focused evidence is green: all five Reality V2 focused unit files pass 25/25, typecheck and scoped lint pass, a fresh disposable PostgreSQL database applies every authoritative migration through amended unpublished `0160`, and the Reality PostgreSQL adversarial suite passes 7/7. The proof includes source-only missing-target persistence with no truth row and exact replay, plus repository-level and direct-SQL rejection of a superseded contradiction target. The serialized B→C remediation implementation head is `d58387e844b30ec782e14d299c3493943c2b968f`; this integration-only provenance seal refreezes the exact diff for one renewed independent exact-head review before the still-unused full-suite allowance.

## Rollback and STOP conditions

Rollback is one revert PR; there is no destructive down migration, direct production mutation, or Execution Server action. Stop on any new raw source class, retention/security policy change, production/live/capital/holdout/destructive/Execution Server gate, semantic conflict, unadmitted surface, authoritative main/head change, or failed/missing evidence.
