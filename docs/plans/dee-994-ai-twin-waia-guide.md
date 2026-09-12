---
integrationIssue: DEE-994
integrationTitle: "AI-TWIN v1 — Contextual WAIA learning guide and accessible help experience"
branch: dee-994-twin-product-guide
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, build, e2e, accessibility, canon, pr-governance]
approvalGates: [plan-approved, product-review, human-merge]
includedIssues: []
state: { status: in-progress, currentWorkPackage: WP-1, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: null, nextAction: "Implement optional in-place product guide after admission; validate isolated UI without provider/shared backend or Trader changes." }
provenance: { createdFrom: "Human explicit product-learning requirement 2026-09-12", gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-994 — Optional WAIA learning guide

## Approved outcome and version boundary

Human explicitly requires AI-TWIN to teach use of WAIA functions, with pleasant, easy and clear interaction. Full context-aware conversational teaching of all modules is a target spanning later feature availability; this first integration delivers one complete **curated in-place guide**, not an LLM tutor, unlocked features or completion of DEE-878/879/881. Search of onboarding/guide/help/обуч completed with no remaining pages; old DEE-116 welcome is Done and not reopened. Ten hours is a requested effort target starting approximately2026-09-12 08:50UTC, not a validated completion estimate or permission for unsafe release. No periodic automation is authorized.

## Admission before source changes

New separate clean owned worktree/branch from exact published main6ab1b156. Existing DEE-871 backend branch remains untouched. Independent read-only UX audit found that mode navigation unmounts the Twin workspace and loses its local draft; therefore this guide must open/close **in place**, outside the conversation log, without unmounting Twin or navigating. No claim of cross-route draft persistence is made. Existing Start/Send/retry behavior remains authoritative. Society/Personality/Predictions are not completed products merely because tabs render; no availability/identity/consent inferred from readiness.

Owned files: this plan; `docs/product/AI-TWIN-PRODUCT-CONSTITUTION.md`, `docs/ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md`; new `lib/ai-twin/product-guide.ts`, `components/dashboard/twin-product-guide.tsx`, `tests/unit/twin-product-guide.test.tsx`, `tests/e2e/twin-product-guide.spec.ts`; existing `components/dashboard/twin-dialogue-workspace.tsx` only for one help entry and reading-comfort spacing/type; preserve all first-start, form, failure, subscription and persistence logic. No new dependencies, global tokens/styles, route, DB/auth, provider, model engine, environment/configuration or Trader changes. One integrator owns all edited files.

Visual thesis: a quiet conversational workspace with readable body text, one unobtrusive “Using WAIA” control and a solid, in-flow reference surface when requested. Short topic choices, short ordered steps, explicit return, no ceremony, marketing hero, mandatory tour, overlays or competing glow. Use established WAIA surface/tokens and installed Button; no matching dialog primitive exists and no modal is needed. Main prose16px/1.55+; details readable at200%; keyboard focus stays predictable and returns to help trigger on close. No persistent learning score, analytics, personality inference, API call, local storage or automatic message send from guide use. Keep current English-first UI scope; semantic language adaptation remains DEE-120.

## Work packages

### WP-1 — Ratified learning requirement and honest content

Integrate Human's requirement into existing canon. Create a versioned curated guide for current conversation/start, sending/retry, progress interpretation, current/future feature distinctions and free-formation/subscription explanation. Content grounded in current source and canon; never promise unavailable archive/erasure/avatar/Society/real-action controls. No privileged/scientific route details, provider-generated navigation or “teaching complete” claim. Future capability-aware tutor must consume an owner-maintained verified guide catalog and authoritative access state; those are not implemented by static help.

### WP-2 — In-place guide and reading comfort

Open guide without starting formation or losing draft/history; select a topic and read bounded steps; return explicitly or Escape. Guide is not part of `role=log` and not sent to model. Retain existing UI/error/subscription behavior. Conversation stays mounted and help state is session-local only. No other tab navigation or auto-focus hijack on passive updates.

### WP-3 — Accessibility and regression qualification

Tests first: missing-guide RED; content/selection, close/Escape/focus, draft/history preserved, no fetch or request/persistence side effect, first-start not bypassed. Scoped existing `tests/unit/twin-dialogue-workspace.test.tsx` plus new guide tests. Isolated Playwright `tests/e2e/twin-product-guide.spec.ts`, `tests/e2e/twin-subscription-disclosure.spec.ts` and existing dashboard regressions; desktop/mobile,200% text enlargement, no horizontal clipping, keyboard navigation. Use own local synthetic SQLite and explicit fake AI/provider-empty E2E environment; no real Supabase, external credentials or paid calls. User earlier explicitly requires real interface verification, so browser QA is in scope; do not operate the ambient Cloudflare tab. Reuse exact owned preview port/session only, no port scans or stale-server reuse. Full lint/typecheck/build/canon and independent review; authoritative full units on PR CI if readiness reached. No redundant full local unit run.

## Acceptance and release boundary

All guide actions are optional, non-punitive, reversible UI actions and cannot grant authority or progress. Guide claims distinguish current runtime from future target. Positive/negative UI cases and existing dialogue regressions must pass; record actual evidence, not a static mockup as finished AI-TWIN. No production/deployment or new merge within this work package; prepare one coherent PR only after exact-head review and governance. Remaining program dependencies and Human product pilot remain intact.
