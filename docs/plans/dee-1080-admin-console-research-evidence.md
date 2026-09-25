---
integrationIssue: DEE-1080
integrationTitle: "Admin console strategy and research evidence"
branch: dee-1080-admin-console-research-evidence
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1080
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementing
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Verify canonical research/strategy evidence, manual promotion confirmation and exact-head CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1080 — Strategy evidence and research comparison

Context: DEE-1050 C4, AC-09, AC-22–25, AC-34; audit P12/P13. The console currently offers metadata without usable run details/comparison and the inherited promotion form automatically supplies the effective acknowledgement.

## Goal and scope
One canonical, tenant-scoped read model for historical/non-blind backtest details and 2–4 run comparison; structured strategy evidence; Russian governed promotion surface with manual acknowledgement, fetched state version, same-origin JSON and both permissions. Existing Validation Gate remains the only promotion service. Read financial evidence in one REPEATABLE READ READ ONLY snapshot. Protect holdout before any payload query. Expose missing evidence explicitly and separate predictive quality from PnL.

## Do not
No admission/risk/qualification threshold, fee/HWM/settlement policy, live-enable eligibility, holdout access or automatic promotion changes. No production trading/billing/promotion command will be exercised. No file-backed shadow/reasoning access. User explicitly delegates operational review/merge/deploy, not substantive evidence attestations.

## Acceptance
- Scope and mode predicates precede list/detail payload access; foreign run 404. Historical canonical projection reused; backtest blind payload never read.
- Comparison starts with conditions, unknown conditions cannot mean equal. Exact decimal strings, no return/drawdown percentages.
- Detail and assistant use the same readers; selected entity/tab survives Back.
- Promotion acknowledgement initially unchecked, state version read-only, scope changes cancel requests and clear confirmation; mutation requires audit + operations permission, same-origin JSON. Existing request builder/service/CAS retained.
- PG integration tests, browser workflows, typecheck, lint, build, canon and both consumer inventories pass. Exact-head CI green before merge.

## Files / validation
`lib/trader/admin-console/{handlers,research,repositories}/**`, corresponding console routes and components, legacy promotion UI/handler only for the proven permission/confirmation defect, targeted unit/integration/e2e tests.
`pnpm test --run tests/unit/admin-console tests/unit/admin-assistant`; targeted Postgres tests with WAIA_PG_INTEGRATION=1; `pnpm test:e2e:admin-pg`; `pnpm lint`; `pnpm typecheck`; `pnpm build`; `pnpm validate:canon`; `pnpm validate:execution-v2-consumer-graph`; `pnpm validate:reality-v2-consumer-graph`.


Validation 2026-09-25: 277 targeted console/assistant/authority/Postgres tests passed; dedicated research6 Postgres passed; all4 Postgres browser workflows passed including SLO, eight sections, research comparison and unchecked promotion acknowledgements. Production first-cycle historical integration passed13 with1 pre-existing continuation skip, including exact console cash/equity against the committed35-cycle canonical run. Typecheck passed; full lint had only2 purity errors in new cooling-off display, repaired by capturing read time after response; targeted lint then passed. Build3 passed. Fee proof extraction unchanged; no strategy authority, qualification, billing or historical payload mutation. The final integration train will repeat cumulative exact-head gates.
