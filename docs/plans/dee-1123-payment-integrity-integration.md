---
integrationIssue: DEE-1123
integrationTitle: "Payment observation and reconciliation correctness"
branch: dee-1123-payment-proof-integration
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1116
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
  - id: DEE-1117
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 60d38dfa3dd53b21d6fd7d58db8b274b4a065883
  lastValidationAt: "2026-09-26T15:15:44.988538+00:00"
  blockedReason: null
  nextAction: "Complete frozen train readiness and independent full-diff review, publish one PR, then require new canonical-profile executed CI and all applicable checks before merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1123 — payment observation and reconciliation correctness

Parent DEE-638. User explicitly requested fewer coherent PRs, parallel work where safe, independent audits and normal checked merges. This T3 integration starts at accepted main `21a60ec38573f0ca5c535992e9e09392c2aa78c9`, including the shared decimal-syntax correction. The adjacent manifest admits two exact existing source patches before any import into this train. Their original implementations predate this admission and are not retrospectively admitted. Source branches/evidence remain preserved.

## WP-1 — integrate complete observation and exact atomic amounts

Import the six-path DEE-1116 diff from base `1a59b31b620af81b727d28b24f3ddbf9cb953074` to source `2af4d14a5caaaac7db28c98343cefce0b9c74265` unchanged after admission. It enumerates the configured bounded block range completely using the documented event API, validates all pagination and source identity, rejects mixed provider/partial evidence, formats token atomic units exactly and explicitly refuses unsupported quorum before effects. Preserve existing chain finality/default windows/checkpoint and tenant/ledger semantics. Its plan has the complete reviewed contract and prior proof provenance; no current live-provider or native acceptance is inferred from unit tests.

Run cumulative scope on the new branch, including current shared numeric and scheduler/factory/health/ledger companions. Record the exact import commit and source blobs; do not mark the child Done before merge.

## WP-2 — integrate exact reconciliation and server-owned cooling

Only after WP-1 acceptance, import the six-path DEE-1117 diff from the same prior base to source `997b5a9084a9a30f7cf5af188723685adadbd16c`. Compare valid fee/settlement decimal values exactly while returning the original saved fee text. Refuse any HTTP `coolingOffMs` field before runtime acquisition/effects, preserving the existing server configuration/default and actual command admission checks. No arbitrary new fee/amount cap or positive-only policy is added. The prior plan's statement that DEE1114 was unpublished is historical; current base includes it, and cumulative numeric tests must prove coexistence without altering that history.

Files are disjoint, but both repairs meet shared existing payment/account evidence, so integration is serialized. This ordering is an acceptance dependency, not a invented runtime dependency. Run cumulative tests for both children and actual handlers, then the existing canonical-profile PostgreSQL reconciliation companions with all SQL guards intact. Prior five native cases are historical until freshly executed here.

## WP-3 — complete integrated acceptance and one PR

Freeze delivered commits, exact file union, cumulative check evidence, original source attributions and the immutable pre-import admission commit/path/SHA256 in the adjacent manifest. Validate it with `scripts/linear/validate-integration-train-manifest.sh`. Preserve all incoming mandatory capital suites and their proof guards, including future accepted-base additions. Run scoped tests, full `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm validate:canon`, `pnpm validate:pr-governance`, `pnpm validate:execution-v2-consumer-graph`, `pnpm validate:reality-v2-consumer-graph`, diff check and rendered PR preflight. Full unit/e2e/applicable native proof remains mandatory in exact-head PR CI. Obtain independent adversarial final complete-diff review, not source-review reuse alone. Main changes require normal integration and affected fresh proof. Publish one PR only when ready; never bypass a failed/pending required check.

The exact15 child paths are in the admission manifest, plus only this plan and that manifest owned by the integration batch. All other changes must be separately admitted or excluded. Import commits map to one child each; originals remain on their branches. Keep both children In Progress/In Review and close them only after the integration merge.

## Reviewability and rollback

The pre-import source diff is1427 changed lines across12paths:484 lines are prior plans and699 are tests/helpers;244 production lines remain. This exceeds the approximate800-line target but stays within a narrow two-child payment scope and17 totalpaths after adding three dedicated native-proof files. Each source already has independent review; serial cumulative proof plus final integrated independent review retains reviewability. One Worker code revert restores pre-batch behavior without schema or data rollback. Split before publication if these properties fail. Unrelated Risk/Guardian changes and new Reality delivery/billing authority are excluded.

## Authority and exclusions

User preauthorized technical T3 repairs, tests/audits, rational PR consolidation, checked merge and nontrading deployment. This does not ratify new financial rules or a live system. No rate/fee/HWM/settlement valuation/finality, confirmation quorum, cooling duration, observation page/block/rescan policy, authorization grant, schema, production payment/cursor/history repair, provider/credential, scientific/holdout, C3, trading or live-enablement change. No real financial command is needed for acceptance. Native/heavy tests remain explicitly resource-coordinated by root.


## Revised admission before final integration

The earlier unpublished train530b9fb1c5a51114016e62e2528d96a9c42ea24b and its original admission b5dd7373 remain preserved on dee-1123-payment-integrity-integration. Its exact imports passed167/13 then339/22 scoped cases. Root then discovered the native reconciliation suites require exact loopback54329/waia_validate, while payment/settlement changes do not trigger the existing PostgreSQL workflow and those two suites are not registered there. A new disposable database name cannot satisfy that guard; existing canonical218-migration history must not be rewritten merely to claim fresh schema proof.

This replacement branch starts again at21a60 and commits this expanded admission BEFORE every reimport or CI change. WP-2 additionally owns only a dedicated canonical-profile PostgreSQL workflow, strict two-suite executed-proof script and negative unit tests for skipped/failed/missing/empty/duplicate results. Use the exact existing local/CI identity, all repository migrations on a fresh CI service, deterministic serial suite execution, artifact upload and original connection guards. Run automatically for all relevant payment, settlement, ledger, schema and proof/config dependencies, and support explicit workflow_dispatch. It invokes synthetic existing tests only, no provider or actual financial command. Prior unit/native proofs remain historical; new integrated scope, readiness and independent full-diff review are required, and actual canonical CI must pass before merge. No policy, production semantics, database reset or original source patch modification is authorized.


## Frozen integrated source and cumulative acceptance

Revised pre-import admission c016700b767b3f2f09fb56619edf24e3c6c6397a (manifest SHA2561636398023eb130b35e399ba8dc36ce8672ed473f20bc7df7db991b8cc7dcdb9) precedes every import and CI implementation on this branch. Wave1 exact import601baeaa passed167 scoped assertions/13files, zero skips. Wave2 exact original importbd444f35 followed only after that pass; dedicated native-proof commit60d38dfa then passed342 cumulative assertions/23files, zero skips, including positive and each-suite missing/failed/skipped/empty/duplicate/status controls. Actual source commands/timestamps/results are retained under completion-audit evidence/dee-1123/revised-admission.

The two existing canonical reconciliation suites are now an explicit fresh-service CI gate. It keeps hardcoded guards, applies every migration, runs both suites serially, validates nonempty/all-passed proof and uploads actual result JSON. They have not been executed locally on this integrated source; prior five native assertions from1117 remain historical-only. Fresh exact-head canonical CI is a merge prerequisite, not an asserted local pass. Full local readiness and final independent integrated review remain pending until separately recorded. No production or financial state was changed.


Root complete integrated readiness at4eb5e334 passed342 assertions/23files0skip, lint, typecheck, build, canon, governance, both authority graphs and diffcheck. Initial frozen-manifest invocation used a relative path unsupported by its provenance check; absolute-path invocation passed unchanged content/history, and both logs are retained. Independent review then identified future CI-trigger omissions for actual runtime audit constants and the test server-only stub. Commit0077bfeb changes only the already admitted workflow filters to include all lib/tests/db/scripts plus actual HTTP/configuration dependencies. It neither changes test execution nor transfers native acceptance: new exact-head canonical2 CI remains mandatory. Final independent integrated review and rendered PR preflight follow this metadata freeze.
