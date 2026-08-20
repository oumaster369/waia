---
integrationIssue: DEE-656
integrationTitle: "AI-TRADER — T2 Raw Foundation V1 Integration Train"
branch: dee-656-t2-raw-foundation-v1
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, linear, postgres-ci, github-pr]
executionLabel: backend
requiredValidation: [lint, typecheck, build, unit-targeted, postgres-integration, integration-train, pr-governance, authoritative-pr-ci]
approvalGates: [human-scope-ratified, pre-implementation-admission, integration-ready, independent-adversarial-review, human-merge]
includedIssues:
  - id: DEE-657
    role: raw-capture-contracts
    completionPolicy: manual-after-human-merge
    status: delivered
  - id: DEE-658
    role: postgres-persistence
    completionPolicy: manual-after-human-merge
    status: delivered
deferredIssues: [DEE-620, DEE-621]
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP3
  completedWorkPackages: [WP0, WP1, WP2]
  remainingWorkPackages: [WP3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Validate the frozen manifest and full local PR-readiness gates, then publish one Human-merge PR."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
humanApproval:
  authorizedAt: "2026-08-20"
  authorizedBaseMain: efe570fda2eb1d6bc3fc4ce06837e50944b53c23
  authority: "Human ratification: DEE-620 T2 RAW FOUNDATION V1 choices 1B, 2B, 3B, 4B, 5B, 6A"
---

# DEE-656 — T2 Raw Foundation V1 Integration Train

## Authority and boundary

The Human Architect ratified the smallest generic DEE-620 raw-capture and record-only
validation foundation on `origin/main@efe570f`. This batch implements only that decision.
DEE-620 remains open and DEE-621 remains blocked after the batch.

The ratified invariants are:

- private encrypted object storage is represented by a server-only object reference; Postgres
  stores append-only receipts and bindings, never raw bytes;
- raw-byte, capture-receipt, and storage-binding identities are separate and deterministic;
- `RawCapturePolicyV1` is mandatory and versioned, with no repository production defaults;
- headers, cookies, authorization material, and query parameters are structurally excluded;
  body bytes require an exact-digest secret-scan `PASS` proof;
- validation knowledge time is authored at the durable persistence boundary and cannot be
  caller-backdated;
- `VALID` and `REJECTED` are record-only states with zero Observation, Measurement, Forecast,
  Decision, Risk, strategy/account, or capital authority.

## Exact train

| Wave | Child | Scope | Disposition |
|---|---|---|---|
| 1 | DEE-657 | Pure contracts, deterministic identities, fail-closed admission, test adapter | Serialized |
| 2 | DEE-658 | Postgres append-only persistence, storage bindings, tenant/RLS proof | Serialized after DEE-657 |

The children share canonical identities and persistence contracts, so there is no safe parallel
pair. The adjacent admitted manifest is the authoritative file/surface inventory.

## Reviewability rationale

The frozen implementation is 14 child-owned files in two dependency-ordered commits plus the
plan/manifest. It exceeds the approximate line target because the same security contract is
intentionally repeated in pure types, Drizzle schema, hand-authored SQL, and adversarial tests.
The diff remains one coherent T2 invariant, one additive migration, one rollback boundary, and no
runtime/provider/semantic surface. Human choice 6A explicitly ratified one serialized train; the
exact commit/file manifest keeps each child independently reviewable inside that PR.

## Acceptance

1. No production max-size/retention values exist; missing or invalid policy fails closed.
2. Raw bytes, capture receipt, and storage binding have separate content-addressed identities;
   the mutable locator is outside raw identity.
3. Sensitive transport envelope data is structurally absent and non-`PASS` secret scans reject.
4. Rejected raw evidence is retained with typed reasons and zero semantic/downstream authority.
5. Postgres tables contain no raw body bytes, are org-scoped and append-only, reject cross-tenant
   references, and deny `authenticated`/`anon` through RLS.
6. Validation `knownAt` is obtained inside the durable transaction and cannot be supplied by the
   caller.
7. Targeted deterministic, tenant, append-only, RLS, and applied-migration tests pass, followed by
   lint, typecheck, build, train validation, PR preflight, and authoritative PR CI.
8. One branch and one PR target `main`; merge remains Human-only.

## Explicit exclusions

No production policy defaults, object-store client/bucket/KMS, production SQL apply, provider or
source-class inventory, external Observation vocabulary or validators, Measurement semantics or
evaluator, T3 runtime convergence, DEE-621 sufficiency logic, holdout access, live/capital work,
strategy/account promotion, or Execution Server work.

## Work packages

- **WP0 — admission:** commit this plan and the valid `status: admitted` manifest before code;
  set DEE-656/DEE-657 `In Progress` only after that proof exists.
- **WP1 — DEE-657:** implement and commit the pure contracts/test adapter and focused tests; run
  cumulative targeted validation and record the exact commit/files.
- **WP2 — DEE-658:** implement and commit the additive Postgres schema/migration/repository and
  security tests; run cumulative targeted/Postgres validation.
- **WP3 — freeze/review/PR:** freeze the manifest against the admission commit and child evidence,
  run all local gates, synchronize with `origin/main`, publish one PR, obtain final independent
  adversarial/Human security review of the exact PR head, and stop before Human merge.

Rollback is one revert PR plus a separate Human/operator-managed database rollback decision. This
batch never applies SQL or storage changes to production.
