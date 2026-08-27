---
integrationIssue: DEE-731
integrationTitle: "Breath completion — live runway, support intents, patrons and public transparency"
branch: dee-731-breath-completion-correction
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr, human-production-activation]
executionLabel: backend
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, canon, pr-governance]
approvalGates: [human-product-approved-2026-08-27, integration-ready, human-merge, human-production-activation]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3, WP-4, WP-5]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: 2026-08-27
  blockedReason: null
  nextAction: "Open the single DEE-731 PR and stop for Human squash merge; production activation remains separate."
provenance:
  createdFrom: human-approved-chat-2026-08-27
  gapRegistry: docs/gaps/breath-of-waia-gap-registry.md
  supersedes: null
---

# DEE-731 — Breath completion and public participation

## Approved outcome

The homepage keeps the approved WAIA artwork and breathing wave while publishing only confirmed
Treasury truth. A living seconds-level runway, support intent, patron share, public budget,
transactions and Foundation explanation form one coherent public participation journey. This is PR
1 of exactly two directed by the Human product owner.

## Frozen boundaries

- Public support is non-custodial: the application never signs or broadcasts a transfer.
- TronGrid is the only chain-observation provider. TronScan is a read-only explorer link.
- A payment intent is not a payment and never becomes verified financial truth automatically.
- Public patron identity requires a verified contribution and explicit publication consent.
- Current balances, budgets, allocation and runway fail closed when their authorities are absent or
  stale.
- No production migration/data apply, deploy, watcher activation or secret write belongs to this PR.
- AI-TRADER admin/code/data/worktrees and Execution Server are no-touch surfaces.

## Work packages

### WP-0 — Admission, governance and parallel safety

- Re-read repository, app, library and database governance.
- Inspect current main, worktrees and PRs.
- Reserve migration identity after active AI-TRADER PR #501 migrations 0169/0170.
- Update DEE-731 and create the dependent DEE-747 integration issue.

### WP-1 — Public data model and payment intents

- Add immutable, expiring contribution intents with an exact payable atomic amount, consent,
  optional public links and safe lifecycle state.
- Extend contribution attribution projection with explicitly consented profile/site links.
- Add tenant-safe constraints, indexes, deny-by-default RLS and hand-authored migration journal.
- Bind deterministic watcher matching without automatic verification or publication.

### WP-2 — Support, patrons and transparency

- Explain anonymous and named support paths in English.
- Signed-in named intent form prefills the shared WAIA identity and returns copyable address/amount
  instructions.
- Rank public patrons by exact cumulative verified share and add the approved gratitude copy.
- Show current-month budget first and stable 50-row public transaction pages.
- Add the Foundation route backed by existing allocation evidence.

### WP-3 — Homepage composition and live Breath

- Frame the hero and move the definition into it without adding a second heading.
- Desktop: equal Auth/Breath columns after the hero; mobile: equal full-width stacked surfaces.
- Preserve the waveform; show 0, dynamic annual target, moving funds marker and its value.
- Show “WAIA can keep breathing for” with days, hours, minutes and seconds.
- Place five approved links vertically and leave a quiet visual field on the right.

### WP-4 — Walkthrough truth and Human review

- Apply only the approved balance checkpoint and patron attribution to the isolated walkthrough.
- Preserve imported transactions; represent any observed/ledger difference as reconciliation truth.
- Review support, budget, transactions, patrons, Foundation and homepage in a visible browser.

### WP-5 — Qualification and integration

- Focused unit, Postgres integration/isolation and Playwright coverage.
- Lint, typecheck, build, canon, migration and PR-governance gates.
- Synchronize safely with current main, open one PR and stop for Human squash merge.

## Migration coordination

AI-TRADER PR #501 merged first and established migrations 0169/0170 on `main`. DEE-731 was rebased
onto that canonical history and owns the next additive identities 0171/0172. The fresh-Postgres
validation applies the complete migration chain, including both packages; no AI-TRADER migration is
rewritten.

## Rollback

Before production activation, rollback is one squash-commit revert. After migration apply, disable
the named-intent endpoint first, preserve immutable intent/attribution rows for audit, then revert
application code. Dropping financial history is not an approved rollback.

## Human-only activation

The Human must approve production migrations, configure production environment values, activate the
watcher and review the first real payment match. Merge and production mutation remain Human-only.
