---
integrationIssue: DEE-605
integrationTitle: "WAIA Homepage vNext — canonical narrative, modules, readiness and Breath of WAIA"
branch: dee-605-waia-homepage-vnext-canonical-narrative-modules-readiness
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, unit-targeted, e2e]
approvalGates: [plan-approved, integration-ready, human-merge]
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
  lastValidatedGitSha: "850f91861e6134ad90c344cea3dcc641992ce5de"
  lastValidationAt: "2026-08-11T14:15:00Z"
  blockedReason: null
  nextAction: "Open PR to main; await human squash-merge"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-605 — WAIA Homepage vNext

## Authority

- Live Linear **DEE-605** is the executable task contract (Architect-approved IA + narrative).
- Repository conflict order still applies; DEE-605 **supersedes** historic DEE-8 §9.4 “no AI-Trader on landing” for the public homepage narrative (AI-TRADER is required here with Product Constitution claim discipline).
- Historic `docs/product/waia-landing.md` remains the older partner-preview auth/entry SoT; this plan does **not** rewrite that entire product spec in-repo. Public narrative content for `/` follows DEE-605 English copy direction.
- Physical isolation from DEE-518 (`/Users/legco/Projects/waia`) is load-bearing.

## Isolation evidence (preflight)

| Surface | Value |
|--------|--------|
| DEE-605 worktree | `/Users/legco/Projects/waia-dee-605-homepage-vnext` |
| Branch | `dee-605-waia-homepage-vnext-canonical-narrative-modules-readiness` |
| Starting HEAD | `1f10d4eebce23f92dccb3d550e8dc10812d26a9e` (= `origin/main` at creation) |
| DEE-518 worktree | `/Users/legco/Projects/waia` on `dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1` |

## Goal

English public homepage that maps WAIA for a first-time visitor: definition → Breath → human/modules narrative → how WAIA is built → paths → Register + Breath CTAs — with readiness, truthful pending Breath data, and future visual slots — without trader/runtime mutation.

## Work packages

### WP-1 — Contracts + homepage composition

Homepage-local data + composition shell.

### WP-2 — Narrative sections + Breath + readiness UI

All DEE-605 sections, CTAs, accessibility, responsive layout.

### WP-3 — Tests + PR readiness

Targeted unit + e2e; lint/typecheck/build; governance preflight; one PR to `main`.

---

## Plan answers (required)

### 1. Exact files to modify

| Path | Action |
|------|--------|
| `components/landing/landing-page-content.tsx` | Rewrite composition to DEE-605 narrative order |
| `components/landing/HeroBlock.tsx` | Keep brand art; add English “What is WAIA?” definition |
| `components/landing/AuthBlock.tsx` | Add `id="register"` anchor only (behavior unchanged) |
| `components/landing/ContextBlock.tsx` | Remove (superseded by narrative) |
| `components/landing/ModulesPreview.tsx` | Remove (superseded by module sections) |
| `components/landing/ClosingBlock.tsx` | Remove (superseded by synthesis + final CTA) |
| `tests/unit/landing-page.test.tsx` | Assert new sections; AI-TRADER present; Breath pending |
| `tests/e2e/landing.spec.ts` | Update block map; keep auth/OAuth/hero asset coverage |
| `docs/plans/dee-605-waia-homepage-vnext-canonical-narrative-modules-readiness.md` | This plan |

### 2. Homepage-specific components to create

Under `components/landing/`:

- `NarrativeMediaSlot.tsx` — optional future visual zone (no artwork)
- `ModuleReadiness.tsx` — maturity label + % + last-updated
- `BreathOfWaiaSection.tsx`
- `HumanBridgeSection.tsx`
- `AiTwinSection.tsx`
- `LivingLegacySection.tsx`
- `BreathInterstitialCta.tsx`
- `SocietySection.tsx`
- `EntrepreneurBridgeSection.tsx`
- `Business3PSection.tsx`
- `AiTraderSection.tsx`
- `EpistemicMethodSection.tsx`
- `AiMarketplaceSection.tsx`
- `WaiaCoreSection.tsx`
- `HowWaiaIsBuiltSection.tsx`
- `WaiaDevOsSection.tsx`
- `PathsSynthesisSection.tsx`
- `FinalCtaSection.tsx`
- `homepage-section.tsx` — shared section chrome (homepage-local)

### 3. Existing components safely reused

- `AuthBlock` (email/OAuth entry — Register surface)
- `HeroBlock` brand `<picture>` assets already in `public/brand/`
- `components/ui/button`, `components/ui/input` via AuthBlock only
- `cn()` from `lib/utils`

### 4. Shared component dependency proposals

**None that mutate shared primitives.** No changes to `components/ui/*`, `components/waia/*`, trader shells, or global token semantics beyond consuming existing CSS variables via Tailwind/classNames.

If a shared primitive change were later required → **STOP** and report. Homepage-local styling is sufficient.

### 5. Responsive architecture

- Single column < `md`; section media slot stacks below copy on small screens, side-by-side on `lg+` where helpful
- Hero art remains full-bleed `max-w-[1600px]`; Auth overlaps lower hero band as today
- Narrative max width ~`max-w-6xl`; readable measure ~`max-w-3xl` for long prose
- Touch targets ≥ 44px on primary CTAs; no horizontal scroll

### 6. Accessibility architecture

- Landmark `<main>`; each major block is a `<section>` with accessible name
- Skip-friendly in-page anchors: `#breath-of-waia`, `#register`
- External links: `rel="noopener noreferrer"`, clear link text (not “click here”)
- Readiness bars: `role="progressbar"` with `aria-valuenow/min/max` + text fallback
- Breath pending: not live region spam; static truthful status text
- Color contrast on midnight field using existing WAIA fg tokens
- `prefers-reduced-motion`: no required motion for v1 (optional subtle CSS only if added)

### 7. Breath public-data interface

`lib/landing/breath-public.ts`:

```ts
export type BreathPublicationStatus = "pending" | "published";

export type BreathPublicSnapshot = {
  status: BreathPublicationStatus;
  lastUpdatedAt: string | null; // ISO-8601 when published
  stageLabel: string | null;
  resources: {
    currency: "USD" | null;
    entered: number | null;
    allocated: number | null;
    spent: number | null;
    remaining: number | null;
    neededNext: number | null;
  };
  work: {
    summary: string | null;
    githubUrl: string; // always https://github.com/oumaster369/waia
  };
  methodologyNote: string;
};
```

`getBreathPublicSnapshot()` returns **pending** empty numerics until DEE-606 publishes.

### 8. Truthful pending/empty Breath state

UI shows labeled dimensions (entered / allocated / spent / remaining / needed next) as “Not yet published”, stage pending, timestamp “Awaiting DEE-606 treasury publication”, plus **work transparency** CTAs to GitHub. **No invented financial figures.**

### 9. Readiness / maturity data approach

`lib/landing/module-readiness.ts` — single authoritative homepage source:

- Maturity labels from `docs/WAIA-CANONICAL-ARCHITECTURE.md`
- Declared percent mapping (not marketing invention):

| Label | Score |
|-------|------:|
| Concept | 10 |
| Research | 25 |
| Prototype | 45 |
| Operational | 70 |
| Production | 95 |

- Mixed modules use **declared weighted methodology** documented in-file (e.g. AI-Twin: operational MVP path + prototype Society; AI-TRADER: research/prototype intelligence vs capital gates)
- Each public card shows: %, maturity label, `lastUpdatedAt`, short methodology caption

### 10. Future visual / media-slot architecture

`NarrativeMediaSlot` renders an intentional empty atmospheric zone (`data-media-slot="reserved"`) sized for later DEE-608 assets. No stock photos, no generated art, no broken `<img>`. Layout balanced without media.

### 11. LEGCO and GitHub link placement

| Link | Placement |
|------|-----------|
| `https://github.com/oumaster369/waia` | Breath (work transparency + “View source on GitHub”); How WAIA Is Built secondary CTA; Final CTA secondary |
| `https://legco.live/research` | How WAIA Is Built primary CTA; Final CTA secondary |

### 12. Tests and validation

- Unit: composition, Breath pending contract, readiness render, key English anchors, AI-TRADER present, Auth still default Create Twin
- E2E: homepage sections visible; Register + Breath anchors; LEGCO/GitHub hrefs; auth flows preserved; hero assets; isolated `PLAYWRIGHT_PORT` (default 3199) — never kill foreign processes
- Local PR readiness: `pnpm lint && pnpm typecheck && pnpm build` + targeted unit + `pnpm test:e2e`
- Full unit suite = GitHub PR CI (per AGENTS.md)

### 13. Rollback path

- Single PR to `main`; human squash-merge only
- Rollback = revert squash commit on `main` (homepage-local files only)
- No migrations / secrets / CI ruleset changes → low blast radius
- Auth path preserved if narrative sections regress

### 14. No trader / runtime surface required

Confirmed: **no** edits to `lib/trader/**`, trader routes, Execution Server, migrations, risk/reconciliation, DEE-518 artifacts, secrets, or CI architecture. Homepage does not call trader APIs. Breath is a typed pending contract only.

---

## Narrative order (implementation)

1. Hero / What is WAIA? (+ brand art)
2. Auth / Register (`#register`)
3. Breath of WAIA (`#breath-of-waia`)
4. Human-first bridge
5. AI-TWIN
6. Living Legacy
7. Breath interstitial CTA
8. Society
9. Entrepreneur bridge
10. 3P Business
11. AI-TRADER
12. Epistemic method
13. AI-Marketplace
14. WAIA Core
15. How WAIA Is Built (LEGCO + GitHub)
16. WAIA DEV OS
17. Paths synthesis
18. Final CTA (Register + Breath primary; research/source secondary)

## Out of scope

- DEE-606 finance backend / invented ledger numbers
- DEE-608 final artwork
- DEE-607 admin finance console
- Any DEE-518 / trader runtime work
- Database migrations
- Shared design-system primitive mutations affecting trader UI
