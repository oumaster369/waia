---
integrationIssue: DEE-648
integrationTitle: "Forecast Model Registry and Challenger Arena"
branch: dee-648-forecast-challenger-arena
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  - focused-negative-tests
  - one-full-fresh-sqlite-suite
  - independent-exact-head-review
  - authoritative-ci
  - dee-653-exact-head-admission
approvalGates:
  - ratified-scope
  - integration-ready
  - dee-653-exact-head-admission
includedIssues: [DEE-748]
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: 503
  prUrl: https://github.com/oumaster369/waia/pull/503
  lastValidatedGitSha: e763402a177d24404afd773a0d6d224fd2836d5f
  lastValidationAt: "2026-08-27"
  blockedReason: null
  nextAction: "Complete exact-head full-suite and authoritative CI/DEE-653 gates, then squash-merge only when all pass."
provenance:
  authoritativeBase: b62f8e6432a62227902007b4e97f8bf746360822
  createdFrom: ratified-linear-scope
---

# DEE-648 — Forecast Model Registry and Challenger Arena

## Admission and frozen boundary

Base: `b62f8e6432a62227902007b4e97f8bf746360822`. Duplicate/ownership/dependency audit found DEE-648 as the sole remaining owner; DEE-648A/DEE-741 owns contracts and persistence, DEE-647 owns Predictive Admission, DEE-632 owns production Forecast authority, and DEE-539 owns package selection. This change owns research-only registry, adapter and arena code.

The only mathematical predictor permitted by the merged input contract is `anchorRealizedVol20m_1m`; HypothesisAssessment remains applicability-only. All trials bind the exact Terminal and 13-D Execution Opportunity target digests, common PIT anchor, literal algorithm, deterministic failures, fixtures and resource budgets before execution. Holdout, PnL selection and capital promotion are structurally absent.

## Surfaces

- Producer: content-addressed `ModelTrialSpecV2` and deterministic registry.
- Consumer: research-only Forecast V2 adapter and common-anchor arena.
- Qualification: delegates multi-anchor Terminal admission to the existing canonical WF_PREDICTIVE purge/embargo, mandatory-baseline, stationary-bootstrap B=10000 and Holm-FWER harness; joint admission remains DEE-532 and final scientific admission remains DEE-631.
- Replay: digest reconstruction plus exact artifact/spec/input identity binding.
- Persistence: none; merged DEE-648A binding remains the sole selected-package persistence surface.
- Tests: registry conflicts, undeclared/future inputs, target/anchor mismatch, joint/marginal scoring and no-promotion firewall.
- Inventory: only `lib/trader/research/forecast-model-registry/**`, `lib/trader/research/challenger-arena/**`, dedicated unit tests and this plan.

Tier B families remain exact `RESEARCH_ONLY_UNIMPLEMENTED_<reason>` outcomes where no Human-frozen literal trial exists. No formula is improvised.

## Acceptance

- Registry identities are content-addressed, deterministic, and reject duplicate or undeclared inputs.
- Every arena comparison binds one common PIT anchor, partition, target definition, artifact identity, and observed outcome.
- Qualification uses the canonical predictive harness and cannot promote a model to production or capital use.
- Missing Tier B mathematical authority remains an explicit research-only blocked outcome.
- Focused negative tests, one full fresh-SQLite suite, exact-head independent review, authoritative CI, and DEE-653 admission all pass before squash merge.

## Work packages

### WP-1 — Freeze registry and adapter contracts

Define the content-addressed model trial registry and research-only Forecast V2 adapter without persistence or capital authority.

### WP-2 — Implement common-anchor challenger arena

Bind exact artifacts, inputs, targets, partitions, predictive scores, and replay identity for deterministic comparisons.

### WP-3 — Integrate canonical qualification

Delegate Terminal admission to the existing WF_PREDICTIVE harness while leaving joint and final scientific admission with their existing owners.

### WP-4 — Prove failure boundaries and release evidence

Exercise undeclared/future input, target/anchor mismatch, duplicate candidate, and no-promotion paths; complete exact-head review and release gates.
