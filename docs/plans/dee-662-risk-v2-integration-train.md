---
integrationIssue: DEE-662
integrationTitle: "R650 — Risk V2 Integration Train (Verdict → Allowance → Atomic Claim)"
branch: dee-662-risk-v2-integration-train
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, linear, postgres-ci, github-pr]
executionLabel: backend
requiredValidation: [lint, typecheck, build, unit-full-once, unit-targeted, postgres-integration, tenant-isolation, rls, integration-train, canon, pr-governance, authoritative-pr-ci]
approvalGates: [human-t3-scope-ratified, pre-implementation-admission, integration-ready, independent-adversarial-review, dee-653-exact-head-admission]
includedIssues:
  - id: DEE-663
    role: risk-verdict-and-economic-size-contract
    completionPolicy: manual-after-exact-head-merge
    status: delivered
  - id: DEE-664
    role: protective-posture-semantics
    completionPolicy: manual-after-exact-head-merge
    status: delivered
  - id: DEE-665
    role: allowance-admission-and-postgres-ledger
    completionPolicy: manual-after-exact-head-merge
    status: delivered
  - id: DEE-666
    role: atomic-consumption-and-connector-guard
    completionPolicy: manual-after-exact-head-merge
    status: delivered
deferredIssues: [DEE-651-global-legacy-connector-cutover]
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: validating-frozen-head
  currentWorkPackage: WP5
  completedWorkPackages: [WP0, WP1, WP2, WP3, WP4]
  remainingWorkPackages: [WP5]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 09743189a2d7fbad3b725a8ab86fed43646bf4f2
  lastValidationAt: "2026-08-21"
  blockedReason: null
  nextAction: "Commit the frozen manifest, run the one full local suite, and obtain the fresh independent exact-head adversarial review."
provenance:
  createdFrom: human-ratified-delegation
  gapRegistry: null
  supersedes: null
humanApproval:
  authorizedAt: "2026-08-21"
  authorizedBaseMain: 292af189b100f1c412dbf65e348ca844efe7bd4a
  authority: "Explicit Human ratification of DEE-650 train R650-A/B/C/D and the additive PostgreSQL/RLS schema"
renewedAdmission:
  authorizedAt: "2026-08-21"
  authorizedBaseMain: 3117675275c2f7b0f0cb0e4865ce2cfa656bb3a4
  baseContainsPullRequest: 474
  priorReviewedHead: ec95408f5aa17d0beba2aa77f5abdaadd868b81a
  authority: "Explicit Human authorization to preserve Treasury 0154/0155 and renumber the additive Risk V2 migration to 0156"
scopeReconciliation:
  authorizedAt: "2026-08-21"
  authority: "Explicit Human decision after R650-D boundary audit"
  riskV2Boundary: "Every order entering Risk V2 fails closed without its exact consumed and bound RiskAllowanceV2."
  delegatedToDEE651: "Global legacy connector-caller cutover and whole-repository consumer-graph closure."
---

# DEE-662 — Risk V2 Integration Train

## Authority and boundary

The Human ratified exactly four DEE-650 children and renewed their exact-base admission on
`origin/main@3117675275c2f7b0f0cb0e4865ce2cfa656bb3a4`, which contains PRs #473 and #474.
Treasury migrations 0154/0155 are preserved byte-for-byte and the additive Risk migration is
admitted as 0156.
DEE-649, DEE-660, and DEE-653 are Done; DEE-650 is Todo and dependency-ready. This
batch is the only Integration Batch under DEE-650 and owns one branch, one manifest,
one PR to `main`, one exact-head admission, and one squash merge.

This is a T3 implementation batch because it joins authority contracts, persistence,
concurrent reservation accounting, RLS, and the connector-consumption boundary. The
Human pre-authorized the exact architecture and scope. Production SQL apply, live or
capital actions, holdout access, Human recovery, security-policy mutation, and an
Execution Server remain outside the authority.

## Exact train

| Wave | Child | Scope | Disposition |
|---|---|---|---|
| 1 | DEE-663 / R650-A | RiskVerdictV2, legacy mapping, Decision digest, exact continuous/discrete size intersection | Serialized |
| 2 | DEE-664 / R650-B | NORMAL/CLOSE_ONLY/HALT/KILLED and strict long-only reduction | Serialized after A |
| 3 | DEE-665 / R650-C | RiskAllowanceV2, atomic reservations, schema/repository/event ledger | Serialized after B |
| 4 | DEE-666 / R650-D | Atomic claim/order binding, TOCTOU recheck, connector guard | Serialized after C |

No parallel agent work is used. A and B are file-disjoint, but serialization gives the
integration owner one unambiguous review/admission chain. C and D intentionally overlap
only on the allowance repository and Postgres integration proof and therefore remain
strictly sequential.

## Frozen review surface

The admitted inventory is 23 files including this plan/manifest, approximately 2.8–3.6k
changed lines. It exceeds the usual approximate 20-file/800-line target for one reason:
the same capital-permission invariant must be explicit in pure types, typed Drizzle schema,
one hand-authored migration, the privileged transactional repository, the sole connector
guard, and adversarial unit/Postgres/RLS/concurrency proofs. It remains one additive
migration, one rollback boundary, and four independently reviewable commits. R650-D is
bounded to seven declared files and must stop if it would absorb DEE-651 planning,
routing, slicing, or retry policy.

## Acceptance

1. Canonical V2 verdicts are sealed and legacy results map deterministically without any
   historical rewrite.
2. Risk intersects exact Decision-qualified continuous/discrete sizes without recomputing
   economics or inventing a size.
3. CLOSE_ONLY admits only strict non-reversing spot exposure reduction; HALT/KILLED never
   originate liquidation authority.
4. Verdicts are immutable, allowances are single-use/expiring/revocable/nonce-bound, and
   enforcement events are append-only and digest-chained.
5. Atomic admission and reservation accounting include reconciled exposure, worst-case
   pending exposure, and outstanding reservations in Risk sequence order.
6. Consumption atomically binds the exact order and rechecks current posture, kill, and
   reconciliation authority before connector submission.
7. Uncertain outcomes can continue only the same bound order; partial fills leave no
   residual authority.
8. Postgres organization integrity, RLS metadata, real temporary-grant CRUD denial,
   append-only behavior, concurrency, and clean migration apply are proven.
9. Every order entering through the Risk V2 path fails closed unless its exact current
   allowance has been atomically consumed and bound. Static and runtime proof covers this
   Risk V2 branch through the sole connector submission site without claiming that legacy
   callers have already been cut over.
10. Exactly one full local unit suite runs after the complete diff is frozen. Final lint,
    typecheck, build, canon, governance, Postgres, and exact-head adversarial review pass
    with zero unresolved P1/P2 before publication.

## Explicit exclusions

No DEE-620 Source/PIT/Measurement, Decision-economic recomputation, Kelly/VaR/predictive
optimization, short/leverage/derivatives, Billing HWM merge, legacy rewrite, production
apply, credentials or security-policy mutation, live/capital/promotion, holdout, destructive
operations, Human recovery decisions, Execution Server, or DEE-651 Execution V2 planning,
routing, slicing, and retry design.

## Explicit DEE-651 handoff

DEE-651 owns the still-unsatisfied global legacy connector-caller cutover and final
whole-repository static/runtime connector consumer-graph closure. It must migrate or
fail-close every remaining legacy/non-V2 caller and prove that no such path can reach an
external connector effect without exact consumed/bound RiskAllowanceV2 authority. This
delegation does not weaken the complete fail-closed R650-D boundary for orders that enter
Risk V2, and this train makes no global enforcement claim.

## Work packages

- **WP0 — admission:** commit this plan and valid admitted manifest before child code; then
  move DEE-662 and DEE-663 to In Progress.
- **WP1 — DEE-663:** implement/review A and run its focused tests.
- **WP2 — DEE-664:** implement/review B and run cumulative A+B tests.
- **WP3 — DEE-665:** implement/review C, the sole migration, repository, and full Postgres
  security/concurrency proof; run cumulative A+B+C checks.
- **WP4 — DEE-666:** implement/review only the atomic claim/bind connector gate and run
  cumulative A–D checks.
- **WP5 — freeze/publication:** freeze manifest/diff, run exactly one full local suite plus
  all remaining gates, obtain a fresh independent exact-head review, publish one non-draft
  PR, monitor CI, produce fresh DEE-653 admission, and guarded squash-merge only on PASS.

Rollback is one revert PR. Any database rollback or production SQL action is a distinct
Human/operator decision and is not performed by this batch.
