---
integrationIssue: DEE-971
integrationTitle: "Separate execution-host installation from historical activation"
branch: dee-971-idle-installation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-08T17:27:00Z"
  blockedReason: null
  nextAction: "Publish PR for exact-head CI and Human review; no merge or deployment."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Approved boundary

On 2026-09-08 the Human approved a separate minimal PR after inspection of
main `91d9cda0b388bc3c84a7c6151eecd30af58c8fb5`: ordinary deployment
unconditionally launches the approved historical consumer, including scientific
finalization. This conflicts with installation-only authority.

No merge, deployment, scientific computation, migration, exchange credentials,
live trading, capital, blind holdout or Human-gate bypass is authorized here.
DEE-920 remains the production acceptance parent; DEE-967 is already merged.

## WP-1: installation and activation are different states

- Default supervisor mode is `idle`; historical consumption requires explicit
  `WAIA_EXECUTION_HOST_MODE=historical-v2-ratified-one-shot`.
- Preserve full exact-SHA, runner LOGIN, run/org, checkpoint and forbidden-authority
  validation in **both** modes. Parsing configuration is not a DB connection.
- Idle opens only the health listener; no child/science/DB/run consumption. Its
  health is `installed`, `executionReady=false`, consumer `idle`, no claimed run.
- Active mode uses the same canonical consumer and existing ratification gates.
- Deploy helper defaults to idle, accepts an explicit mode argument (not an
  inherited environment default), overrides env-file mode in preflight/start,
  validates mode-specific health and records the mode with the deployed revision.
- Preserve scientific preparation as a separate explicit command with strict
  runtime preflight. Idle is neither runtime qualification nor historical PASS.
- Update operator runbook and targeted regressions. No UI/scientific changes.

## Evidence and completion

Targeted supervisor + exact-SHA/deployment tests, including actual HTTP idle
listener and fake-Docker invocation tests; shell syntax, lint, typecheck, build,
PR governance preflight/regression tests, independent read-only review, then
authoritative full GitHub PR CI. No redundant full local unit suite.

Local implementation evidence: 50 targeted tests PASS (including actual HTTP
listener and fake-Docker invocation tests), typecheck PASS, build PASS, lint
0 errors/307 warnings, shell syntax and diff-check PASS, PR governance preflight
and regressions PASS. Sandbox initially denied the local test/build listener;
rerunning with local-port permission passed without changing code or assertions.
Independent review of the implementation diff found no actionable P1/P2; final
commit binding and full PR CI remain distinct gates, recorded in Linear/PR.

## Remaining product gates (not delivered by this PR)

Separate exact release installation approval, verified image/storage/runtime,
authorized scientific preparation on unchanged full data, qualified proposal,
Human ratification, historical run/repeat and Admin/tenant observation parity.
HTX account collection/streaming (DEE-960/961) and recurring live capital authority
(DEE-639) remain separate. Adaptive strategy learning (DEE-646) is deferred from
the first historical acceptance scope.
