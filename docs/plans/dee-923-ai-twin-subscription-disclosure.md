---
integrationIssue: DEE-923
integrationTitle: "AI-TWIN — pre-billing disclosure below the Formation dialogue"
branch: dee-923-ai-twin-subscription-disclosure
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation:
  [lint, typecheck, targeted-unit, build, scoped-e2e, validate-canon, validate-pr-governance]
approvalGates: [human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-06T09:15:00Z"
  blockedReason: null
  nextAction: "Open PR after scoped governance checks; Human merge required."
provenance:
  createdFrom: "Human 2026-09-06 explicit isolated AI-TWIN resume; DEE-922 merged canon"
  gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md
  supersedes: null
---

# DEE-923 — truthful pre-billing disclosure

## Scope and authority

Implement the exact Product Constitution §9 copy below every currently implemented Twin dialogue state. No numeric price, link to an unimplemented pricing page, payment control, consent event, Society connection or billing request. DEE-922 merged as PR #550 / `fe3015a8d19bdb7342115a7355bc3d1bd7128110`.

The Human's 2026-09-06 instruction supersedes the historical blanket wait for Trader completion only for audited, isolated AI-TWIN work. It does not grant merge, deploy, production, new biometric/provider or external-action authority. No periodic automation.

## Acceptance

A signed-in Human can read the terms before Start, during dialogue and on return. Legacy 100%/socialization states continue to show the same terms and produce no payment or network activation. The disclosure is outside the message log/composer payload, has explicit English language metadata, and is readable on desktop/mobile.

No canonical Formation feature flag or Initial Model Review surface exists at the base. Do not invent one: DEE-879 must reuse this presentation component after its own upstream engine dependencies. This batch does not complete DEE-879 or the full v1 F7 no-billing qualification.

## Work packages

- WP-1: source/Linear/overlap audit; failing regression for absent disclosure.
- WP-2: reusable static presentation, component and focused browser coverage.
- WP-3: required checks, real browser inspection, independent review and PR.

## Isolation

Base `ea765a999b5818ffab84ea32024809b0098fdf74`, separate worktree and branch. Main working checkout is untouched. No auth, schema, migration, gateway, shared library, CI or Trader edits. Test server uses a dedicated loopback port, its own SQLite file, fake AI and no live credentials. No production data or server access.

## Validation evidence

- Red: component suite after adding assertions but before implementation: 5 failed / 9 passed, missing the subscription note (2026-09-06).
- Green: 39 targeted unit tests (workspace14, dialogue route18, Diary route7); lint exit0 with308 existing warnings, typecheck exit0.
- Production build succeeded through Playwright webServer startup. Initial sandbox port denial and missing local .data directory prevented that test attempt; retried only the focused browser tests against the existing build and a dedicated SQLite file.
- Chromium:2 passed, desktop1280×900 and mobile390×844, checking Start, submit payload, reload, legacy100%/socialization branches and no observed billing/Society API request.
- Manual local-browser inspection: note below composer, fully visible, outside dialogue log. Synthetic local fixture only. The fake/offline gateway followed its failure path; this does not verify live-provider reply quality. Unit tests cover both reply and error persistence.
- Independent read-only code review: no blocking findings. Full unit suite remains CI-owned; no claim of complete accessibility, biometric, canonical Formation or production qualification.
- Scoped formatting, plan schema, full pnpm validate:canon, whitespace and P0 PR governance preflight passed. Validation covers the implementation working tree atop the exact base; no uncommitted tree is misrepresented as a committed SHA.

## Rollback and handoff

Revert this UI-only PR. No data conversion or runtime configuration needed. Human reviews and squash-merges; deployment is separate. Canon reconciliation is the independent DEE-943 documentation batch.
