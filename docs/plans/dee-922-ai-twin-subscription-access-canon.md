---
integrationIssue: DEE-922
integrationTitle: "AI-TWIN canon extension — governed subscription activation, pricing and community-sponsored access"
branch: dee-922-ai-twin-subscription-access-canon
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [format-scope, validate-canon, validate-pr-governance]
approvalGates: [human-semantic-review, human-merge]
includedIssues: []
deferredIssues: [DEE-923, DEE-924, DEE-925, DEE-926, DEE-927]
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2, WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Validate the additive canon and open one documentation-only PR for Human review."
provenance:
  createdFrom: "Human architecture dialogue on 2026-09-02"
  gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md
  supersedes: null
---

# DEE-922 — AI-TWIN subscription and access canon extension

## Authority

- Live Linear DEE-922 is the executable task contract.
- DEE-130 remains the AI-TWIN semantic root.
- The AI-TWIN Product Constitution and Canonical Algorithm remain the authoritative product and state contracts.
- DEE-612 remains authoritative for universal access, Human dignity and the no-sponsor-control boundary.
- This batch is documentation-only and creates no billing, payment, entitlement or production authority.

## Context

The ratified AI-TWIN canon separates Formation, Model Health, Society and action authority, but it does not yet define the economic boundary. The Human Architect clarified that Formation/training is currently free; a monthly subscription starts only after a formed Twin is voluntarily connected to the future Society network; the current price is shown; and the Human explicitly confirms. The intended monthly price is a Human-approved version derived from verified per-active-Twin cost multiplied by five.

The Human also approved a future community mechanism through which an eligible user may request support for one billable subscription period and another authenticated Human may pay it. That mechanism must preserve privacy, prevent double payment and create no sponsor access, control or governance weight.

## Goal

Add these truths to canonical AI-TWIN documents and create an atomic, dependency-ordered Linear graph without implementing the deferred runtime.

## Scope

### WP-1 — Canon

- Extend the Product Constitution with no-charge Formation, cost/price authority, lifecycle, explicit consent and universal-access boundaries.
- Extend the Canonical Algorithm with typed cost, price, subscription and sponsorship objects and fail-closed state transitions.
- Add the exact English pre-billing disclosure.

### WP-2 — Roadmap and completion contract

- Add DEE-923..DEE-927 as a cross-version economic/access sequence.
- Preserve v1/v2/v3 gates: billing remains downstream of Society connection and separate Human decisions.
- Add the truthful v1 disclosure requirement while keeping billable activation out of v1.

### WP-3 — Linear memory

- Keep DEE-923..DEE-927 in Backlog until AI-TRADER completion and a new Human start decision.
- Keep the immediate Finance continuity work in separate DEE-921/928/930..934 issues.
- Record dependencies on DEE-612, WAIA Core subscriptions/entitlements and Society gates without duplicating them.

## Exact product copy

> Creating and training your AI Twin is currently free. A monthly subscription will begin only after your Twin is fully formed and you choose to connect it to the future social network of AI Twins. We will show you the current price and ask for your explicit confirmation before billing begins.

> The more people can actively participate in WAIA, the more honest and accurate WAIA becomes—especially its collective layer. If someone cannot cover their subscription, another member of the community can help keep their voice present.

## Do not

- Do not implement code, schemas, migrations, API, UI, price publication, billing, Society or sponsored payments.
- Do not claim a current price or operational sponsored-access guarantee.
- Do not start DEE-923..DEE-927 before active AI-TRADER completion and a new Human decision.
- Do not modify AI-TRADER code, routes, schemas, worktrees, jobs, deployments or data.
- Do not merge; Human review and merge are required.

## Acceptance criteria

- Canon states that Formation/training is free and Formation progress creates no billing authority.
- Canon states that a Human-approved exact price-book version derives from verified per-active-Twin cost multiplied by five.
- The lifecycle `FORMING -> READY -> NETWORK_CONNECTED -> SUBSCRIPTION_ACTIVE` is independently evidenced and fail-closed.
- The exact English pre-billing copy is canonical.
- Sponsored access preserves eligibility, reservation, exact payment, privacy and no-sponsor-control boundaries.
- DEE-923..DEE-927 are dependency-ordered Backlog issues with one execution label each.
- DEE-921 and its Finance children are separate and ready for the next immediate implementation stage.
- Formatting, canonical-document and PR-governance validation pass.

## Files

| Path | Action |
|---|---|
| `docs/product/AI-TWIN-PRODUCT-CONSTITUTION.md` | Add economic, subscription and access invariants |
| `docs/ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md` | Add canonical objects and lifecycles |
| `docs/ai-twin/README.md` | Index the economics/access packet |
| `docs/product-specs/ai-twin-v1-completion.md` | Add truthful disclosure and v1 non-billing boundary |
| `docs/roadmaps/ai-twin-program-roadmap.md` | Add DEE-922..DEE-927 sequence and stop conditions |
| `docs/plans/dee-922-ai-twin-subscription-access-canon.md` | Record this integration contract |

## Validation

```bash
pnpm exec prettier --check docs/product/AI-TWIN-PRODUCT-CONSTITUTION.md docs/ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md docs/ai-twin/README.md docs/product-specs/ai-twin-v1-completion.md docs/roadmaps/ai-twin-program-roadmap.md docs/plans/dee-922-ai-twin-subscription-access-canon.md
pnpm validate:canon
pnpm validate:pr-governance
git diff --check
```

No runtime behavior changes; unit, browser and production tests are not required for this docs-only batch.
