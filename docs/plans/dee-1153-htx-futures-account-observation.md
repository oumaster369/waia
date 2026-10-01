---
integrationIssue: DEE-1153
integrationTitle: "AI-TRADER: read-only HTX futures account visibility in Admin and user cabinet"
branch: dee-1153-htx-futures-observation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, native-pg17-validation]
requiredValidation: [focused-unit-tests, tenant-isolation, lint, typecheck, build, e2e, canonical-docs, independent-security-review, exact-head-required-checks]
approvalGates: [migration-0229-production-prohibition-resolved]
state:
  status: in-progress
  currentWorkPackage: integration-review-and-acceptance
  completedWorkPackages: [read-only-foundation, v2-projection-service, shared-admin-cabinet-display, synthetic-native-pg-fixtures]
  remainingWorkPackages: [independent-security-review, current-integration-validation, migration-0229-sequence-resolution, exact-head-ci-and-rollout]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: "Production application of migration 0229 remains prohibited; resolve its assignment and sequence before rollout."
  nextAction: "Complete independent review and current exact-head checks; reconcile the migration 0229 prohibition before any production rollout."
provenance:
  authoritativeBase: a20bfcce288dd96948aa01102b7467945812116e
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1153 — read-only HTX derivatives account visibility

## Authorized boundary

The user's 2026-10-01 request authorizes HTX futures account display in Admin and the user cabinet for visibility only. It does not authorize derivatives trading, transfers, leverage or position-mode changes, futures capital/risk/Reality decisions, or claims of trading readiness. Technical fixes, merge after required checks, and a non-trading production deployment were authorized; production rollout remains blocked by the specific migration-0229 production prohibition recorded for this work.

The four supported read families are USDT isolated perpetual, the shared USDT cross-margin pool, coin-margined perpetual, and coin-margined delivery futures. The shared USDT cross-pool response contains perpetual and delivery contract detail beneath one top-level account balance: display the top-level pool once and never add either detail collection to it. Preserve each family and collateral asset; do not aggregate across families or currencies. Derivatives identities are separate from HTX spot account IDs.

## Implemented scope

- A server-only transport exposes only four fixed account-info reads on `api.hbdm.com`, with the documented fixed request method/path/body and signature bound to that host. It has bounded response size and timeout, abort/dispose handling, no arbitrary URL or request body, and no write/transfer/order endpoints.
- Strict family parsers preserve decimal tokens, reject malformed or duplicate-key JSON, enforce family identity/currency consistency, and project only allowlisted account fields. Missing/null metric fields remain unavailable; an empty successful account response remains distinct from zero. HTX `ts` is response-generation time, not per-balance freshness.
- The optional, closed `htxDerivativesFamilies` configuration is sealed into the exact assignment manifest and configuration revision. A derivative read receives exact organization, credential revision, selected family and key-digest admission; spot account/key metadata alone does not enroll or select a derivatives family. The key must pass fresh strict read-only metadata admission, and each configured-family read is admitted again against the current binding. No credentials or live exchange API were used for validation.
- A v2 account-observation projection is validated through the existing bounded JSONB observation row and reader. Legacy v1 remains readable and unchanged; v1 responses do not fabricate derivative values and the presentation identifies unobserved families as `NOT_CONFIGURED`. This slice adds no table, migration, database role, or grant. The local PostgreSQL proof uses the repository's local-validation schema, not numbered production migration 0229.
- The service reads only configured families sequentially under the existing lease/revision/cancellation fences, records per-family read timing and safe errors, keeps transport failure as `ERROR` with null accounts, and validates the whole assembled projection before commit. A valid partial account result may retain rows with unavailable fields. Missing required account balance is partial; missing optional metrics remain null without downgrading a valid family read. Cleanup owns at most 20 live derivative readers and refuses additional work when cleanup has not settled.
- The shared Admin/cabinet account-observation panel renders the same family-scoped projection. It shows shared-pool totals once, exact decimal strings, null versus zero, stale/partial/error/empty states and fixed safe error text. Revocation removes derivative amounts from the response even when immutable history remains in JSONB. No cross-family total is displayed.

## Evidence and limits

- The saved UI-slice receipt records 139 focused tests passed, one Playwright test passed, typecheck passed, targeted ESLint passed and a clean diff check. These counts describe that recorded UI validation snapshot, not an exact current-head CI result.
- The local native PostgreSQL 17 receipt records 36/36 tests passed, 0 failed, 0 skipped, including the three synthetic configured-futures projection tests. That run used the local-validation DDL and predates later lifecycle hardening; it is not proof for migration 0229, production privileges, or the current exact head.
- Earlier configured service/runtime and reader/admission suites have individual focused receipts, but no single current exact-head aggregate receipt is asserted here. Re-run required focused checks on the integration head and preserve exact logs/counts; do not infer a configured-runtime total from unrelated suite counts.
- No production database, production credential, real HTX account endpoint, or market/result data was used. Passing tests and a JSONB field named `status` do not establish operational or scientific readiness.

## Acceptance

Implementation scope is present, but DEE-1153 is not integration-ready or production-ready. Remaining acceptance requires current exact-head unit and tenant-isolation checks, lint/typecheck/build, Admin and cabinet e2e coverage, native PostgreSQL evidence against the approved migration/role design, independent security review of the new read-admission and family boundaries, and exact-head required CI checks. The existing native prototype only proves the local-validation schema path.

DEE-1032's dynamic credential inventory and derivatives-family enrollment remains open and out of scope; this implementation accepts only explicitly configured manifest families and must not claim all eligible accounts are discovered. Reconcile the ordered migration queue and resolve the explicit 0229 production-application prohibition before rollout. Do not add/apply a migration, widen roles, start a derivatives collector, or activate a family without that sequence review. No new blanket human-permission gate is introduced: once the concrete implementation passes the stated checks and the 0229 prohibition is resolved, the user's existing authorization covers merge and non-trading production deployment.
