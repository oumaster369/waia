---
integrationIssue: DEE-862
integrationTitle: "WAIA Admin correction — bilingual Finance Assistant operator parity and Overview/HR loading recovery"
branch: dee-862-waia-admin-finance-assistant-parity
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr, human-production-activation]
executionLabel: backend
requiredValidation: [lint, typecheck, build, cloudflare-build, targeted-unit, e2e, canon, pr-governance]
approvalGates: [scope-approved, integration-ready, human-merge, human-production-activation]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-08-30T11:09:03Z"
  blockedReason: null
  nextAction: "Obtain the Human integration checkpoint, then create one commit, push the isolated DEE-862 branch and open one PR to main; do not activate production before the separate Human checkpoint."
provenance:
  createdFrom: human-approved-chat-2026-08-30
  gapRegistry: null
  supersedes: null
---

# DEE-862 — WAIA Admin Finance Assistant parity and loading recovery

## Approved outcome

The protected WAIA Admin reliably loads Finance Overview and HR. Its Finance Assistant understands
Russian and English, produces concise reports, asks a precise follow-up when required data is
missing, and can prepare every deterministic accounting action available to an authorized Finance
operator. Every mutation remains a preview until the same authenticated Human explicitly confirms
it; the server revalidates role, tenant, current records and the action before writing an audit
receipt.

AI-TRADER routes, navigation, schema, worktrees and operational controls are frozen outside this
integration.

## Work packages

### WP-0 — Scope and isolation

- Use one Linear issue, one canonical plan, one isolated branch and one integration PR.
- Start from current `origin/main`; do not mutate any AI-TRADER branch or worktree.
- Keep production data, secrets, watcher state and deployment behind a separate Human checkpoint.

### WP-1 — Overview and HR recovery

- Identify and correct the server-side request path causing Finance Overview and HR to remain in a
  permanent loading state.
- Bound every client request with a timeout and explicit retry/error state so the UI can never spin
  indefinitely.
- Preserve current authorization, RLS, tenant boundaries and resource disposal.

### WP-2 — Bilingual Finance operator

- Accept Russian or English natural-language requests and return in the operator's language.
- Support concise Overview, budget and transaction reports rather than raw internal objects.
- Support guided follow-up for missing or ambiguous fields without guessing financial facts.
- Cover deterministic Finance records and review operations exposed to an authorized Human:
  counterparties, accounts, categories and monthly limits, projects, transactions, classifications,
  statuses, verified balance checkpoints, public transaction-detail controls, Finance presentation
  settings and public watched-address records.
- Require `admin.treasury.publish` in addition to mutation permission for every public Finance
  setting and verified balance checkpoint.
- Exclude custody/money movement, secrets, role grants, watcher activation/deactivation, deployment,
  deletion and AI-TRADER from assistant authority.

### WP-3 — Confirmation, authorization and audit

- Keep all writes preview-first with a short-lived, single-use confirmation receipt bound to actor,
  organization, intent and normalized arguments.
- Re-check permissions and referenced records at execution time and call the same server domain
  services used by the manual Finance UI.
- Record success and denial outcomes without logging secrets or sensitive free text.

### WP-4 — Qualification and integration readiness

- Test Russian/English planning, follow-up, concise reports, every supported write family, replay
  prevention, role/tenant isolation and no AI-TRADER access.
- Test bounded Overview/HR failures and successful recovery in unit, Postgres integration and E2E.
- Run lint, typecheck, build, canon and PR-governance gates.
- Prepare one integration PR and stop at the applicable Human checkpoint before production
  activation.

## Production boundary

This work does not change production data, secrets, watcher state, migrations or deployment while
being implemented. Production activation must use the exact reviewed commit after the required
Human checkpoint and must include authenticated Overview, HR and Finance Assistant smoke tests.
