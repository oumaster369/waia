---
integrationIssue: DEE-1237
integrationTitle: "Gate manual HTX sync on stored read policy before decrypt"
branch: dee-1237-manual-htx-sync-policy
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, mocked-connector]
requiredValidation: [lint, typecheck, build, targeted-unit, validate-pr-governance]
approvalGates: [integration-ready, independent-review, human-merge]
includedIssues:
  - id: DEE-1237
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-11T21:09:31Z"
  blockedReason: null
  nextAction: "Root verifies the complete 12-path package and publishes; exact-head CI and Human merge remain pending."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1237 — Manual HTX sync policy before decrypt

## Context

The three authenticated manual HTX sync handlers load tenant-scoped active credential metadata, then decrypt before checking the stored HTX permission policy. The existing metadata-only resolver already validates exact venue, row-account binding, purpose, scopes, and forbidden permissions. This plan closes only the manual-read ordering gap.

## Acceptance

Use one shared HTX-specific read-policy check after the active metadata lookup and before credential decryption for balances, positions, and trade history. Missing, malformed, unsafe, contradictory, or row-account-mismatched policy returns a generic client error before decrypt, connector construction, or venue calls. Preserve v1 spot Read+Trade and v2 observation policies for reads. Keep tenant/membership checks, active-row checks, exact account binding, fresh venue credential validation, data acquisition, and snapshot behavior.

Tests prove each handler refuses missing policy before decrypt and connector creation; helper coverage exercises malformed metadata, mismatched account, unsafe scope/flags, v1 purpose conflict, and invalid v2 purpose/shape. Positive balance-handler tests carry both v1 Read+Trade and v2 observation metadata through fresh validation and a mocked balance read. Existing position/trade success tests continue to cover their paths. Synthetic credentials and mocked venue only.

## Boundaries

No generic credential-service policy change, real venue calls, trade/execution authority, database migration, credential mutation, production rollout, or change to the existing fresh venue authority. Human reviews and merges the PR; no publication while independent review is pending.

## Validation

Local validation ran against an uncommitted worktree diff based on `b4e629a10425474e20de0ac57d5a775fe69cb5a6`; `lastValidatedGitSha` remains null because no commit represents the reviewed worktree. Targeted Vitest passed (4 files, 62 tests); scoped ESLint passed; typecheck passed; full lint passed with 0 errors and 337 warnings; a fresh `next build` passed; `validate:pr-governance`, rendered-body preflight, and `git diff --check` passed. Independent reviewer approved all 11 code/test paths in review receipt `c250e5f54ccfbb22b5deb696c4852bb550399ca9da114c55c3cd264a3b5a96cc`. Root's final review of all 12 paths including this plan, commit, push, exact-head CI, and Human merge remain pending. Full unit suite was not run locally because PR CI is authoritative.
