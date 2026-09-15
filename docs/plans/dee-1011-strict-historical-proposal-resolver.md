---
integrationIssue: DEE-1011
integrationTitle: "Historical proposal: bind strict O/P/R releases before preparation"
branch: dee-1011-strict-historical-proposal-resolver
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, linear, github-pr]
executionLabel: backend
requiredValidation: [lint, typecheck, build, unit-targeted, canon, pr-governance, authoritative-pr-ci]
approvalGates: [human-scope-authorization, integration-ready, human-squash-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-15T09:45:26Z"
  blockedReason: null
  nextAction: "Commit, push, open one PR to main, then stop at the Human squash-merge gate."
provenance:
  createdFrom: chat
  gapRegistry: GAP-A
  supersedes: null
---

# DEE-1011 — strict historical proposal resolver composition

## Authority and boundary

Human authorized this independent implementation lane on exact base
`b10f7edcb2187253355399ca5dfb82bac0177c12`. It closes GAP-A only: proposal
preparation must not begin until one externally pinned canonical manifest binds
the proposal organization/run to exact, distinct O/P/R release, Git tree,
covered-source, evidence-root, and runtime identities.

This batch does not execute C1/C2/C3, connect to `waia-org0-exec`, mutate P2 or
any forensic/operator/AI-TWIN worktree, apply migrations, change Forecast or
scientific law, grant authority, ratify, finalize, bootstrap, or launch a
consumer.

## Work packages

### WP-1 — immutable O/P/R binding

- Add a standalone Node-only binding verifier with canonical serialization and
  an independently supplied expected manifest digest.
- Require all three namespaces. Reject unknown/ambiguous fields, collapsed or
  mixed identities, floating revisions, checkout substitution, dirty tracked
  trees, wrong Git tree, wrong covered-source digest, wrong evidence-root seal
  identity, and wrong runtime.
- Keep the preserved O release historical fact pinned to
  `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67`.

### WP-2 — frozen R proposal composition

- Verify every immutable binding before loading application code.
- Load only the allowlisted proposal APIs from the verified R source checkout.
- Construct `createStrictScientificEvidenceResolverV1` from exact O/P/R
  evidence roots, then execute `runHistoricalTechnicalProposalCliV2` and
  `prepareHistoricalTechnicalProposalOnExecutionServerV2` inside
  `withStrictScientificResolverV1`.
- Expose no checkpoint builder/fallback and no finalization/bootstrap/consumer
  capability in the selected API.

### WP-3 — adversarial proof and handoff

- Prove exact binding and strict-path entry.
- Refuse missing/wrong O, P, R, source/tree, evidence-root, runtime,
  organization/run, resolver, builder fallback, current-checkout substitution,
  and mixed identities.
- Prove tests require no server, schema, migration, authority, admission, or
  finalization side effect.
- Run targeted tests, lint, typecheck, build, `validate:canon`, and
  `validate:pr-governance`; then open one PR to `main` and stop at Human
  squash-merge.

## Impact contract

- `R_IMPACT=NONE`: R is read and verified as a frozen API/evidence identity;
  evaluator/bootstrap/finalization mathematics are unchanged.
- `P2_IMPACT=NONE`: no producer execution or state mutation.
- `SCIENTIFIC_PROTOCOL_IMPACT=NONE`: composition and fail-closed identity
  verification only.
