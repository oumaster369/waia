---
integrationIssue: DEE-1253
integrationTitle: "Bounded V5 fills and financial bills under one explicit binding"
branch: dee-1253-bounded-v5-fill-bills
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [focused-unit, scoped-lint, typecheck, consumer-graphs]
approvalGates: [plan-approved, independent-review, integration-ready, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: independent-review
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [independent-review]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Independent review of the bounded combined configuration before integration."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1253 bounded combined source observation

## Scope

An explicitly authorized V5 configuration can currently request fills or financial bills, but not both. Permit both for at most seven configured fill contracts. Keep the legacy eight-contract maximum without financial history. The combined worst case is 30 logical requests: three base values, two ordinary-order pages, ten algo-order pages, fourteen fill pages and one bills page. Existing 31-request and 120-second ceilings remain unchanged, including fresh admission on every route/page.

This is an observation source change under DEE-1231. Configuration/manifest identity, expected UID, current binding, permission, finite financial scope, expiry and response cleanup remain mandatory. No active configuration, consent, reader deadline, rate limit or production artifact is changed by this source preparation.

## Acceptance

- Configuration schema and direct reader reject eight-contract combined inputs before a request; DTO validation rejects eight-contract combined results. Seven-contract combined inputs succeed within the existing budget.
- Existing fills-only and bills-only configurations retain their identities and behavior.
- Combined results retain distinct original windows, PARTIAL/UNKNOWN coverage, raw signed currencies and null PnL. No fill/bill reconciliation or full-period claim is introduced.
- Scope expiry, changed UID and current-binding revocation remain fail-closed with both sources configured.
- Focused hermetic tests and affected consumer-graph checks pass; independent review remains required before integration.

## Validation and remaining work

Run only focused reader/configuration tests, scoped lint, typecheck and affected graph checks. No full local suite, build, provider, database, runtime or trading actions belong to this task.

The focused financial-ingestion, V5-reader and Reality V2 consumer-graph files pass 82 tests. Scoped ESLint and TypeScript `--noEmit --incremental false` pass. New cases cover seven-contract combined request count (30), unchanged eight-contract fills-only count (31), the 120-second whole-read deadline, combined DTO acceptance and rejection, separate windows, configuration/manifest identity, scope expiry, UID changes and revocation. Independent review and PR CI remain pending.

HTX's official [financial-record documentation](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-19b930b8bee) documents a query ID and page size but does not establish exhaustion or snapshot completeness. Preserve UNKNOWN rather than infer complete history. Durable period coverage, market enumeration, fill/fee/funding/transfer accounting, daily basis/FX and explicit new-account history enrollment remain separate work in DEE-1233/DEE-638 and the account onboarding boundary. Billing policy and manual invoice authority are unchanged.
