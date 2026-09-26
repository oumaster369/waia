---
integrationIssue: DEE-1107
integrationTitle: "Bind research qualification to exact candidate content"
parentIssue: DEE-646
branch: dee-1107-research-qualification-binding
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Local acceptance complete; publish one PR and wait for all exact-head CI checks."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1107 — Research qualification content binding

## Proven defect and contract

On main 2cc155119277797055b97d01ace41b2294fb70ed, a synthetic probe using real
builders produced a Human proposal for candidate B with candidate A's passing
qualifications. Swapped/reused partitions, an unrelated hypothesis/symbol and
changed evaluation under an old digest also passed. Unknown runtime verdict
became QUALIFIED; an unknown partition and foreign-candidate rejection passed.
The matched control passed. No DB/venue/capital effects or live-gate bypass were
observed. Exact-version evidence must not be inherited across candidates.

## WP-1 — One verifiable result

Fail closed on unknown/missing qualification partition or verdict. Verify the
candidate's content and existing research-only authority, then bind both
qualification records to its exact digest and designated DEVELOPMENT/WALK_FORWARD
slots. Replay each qualification through its existing constructor, checking its
content digest and invariant fields. Apply the same boundary to proposal and
rejection builders. Bind the proposal hypothesis's sealed content to candidate
lineage. Preserve current generated output for valid inputs and all Human-only,
no-account-assignment, no-live authority fields.

## Acceptance and validation

First run adversarial tests against original production code (RED), then verify
matching real-builder controls, distinct candidate versions, swapped/reused
partitions, stale and resealed invalid content, runtime enums, rejection records,
explicit failure reasons and blind-holdout refusal. Run adjacent research loop,
autonomous generation, discovery and assignment/persistence fixtures.

Commands: targeted `pnpm test --run`, `pnpm lint`, `pnpm typecheck`, `pnpm build`,
`pnpm validate:canon`, `pnpm validate:pr-governance`, both existing consumer-graph
validators and rendered PR governance preflight. Full unit suite is authoritative
on GitHub PR CI. No UI change; no new native DB behavior. Disclose synthetic and
fake-repository scope; no scientific or independent Human acceptance claimed.

## Boundaries

No scientific thresholds, aggregate-independence policy, partition schedules,
holdout, commission/HWM/settlement, DB schema, security, C3, credentials, Org0 or
live enable change. D08 source-window provenance/disjointness, memory/question
lineage and durable research workers remain open under P09/P12/DEE-646. Hashes
verify supplied content consistency, not source authenticity or scientific truth.
User authorized technical corrections and merge after all exact-head checks;
scientific ratification and actual operator launch remain separate gates.

## Local acceptance

Original regression: 38 failures / 3 passes before production changes. Corrected
41 adversarial cases and adjacent research, partition metrics, discovery and
promotion fixtures: 81 tests / 7 files PASS. Independent main-versus-fixed pure
builder probe preserves all five valid candidate, qualification, proposal and
rejection digests; eight invalid combinations now reject. No database or venue
was called by these proofs. The existing loop and discovery cases include fake
repository/knowledge fixtures, not durable worker or scientific qualification.

Lint has 0 errors / 324 existing warnings. Typecheck, build, canon, governance and
both consumer-graph validators PASS. No inventory, authority, workflow or schema
changes; the existing Reality source/consumer seals remain identical. Self-review
only; no independent Human or scientific attestation. Full exact-head PR CI and
rendered-body preflight remain publication/acceptance requirements.
