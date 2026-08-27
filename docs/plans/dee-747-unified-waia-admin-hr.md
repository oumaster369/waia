---
integrationIssue: DEE-747
integrationTitle: "Unified WAIA Admin — role-scoped Finance/HR and Work plan applications"
branch: dee-747-unified-waia-admin-hr
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
  status: blocked
  currentWorkPackage: null
  completedWorkPackages: [WP-0]
  remainingWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: "DEE-731 must be Human-merged before the DEE-747 main-based integration branch opens."
  nextAction: "After DEE-731 merge, branch from current origin/main and complete the protected Admin/HR batch."
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

## Rollback

Disable public application intake, retain audit/history rows, and revert the squash commit. Never
delete applications or HR history as a rollback shortcut.
