---
integrationIssue: DEE-772
integrationTitle: "Knowledge Navigator V2: minimal-sufficient question-relative Knowledge selection"
parentIssue: DEE-601
branch: dee-772-knowledge-navigator-v2
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementing
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Open one PR to main for the pure Navigator primitive. Do not wire Forecast/Decision, mutate Knowledge, bypass Predictive Admission, or touch H2/C3/capital."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-772 — Knowledge Navigator V2

## Goal

Create the sole deterministic authority that selects the **minimal sufficient** Market Knowledge
subset for one exact market question, purpose, tenant and PIT cycle. Output is a content-addressed
`KnowledgeSelectionReceiptV2`. No valid receipt means no downstream epistemic admission.

## Canon check (Linear vs code)

- DEE-771 append-only Knowledge versions are on `main` (`8121eef5`). Navigator **reads** versioned
  identities; it never calls `planKnowledgeEdgeVersionAppend` or legacy MKB mutation.
- DEE-645 Information Need Planner is Done. Navigator consumes the plan digest and question ids; it
  does not re-plan source acquisition.
- DEE-647 Predictive Admission remains the Forecast gate. Navigator cannot bypass it and cannot
  emit probability, economics, Risk, Execution or capital fields.
- DEE-773 owns qualified future-cycle Δ. Navigator must treat `QUALIFIED_VERDICT_UPDATE` as
  already-persisted Knowledge, not apply a delta.

## Non-goals

- No Knowledge mutation, no `0211` production apply, no H2/post-H2, no C3, no Execution Server.
- No Forecast probability, Decision, Risk, live, holdout or billing.
- No wiring that lets Forecast/Decision import `queryMkbReadModel` as a silent injection path.
- No schema migration unless a reproduced blocker proves it unavoidable (STOP).

## Work packages

### WP-1 — receipt + selector

Pure function `selectKnowledgeForQuestionV2`:

- tenant / symbol / question isolation;
- PIT `pitEventAt <= pitAnchor` (no lookahead);
- drop RETIRED / stale / missing digest / irrelevant;
- contradiction → `UNKNOWN_UNRESOLVED` rather than a synthetic pick;
- redundancy: same content digest keeps one identity;
- bounded evidence budget; smallest sufficient set;
- explicit `INSUFFICIENT_EVIDENCE` when nothing admissible remains.

### WP-2 — consumer inventory

Static inventory of Navigator producers/consumers. Negative tests: Decision/Risk/Execution/live
must not import the selector; Predictive Admission / Forecast must not import raw MKB query as a
replacement for a Navigator receipt.

### WP-3 — inquiry-plan binding + tests

Bind `informationNeedPlanDigest` and purpose into the receipt. Deterministic replay, isolation,
budget, stale/missing/contradiction fixtures.

## Protected boundaries

- `docs/ops/H2-ONE-STEP-MIGRATION-OPERATOR.md` and production journal are out of scope.
- DEE-1022 leftover `waia_historical_runner_org_scope` is a separate H2 hygiene issue.
