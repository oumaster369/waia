---
integrationIssue: DEE-1022
integrationTitle: "AI-TRADER H2 0206 — leftover permissive ALL policy waia_historical_runner_org_scope bypasses Brier admission"
branch: dee-1022-h2-org-scope-hygiene
riskTier: T4
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation:
  [lint, typecheck, targeted-unit, targeted-postgres-integration, build, canonical-docs, pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge, separate-production-hygiene-ceremony]
includedIssues: []
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
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Validate, open one PR to main, Human squash-merge, then run the production hygiene ceremony. Do not retry 0206 until hygiene returns SELECTED_STEP_COMMITTED."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  parentIssue: DEE-960
---

# DEE-1022 — leftover org-scope hygiene

## Exact starting point

Partner Alpha0 H2 0205 committed. Exact 0206 refused before COMMIT with
`CATALOG_DIGEST_MISMATCH:0206:13402691…` versus frozen `27a38ce5…`. Named Brier policy identity
passed. Live leftover `waia_historical_runner_org_scope` (`FOR ALL`, permissive, runner, org UUID)
exists on 28 relations, including `trader_scientific_admission_receipt_v1`. That name is absent from
git SQL. Fitting the digest is forbidden.

## Human Architect decision

- Hygiene is a **separate** Human-gated operator. Do not edit 0205–0211 SQL or journal identities.
- Hygiene = **DROP only** of the frozen leftover name. Do not recreate `org_select_v2` on 0201
  exact-run tables. Do not invent SELECT on `trader_lifecycle_events`.
- Named 0206/0207/0208 verification must refuse extra INSERT-applicable runner policies and any
  remaining leftover name, so a future leftover cannot hide behind a digest mismatch.
- Production 0206 retries only after this PR is Human-merged **and** hygiene
  `SELECTED_STEP_COMMITTED`.

## Work packages

### WP-1 — frozen leftover identity

Pin the 28 relations, USING/CHECK, KEEP `org_select_v2` remainder, exact-run remainder, and extra
INSERT classifier.

### WP-2 — hygiene operator + named H2 refuse

Add `pnpm trader:h2:org-scope-hygiene` with distinct attestation schema/trust path. Patch H2 catalog
verification for 0206/0207/0208.

### WP-3 — evidence and handoff

Unit tests, owned-local negative 0206 extra-INSERT test, operator runbook, one PR to `main`.

## Protected boundaries

- Do not retry production 0206 from this implementation task.
- Do not apply 0211, mutate C3, Execution Server, venues, capital, or holdout.
- Do not ad-hoc DROP from `psql`.
- Do not replace digest `27a38ce5` with `13402691`.
