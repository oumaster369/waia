---
integrationIssue: DEE-1085
integrationTitle: "Readable saved news and Russian strategy evidence labels"
branch: dee-1085-admin-news-text
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1085
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
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
  lastValidationAt: null
  blockedReason: null
  nextAction: "Validate canonical read and new-version normalization, then require exact-head CI and production verification."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1085 — readable publisher text

Authenticated production overview on `dfaa3d4e` displays CoinDesk headlines with literal `<![CDATA[...]]>` delimiters. The console stores the shared RSS client's text verbatim. This packet removes only that text-container markup using one console helper before future-version hashing and when presenting existing versions through the canonical news handler. Literal text, source, URL and observation/publication timestamps are preserved.

## WP-1 and acceptance

The existing collector test checks that wrapped and ordinary copies of the same headline have the same content hash, while changed content still creates a version. The real Postgres handler fixture contains the observed wrapper and verifies normalized title/summary, unchanged source/time/link, and untouched stored historical text. The shared RSS connector, research behavior, schema, historical records, financial policy, grants and commands are out of scope. No HTML rendering is introduced.

Run focused collector and Postgres tests, lint/typecheck/build, existing browser acceptance, canon and rendered PR governance. Merge after all exact-head CI under the user's express operational delegation, deploy verified main, and inspect actual published news text. This packet is independent of the separate financial correction in PR #652.

Authenticated strategy-card acceptance also showed raw `rejected` and `completed` states. Add Russian presentation labels to the existing evidence table, retain the machine state in the title and preserve unknown states. A completed test remains «Тест завершён», never a promotion recommendation. No underlying state or categorization changes.
