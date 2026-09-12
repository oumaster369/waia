---
integrationIssue: DEE-995
integrationTitle: "AI-TWIN — mobile conversation access with optional workspace details"
branch: dee-995-twin-mobile-workspace
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, build, e2e, accessibility, canon, pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
state: { status: in-review, currentWorkPackage: WP-3, completedWorkPackages: [WP-1, WP-2], remainingWorkPackages: [WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: "2026-09-12T10:38:00Z", blockedReason: null, nextAction: "Bind independent review to implementation commit, preflight and publish one PR; record exact SHA/PR/CI receipt in Linear. Wait for Human merge, no deployment." }
provenance: { createdFrom: "Human continuation and cabinet usability direction 2026-09-12", gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-995 — Conversation-first mobile workspace

## Scope and authority

Human authorized continued isolated AI-TWIN work and orderly Linear after PR577. This bounded T1 layout repair addresses the mobile gap recorded in DEE-881/994. It neither starts the blocked Adviser/model work nor reopens canceled DEE-144 or completed DEE-994. One new integration issue and one PR; merge/deployment require separate approval. Source baseline `d1c391906d23a5b6d68e9dcfc706b0d8cdf535e9`. No production activation or periodic automation.

## Files and design

One integrator owns `app/dashboard/page.tsx` (wrapping only), `components/dashboard/dashboard-shell.tsx`, new `components/dashboard/twin-mobile-disclosure.tsx`, `components/dashboard/top-block.tsx`, `components/dashboard/mode-tabs.tsx`, `components/dashboard/dialogue-area.tsx` (only reproduced wrapping/minimum-width layout fixes), `tests/unit/twin-mobile-disclosure.test.tsx`, `tests/e2e/twin-mobile-workspace.spec.ts`, and this plan. No shared Sidebar, auth, database, migration, AI/provider/Gateway, Trader, global CSS, dependencies or configuration changes.

On narrow screens, existing navigation and progress/avatar content is behind two explicit, accessible disclosure buttons. On desktop both regions stay visible. Keep a single mounted copy of content, retain all existing values/permissions, and never recompute readiness. Content is hidden only by viewport/user disclosure, never by readiness. The conversation stays mounted throughout. Use existing semantic WAIA tokens, normal flow, 44px controls, wrapping text and focus-visible rings; no overlay, scroll hijacking, new visuals or animation. Preserve all navigation targets and server-side entitlement checks byte-for-byte. Disclosure needs no storage, request, model inference or analytics. Full cross-mode draft retention and conversational tutoring remain DEE-881/878.

## Acceptance

1. WP-1: RED test at 390x844 proves initial invitation/help are displaced; then add mobile disclosures with ARIA expanded/controls, keyboard/touch activation and Escape/focus return. Retain desktop visibility.
2. WP-2: browser regressions at 320/390/768/1440 widths and 200% text; all existing indicator content and gated tabs remain accessible; no document overflow; draft/history survive disclosure toggling and resize; no requests from disclosure actions. Apply only layout corrections demonstrated by these tests.
3. WP-3: targeted tests, mandatory readiness checks, independent read-only review, exact origin/main conflict check and one PR. Record actual tests/results, not whole-module readiness. DEE-878/879/881 statuses/dependencies and Trader work stay unchanged.

## Validation and isolation

`pnpm exec vitest run tests/unit/twin-mobile-disclosure.test.tsx tests/unit/dashboard-shell.test.tsx tests/unit/twin-dialogue-workspace.test.tsx tests/unit/twin-product-guide.test.tsx`.

`pnpm exec playwright test tests/e2e/twin-mobile-workspace.spec.ts tests/e2e/dashboard.spec.ts tests/e2e/twin-product-guide.spec.ts tests/e2e/twin-subscription-disclosure.spec.ts --project chromium --workers 1`, using only own port3295, own `.data/dee995-e2e.db`, fake provider, blank external credentials, no inherited env files. Production-mode build/start for final browser qualification; optional own local preview for inspection. No shared servers or PostgreSQL needed for presentation-only change.

`pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm validate:canon`, `pnpm validate:pr-governance`, rendered-body preflight. Full unit suite belongs to PR CI, not duplicated locally. No claims of full WCAG certification. One revert restores the old layout; no migration/operational rollout or new ADR is needed.

## Local qualification receipt — 2026-09-12

- Plan admitted before source edits as `ad43c102bbae99bb2ca870162f6628c50d9dae32`. Baseline phone test failed because Using WAIA had zero viewport intersection at390x844; missing-disclosure unit import was independently RED before implementation.
- Initial expanded testing reproduced document overflow at320/768/1440 with200% text and lost focus when CSS hid a node before the media-query event. Added Twin-local minimum widths, wrapping indicator grid, bounded sidebar width and remembered-focus recovery. Did not relax overflow/focus assertions. Corrected a test that tried resolving a mobile-only control after switching to desktop: retain its public controls ID before hiding it.
- Final targeted units **41/41** (3 new disclosure,20 dashboard,14 dialogue,4 guide). Production-mode Next build + **16/16** isolated browser scenarios passed, including existing guide, disclosure, signed-out redirect, Breath navigation and entitlement-gated sidebar-link regressions. Synthetic SQLite only; tests do not visit or operate Trader runtime.
- Lint passed with307 pre-existing warnings and no errors; final changed-file lint clean, typecheck passed. Canon validator163 files and governance regression checks passed. No duplicate full local units; authoritative PR CI remains required.
- CUA on own localhost preview verified first phone viewport, optional progress, desktop visibility, first-start, retained unsent draft across resize and Escape focus return. Viewport reset and own tab/server closed. No global styles/configuration or user browser data changed. Automated200% checks are not full screen-reader certification.
- Independent read-only working-diff review found no concrete P1/P2. Its optional composer-focus resize case was added and passed in the final16-test production-mode qualification; final exact-SHA binding recorded in Linear/PR.
- Only seven admitted files delivered: page wrapper, Shell wrapper, TopBlock layout, new disclosure, two new test files, this plan. Shared Sidebar, route data loading/auth/access computation, dialogue semantics, thresholds, subscription copy, API, DB, migrations, providers, configuration, dependencies and Trader files unchanged. Development-generated next-env.d.ts reverted automatically on production build; not included.
- DEE-881 received the extraction receipt; it and DEE-878/879 retain all prerequisites/status. DEE-144 remains Canceled,994 remains Done. DEE-995 alone moves In Review at publication. No merge, release, production migration or deployment authorized here.
