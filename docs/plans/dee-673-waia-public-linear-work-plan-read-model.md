---
integrationIssue: DEE-673
integrationTitle: "WAIA public Linear work-plan read model"
branch: dee-673-waia-public-linear-work-plan-read-model
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
executionLabel: backend
requiredValidation: [lint, typecheck, build, targeted-unit, canon, pr-governance]
approvalGates: [human-product-decision-2026-08-22, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: 483
  prUrl: https://github.com/oumaster369/waia/pull/483
  lastValidatedGitSha: 4fa533e21b9a07473b4a8e6898a2f5296bb4a4ad
  lastValidationAt: 2026-08-23
  blockedReason: null
  nextAction: "Await green authoritative PR CI on the exact final head, then stop for Human squash-merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-673 — Public Linear work-plan read model

## Authority and goal

The Human product owner rejected an iframe on 2026-08-22. This backend-only batch provides a small server-owned, read-only projection of explicitly public Linear project work for the future `/work-plan` page owned by DEE-618.

Baseline: `origin/main@4a35171820f2ce6bfabae874989ed6557cf525f8` after the Human squash merge of DEE-617 / PR #481.

## Product and security decisions

1. Linear is accessed server-side only through `WAIA_PUBLIC_LINEAR_API_KEY`; the secret never appears in a public DTO, browser bundle, telemetry, or error.
2. `WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST` is mandatory and bounded. Every entry is resolved directly by Linear project id/slug; missing, invalid, duplicate, or oversized configuration fails closed. There is no first-project or workspace-wide fallback.
3. The provider operation is a fixed GraphQL `query`. The public path exposes no generic GraphQL executor, mutation, webhook, browser credential, or Linear write method.
4. The DTO contains only project name and issue identifier, title, Linear URL, status label/type, derived priority label, and an optional due date. Due dates are omitted unless the project is also listed in the subset `WAIA_PUBLIC_LINEAR_DATE_ALLOWLIST`.
5. Descriptions, comments, attachments, assignees, emails, labels, estimates, internal relations, audit history, workspace metadata, and provider ids never reach the public DTO.
6. Results are deterministically grouped by project and status, then sorted by priority and identifier. The provider request and total public issue count are bounded.
7. A short in-process cache avoids polling. A provider failure may serve only the matching allowlist's last successful snapshot for a bounded stale interval; otherwise the response is truthfully unavailable with no project rows.
8. HTTP and telemetry errors are content-free. No provider body, token, project reference, issue value, or error message is logged.

## Non-goals

- no `/work-plan` frontend and no iframe
- no Treasury schema, Finance admin, or financial data changes
- no database migration
- no AI-TRADER, FHV, or Execution Server access
- no webhook, Linear write, production deployment, or autonomous merge

## Work packages

### WP-0 — admission and isolation

- Re-read current governance and Linear DEE-673.
- Confirm no duplicate local/remote branch or open PR.
- Create an isolated worktree from exact `origin/main` without touching main or AI-TRADER worktrees.

### WP-1 — configuration, fixed query and safe projection

- Add bounded server-only configuration with explicit project/date allowlists.
- Add a fixed read-only Linear query with timeout and strict response validation.
- Project provider data into the minimal deterministic public DTO.

### WP-2 — cache and public HTTP boundary

- Add matching-config fresh/stale cache behavior with last-success timestamp.
- Add `GET /api/public/work-plan` with truthful available/stale/unavailable states and content-free telemetry.
- Document server-only environment variables.

### WP-3 — validation and PR readiness

- Cover configuration, allowlist, privacy, date gate, order, bounds, cache, failure, stale expiry, and GET-only/no-mutation structure.
- Run focused tests, lint, typecheck, build, canonical validation, PR governance, and `git diff --check`.
- Open one PR to `main`, move Linear to In Review, and stop for Human squash merge.

## Expected file surfaces

- `docs/plans/dee-673-waia-public-linear-work-plan-read-model.md`
- `.env.example`
- `lib/public-work-plan/**`
- `app/api/public/work-plan/route.ts`
- `lib/observability/waia-runtime-route-telemetry.ts`
- `tests/unit/public-work-plan*.test.ts`

No `db/**`, Finance admin, Treasury, AI-TRADER, FHV, or Execution Server file is in scope.

## Validation

```bash
pnpm exec vitest run tests/unit/public-work-plan.test.ts tests/unit/public-work-plan-http.test.ts
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
git diff --check
```

## Rollback and merge disposition

Rollback is one revert of the DEE-673 squash commit. The public route and server-side Linear reader then disappear; no stored state needs reversal. T3 Human squash-merge to `main` only.
