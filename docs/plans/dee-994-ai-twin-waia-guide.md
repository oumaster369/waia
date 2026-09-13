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
state: { status: in-review, currentWorkPackage: WP-3, completedWorkPackages: [WP-1, WP-2], remainingWorkPackages: [WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: 7dd54d34ea21e6e66e84d4bceec70fd715dc7cb5, lastValidationAt: "2026-09-12T09:09:26Z", blockedReason: null, nextAction: "Publish one PR after receipt/preflight; follow exact-head CI. Human merge and deployment remain separate. Final PR linkage and CI receipt in Linear, not a follow-up documentation PR." }
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

## Local implementation receipt — 2026-09-12

Implementation head: `7dd54d34ea21e6e66e84d4bceec70fd715dc7cb5`, admitted plan `70eb485c`, base `6ab1b156a14fb883043f3c6c81c5365be858ffe2`. The subsequent commit changes this receipt only.

- New guide unit tests were RED before implementation (missing help entry). Final scoped units: **18/18**, including all 14 existing dialogue tests.
- New E2E first found a real 390px / 200% text overflow. Local minimum-width/word-wrap correction fixed the cause; bounds assertions retained. Keyboard Tab/Shift+Tab/Space/Enter and Escape/focus return are covered.
- Final isolated production-mode Next build plus scoped E2E: **10/10** (new guide, subscription disclosure and existing dashboard smoke). Own port3294 and `.data/dee994-e2e.db`; fake provider, no Supabase/OpenAI credentials, no external provider calls. Earlier dev-server reuse was explicitly the owned preview only; final qualification rebuilt and started without reuse. This is not PostgreSQL integration or full AI-TWIN completion evidence.
- Full lint passed with pre-existing out-of-scope warnings; scoped changed-file lint and typecheck passed after final CSS/test change. Canon and PR-governance regressions passed. Authoritative full units and other required checks remain PR CI gates, not claimed locally complete.
- Real CUA browser inspection on desktop and390px: guide/readable steps/return visible; focus restored with Escape; viewport override reset. At200% the automated bounds checks cover panel/buttons; no claim of complete screen-reader or WCAG certification.
- Independent read-only review of exact implementation head and all eight changed files: no concrete P1/P2. Reviewer rechecked final width fix and keyboard E2E; did not duplicate tests or operate any database.
- Fresh read-only Cloudflare Builds settings: production branch main, non-production builds enabled, both deploy/version commands use `wrangler versions upload`, no deploy hooks. GitHub preview workflow is separately gated on two Actions secret names; neither exists at repository scope, owner is a personal User (no organization inheritance). No settings changed and no deployment invoked. Version upload and live traffic are distinct per [Cloudflare documentation](https://developers.cloudflare.com/workers/versions-and-deployments/).
- Published main still matched exact base at read-only check. Diff contains no Trader, shared auth/DB, migration, configuration, global styling, dependency or lockfile change. Next's generated dev-only declaration reverted automatically on final production build; not committed. Existing DEE-871 branch remains untouched.

DEE-881 now records the Human all-feature-teaching requirement and observed mobile shell gap: stacked sidebar/avatar/indicators delay access to conversation. Its dependencies/status remain intact. This guide does not repair cross-tab draft loss, redesign the full shell, implement an LLM tutor, or activate Core integration. Human product pilot, formation/model review and broader module readiness remain open.
