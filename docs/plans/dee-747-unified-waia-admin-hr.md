---
integrationIssue: DEE-747
integrationTitle: "Unified WAIA Admin — role-scoped Finance/HR and Work plan applications"
branch: dee-747-unified-waia-admin
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr, human-production-activation]
executionLabel: backend
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, canon, pr-governance]
approvalGates: [dee-731-human-merge, integration-ready, human-merge, human-production-activation]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in_progress
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3]
  remainingWorkPackages: [WP-4]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: "Human requested that no DEE-747 PR open while any AI-TRADER PR remains open."
  nextAction: "Finish qualification, then refresh origin/main and rebase/renumber if needed after the AI-TRADER PR train merges; open one DEE-747 PR only when that queue is clear."
provenance:
  createdFrom: human-approved-chat-2026-08-27
  gapRegistry: null
  supersedes: null
---

# DEE-747 — Unified WAIA Admin and HR

## Approved outcome

One protected WAIA Admin shell uses the shared WAIA identity and server-owned least-privilege grants.
It begins with Finance and HR and deliberately excludes AI-TRADER Admin. The public Work plan remains
read-only while accepting safe team applications into an auditable HR funnel. This is PR 2 of the
Human-mandated two-PR completion sequence.

## Work packages

### WP-0 — Dependency and scope freeze

- DEE-747 is blocked by the Human merge of DEE-731.
- Reuse the existing DEE-673 cached, allowlisted Linear projection; never embed Linear or expose its
  token.
- Freeze AI-TRADER Admin, Execution Server and production data as no-touch surfaces.

### WP-1 — Module grants and shared shell

- Add server-owned SUPER_ADMIN, FINANCE_ADMIN and HR_ADMIN grants with grant/revoke audit fields.
- Bootstrap the Human-approved super-admin through verified server identity, never user metadata.
- Add right-side Finance/HR module navigation and route-level authorization.
- Keep Finance internal navigation and data ownership unchanged.

### WP-2 — Work plan participation intake

- Keep project/task status read-only and grouped in the WAIA visual language.
- Add a validated, consent-versioned application form for task, milestone or project participation.
- Capture contact, competencies, experience and proposed collaboration terms without public
  disclosure.
- Add an explicit abuse-control and rate-limit boundary.

### WP-3 — HR funnel and immutable history

- Create the ordered funnel: New application, Interview, Contract, Work, Payment, Termination.
- Add accountable assignee and list/filter/detail views.
- Record comments, status and assignee changes as append-only actor/timestamp history.
- Deny hard delete and cross-module/cross-tenant access.

### WP-4 — Qualification and integration

- Prove super-admin and module-limited access in unit, Postgres isolation and Playwright tests.
- Prove public intake validation and private HR data boundaries.
- Run lint, typecheck, build, canon, migration and PR-governance gates.
- Open one PR to main and stop for Human squash merge/production activation.

## Authorization design

The database grant is authoritative for ordinary staff. Bootstrap super-admin identity is evaluated
server-side from a verified auth email and immediately receives all module permissions; it is never
read from client-controlled Supabase user metadata. RLS remains deny-by-default for browser roles.
DEE-747 roles authorize only the shared Finance/HR surface; they never confer AI-TRADER Admin
permissions. Existing AI-TRADER authorization remains unchanged and outside this integration.

## Production rollout order

1. Keep the current production application version live while applying additive migrations
   `0174` and `0175` through the Human-approved targeted Supabase procedure.
2. Verify the three tables, deny policies, immutable/history triggers and the
   `oumaster369@gmail.com` SUPER_ADMIN bootstrap row.
3. Deploy the exact reviewed application version, then verify `/waia-admin`, `/finance`, `/hr` and
   public `/work-plan` intake with no AI-TRADER Admin regression.
4. If intake must stop without deleting data, set `WAIA_PUBLIC_TEAM_APPLICATIONS_ENABLED=false`.

## Rollback

Set `WAIA_PUBLIC_TEAM_APPLICATIONS_ENABLED=false`, roll back the application version, and retain
all additive schema, applications, audit and history rows. Never delete applications or HR history
as a rollback shortcut; dropping `0174`/`0175` objects is not an approved operational rollback.
