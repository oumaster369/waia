---
integrationIssue: DEE-605
integrationTitle: "WAIA Homepage vNext — canonical narrative, modules, readiness and Breath of WAIA"
branch: dee-605-waia-homepage-vnext-canonical-narrative-modules-readiness
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, unit-targeted, e2e]
approvalGates: [plan-approved, integration-ready, human-merge, visual-direction-approval]
includedIssues: [DEE-608]
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-5-B2
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4, WP-5-A, WP-5-B1, WP-5-B2]
  remainingWorkPackages: []
  prNumber: 457
  prUrl: "https://github.com/oumaster369/waia/pull/457"
  lastValidatedGitSha: 9023dcb572824d4f5574a81d8e2e4f730208dd03
  lastValidationAt: "2026-08-11T16:12:00Z"
  blockedReason: "READY_FOR_HUMAN_DEE_608_B2_FINAL_VISUAL_REVIEW — final Twin/Legacy rasters integrated; await Human visual accept before merge"
  nextAction: "Human inspects completed homepage visuals on PR #457; then may squash-merge. Do not merge from agent."
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

English public homepage that maps WAIA for a first-time visitor: definition → Breath → human/modules narrative → how WAIA is built → paths → Register + Breath CTAs — with readiness, truthful pending Breath data, and (via included **DEE-608**) a deliberate visual narrative — without trader/runtime mutation.

## Work packages

### WP-1 — Contracts + homepage composition

Homepage-local data + composition shell.

### WP-2 — Narrative sections + Breath + readiness UI

All DEE-605 sections, CTAs, accessibility, responsive layout.

### WP-3 — Tests + PR readiness

Targeted unit + e2e; lint/typecheck/build; governance preflight; one PR to `main`.

### WP-4 — Human-review corrective pass (PR #457)

Architect accepted baseline IA/visual language. Corrective-only on the existing branch/PR:

1. **Hero/Auth spacing (desktop):** pull “What is WAIA?” definition up exactly 80px; remove Auth negative-margin overlap; Auth top ≈ 100px after definition bottom; flow-aware layout only.
2. **Readiness:** delete invented label→% map and weighted blends; qualitative five-stage maturity scale + explicit facets; no fabricated `%`.
3. **Breath contract:** extend public read model (stage, resources, budget, runway, recent in/out, lastUpdated, work/GitHub) with truthful pending UI — no DEE-606 DB.
4. **Copy corrections:** AI-TWIN Co-Researcher + Mirror→… progression; Living Legacy emotional depth; 3P Provision/Promotion/Production meaning; AI-TRADER abstention; Marketplace need-first inversion.
5. Preserve Society / How Built / LEGCO / GitHub / DEV OS / paths / final CTAs unless a real defect appears.
6. Update targeted unit + desktop geometry e2e; push to existing PR #457 only.

### WP-5 — DEE-608 visual narrative (INCLUDED under DEE-605)

**Integration boundary (Human minimal-PR strategy):** Live Linear **DEE-608** is an **included** visual work package under **DEE-605**. Execute only in this worktree / branch / **PR #457**. Do **not** open `dee-608-*`, a second worktree, or a second PR. DEE-606 / DEE-607 remain deferred (finance boundary).

| Item | Value |
|------|--------|
| Live Linear | [DEE-608](https://linear.app/deepsense/issue/DEE-608/waia-homepage-visual-narrative-image-direction-and-final-asset) (parent DEE-605; status In Progress; label `design`) |
| Phase A (done) | Visual-narrative review + art direction + asset plan — Human-approved with refinements |
| Phase B1 (this pass) | Deterministic diagrams + layout + Twin/Legacy ready slots + production briefs — **no Twin/Legacy raster art** |
| Phase B2 (later) | Final Human-approved `V-TWIN` / `V-LEGACY` artwork integration |
| Human gate (B1) | `READY_FOR_HUMAN_DEE_608_B1_VISUAL_IMPLEMENTATION_REVIEW` |
| Content baseline SHA | `ecc02aeb3e6a287319d6e46b776b1e069d1d551d` (do not regress Hero/Auth geometry or approved copy) |

Full Phase A proposal: **§ DEE-608 Phase A — Visual narrative design review** below.

B1 implementation record + Twin/Legacy production briefs: **§ DEE-608 Phase B1** below.

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

- DEE-606 finance backend / invented ledger numbers (deferred finance boundary)
- DEE-607 admin finance console (deferred finance boundary)
- DEE-608 Phase B final artwork **until** Human visual-direction approval
- Any DEE-518 / trader runtime work
- Database migrations
- Shared design-system primitive mutations affecting trader UI
- Separate `dee-608` branch / worktree / PR

---

## DEE-608 Phase A — Visual narrative design review

**Status:** proposal for Human visual-direction approval  
**Inspected composition:** `components/landing/landing-page-content.tsx` at accepted baseline `ecc02ae`  
**Canon:** `docs/DESIGN_OS_V1.md` + existing midnight / gold / platinum homepage language  
**Gate:** `READY_FOR_HUMAN_DEE_608_VISUAL_DIRECTION_REVIEW`

### 0. Guiding questions (system answers)

| Question | Proposed answer |
|----------|-----------------|
| What should the Human feel on first contact? | Calm recognition — “a reflective intelligence layer,” not a product pitch deck. Hero brand art + definition already carry this; visuals below must deepen, not shout. |
| How should AI be represented without robots? | Cool platinum / silver light, dual-profile reflection (logo myth), soft thresholds and mirrored space — never humanoid machines, brains, circuits, or neural webs. |
| Human ↔ AI-TWIN? | Two presence fields meeting at a luminous threshold (warm self / cool twin), readable as relationship and co-research — not avatar cosplay. |
| Living Legacy without immortality kitsch? | Continuity of values and care across time: soft archival light, layered traces, quiet handoff — not resurrected faces, heaven metaphors, or “live forever” sci-fi. |
| Society without social-graph cliché? | Distinct independent nodes with sparse, consent-thin alignment lines — constellation / shared horizon, **not** Facebook-style network blobs. |
| 3P as business OS? | Prefer the **existing three pillar cards** as the diagram; do not add a stock “business people” plate. |
| AI-TRADER = research → evidence → restraint → protected capital? | Process diagram with an explicit **abstain** branch; forbid candlesticks, PnL fireworks, crypto dashboards. |
| Epistemic method across domains? | Already stated in three columns; avoid a second diagram that repeats Trader. Visual silence here preserves the method as shared language rather than another illustration. |
| LEGCO → DEV OS → code? | Horizontal/vertical process diagram: research artifact → operating rules → inspectable repository. |
| Where is intentional silence? | Human bridge, 3P media slot, Epistemic, Core, DEV OS (cycle text is enough), Paths, Final CTA, interstitial Breath CTA. |

### 1. Page-level visual rhythm

Prefer **fewer, stronger** beats. The page must not become a gallery.

```
Hero art (keep) ── silence around Auth ── Breath diagram ── silence (Human bridge)
── AI-TWIN image (peak emotional 1) ── Legacy image left (peak emotional 2)
── silence (interstitial CTA) ── Society diagram ── silence (Entrepreneur / 3P cards)
── Trader process diagram ── silence (Epistemic / Marketplace text; optional tiny Marketplace mark)
── silence (Core) ── How-built process diagram ── silence (DEV OS / Paths / Final CTA)
```

**Cadence:** image → image → diagram cluster mid-page → one build diagram → long closing silence so Register/Breath remain the last focal objects.

**Alternation:** keep Living Legacy visual **left** on desktop; keep AI-TWIN / Society / Trader / How-built / Breath visual **right**. Optional Phase B: flip Society to **left** after Legacy for A-B-A breathing — only if Human prefers stronger left/right pulse.

### 2. Per-section visual decisions

Legend: **A** final image/illustration · **B** explanatory diagram · **C** subtle motion/data visual · **D** ambient treatment · **E** intentionally no visual

| # | Section | Decision | Why (text alone is not enough?) | Current slot |
|---|---------|----------|----------------------------------|--------------|
| 1 | Hero / What is WAIA? | **A keep existing** (+ **E** no extra) | Brand art already encodes reflective duality; another plate would compete with definition + Auth. | Hero art (not `NarrativeMediaSlot`) |
| 2 | Breath of WAIA | **B** (+ optional **C** later when live data) | Visitors must *see* open resource↔work transparency as a dual system, not only read pending fields. | **KEEP** → convert to diagram |
| 3 | Human bridge | **E** | Short bridge copy; a slot here is decorative. | **REMOVE** |
| 4 | AI-TWIN | **A** | Co-Researcher relationship and Mirror→… progression need one memorable relational image. | **KEEP** → final image |
| 5 | Living Legacy | **A** | Emotional core of the narrative; text needs a restrained visual anchor. | **KEEP** (left) → final image |
| 6 | Society | **B** | Coordination-without-network-cliché is hard in prose alone. | **KEEP** → abstract diagram |
| 7 | Entrepreneur bridge | **E** | Typographic bridge only. | none |
| 8 | 3P Business | **E** (pillars UI = diagram) | Three pillar cards already communicate OS structure; side media would be gallery filler. | **REMOVE** |
| 9 | AI-TRADER | **B** | Restraint/abstain must be visually legible vs “trading = money” cultural default. | **KEEP** → process diagram |
| 10 | Epistemic method | **E** | Three domain columns already carry the method; Trader diagram precedes — silence avoids diagram fatigue. | none |
| 11 | AI-Marketplace | **B compact** (inline) | Need-first inversion benefits from a tiny compare mark; not a full hero plate. | **ADD** compact inline diagram (no full slot) |
| 12 | WAIA Core | **E** | “Invisible spine” fails as literal imagery; text is clearer. | none |
| 13 | How WAIA Is Built | **B** | Research → DEV OS → GitHub must be visually legible as one pipeline. | **KEEP** → process diagram |
| 14 | WAIA DEV OS | **E** | Existing cycle monospace block *is* the visual. | none |
| 15 | Paths synthesis | **E** | Two path cards suffice. | none |
| 16 | Final CTA | **E** / ultra-light **D** only | Action surface needs silence; no competing artwork. | none |

**Breath interstitial CTA:** **E** — keep as typographic CTA only.

### 3. Art-direction system

Aligned with Design OS v1; homepage-local only.

| Dimension | Spec |
|-----------|------|
| Composition | Bilateral calm; one focal lamp per visual; generous negative space; no sticker overlays on imagery. |
| Spatial depth | Glass-in-darkness / soft radial fields; shallow depth of field for photography-like plates; flat editorial clarity for diagrams. |
| Lighting | Soft rim + warm gold accent budget (≤ one warm accent motion per view); cool platinum for twin/AI layer. |
| Contrast | High enough for WCAG on text; imagery sits *behind* or *beside* copy — never washes mid-tones over body text. |
| Texture | Ultra-subtle grain optional; no circuit boards, no neon grids. |
| Human representation | Partial, dignified, anonymous when needed; no stock “business handshake” people; no smiling SaaS stock. Prefer silhouette, profile, hands, archival materials. |
| AI representation | Light, reflection, cool platinum field, dual-profile threshold — **never** robots, glowing brains, circuit heads, neural webs. |
| Abstraction | Emotional sections (Twin, Legacy): semi-abstract illustration or carefully directed still. Systems sections: crisp vector diagrams. |
| Diagrams | Thin gold/platinum lines on midnight; labeled stages; abstain/negative paths drawn as clearly as positive ones. |
| Line/icon language | Hairline 1–1.5px; rounded terminals; no filled emoji; no crypto icons. |
| Motion | Breath-tier ambient only; 200–400ms functional; rare ceremonial. `prefers-reduced-motion`: static final frame. |
| BG / FG | Midnight `#030813` field; visuals never invent a second brand palette. |
| Media modes | Prefer illustration + diagram over stock photo. Abstract 3D only if it reads as material light/glass — not sci-fi HUD. |
| WAIA gold / dark | Gold = human warmth + CTA lamp; platinum = twin/reflection; never “crypto gold” saturation. |

**Prohibited clichés:** random robots; glowing AI brains; circuit-board heads; meaningless neural webs; stock business people; generic crypto candlesticks; sci-fi dashboards; decorative images with no semantic role; digital-immortality heaven tropes; Facebook-style node spam.

### 4. Proposed final asset list (Phase B — after approval)

| ID | Section | Type | Semantic purpose | Desktop AR | Approx budget |
|----|---------|------|------------------|------------|---------------|
| `V-HERO` | Hero | Existing brand art | Keep; do not replace unless Human asks | full-bleed | already shipped |
| `V-BREATH` | Breath | SVG/diagram | Dual system: resources transparency ↔ open work (GitHub) | **4:5** in column (~0.8fr) | ≤ 40 KB SVG |
| `V-TWIN` | AI-TWIN | Final illustration (WebP + AVIF) | Human ↔ Twin co-presence at luminous threshold; Co-Researcher relationship | **4:5** | ≤ 180 KB WebP |
| `V-LEGACY` | Living Legacy | Final illustration (WebP + AVIF) | Continuity of values/care across time — emotional without immortality claim | **4:5** | ≤ 180 KB WebP |
| `V-SOCIETY` | Society | SVG/diagram | Independent lives with sparse aligned coordination (not social graph) | **4:5** | ≤ 40 KB SVG |
| `V-TRADER` | AI-TRADER | SVG/diagram | Observe → hypothesize → test → evidence; explicit **abstain / protect capital** branch | **4:5** | ≤ 45 KB SVG |
| `V-MARKET` | Marketplace | Inline SVG (compact) | Offer-first funnel vs need-first path inversion | **16:9** strip or **3:1** | ≤ 20 KB SVG |
| `V-BUILT` | How built | SVG/diagram | LEGCO research → WAIA DEV OS → GitHub inspectability | **4:5** | ≤ 40 KB SVG |

**Not produced:** Human-bridge plate, 3P side media, Epistemic plate, Core plate, DEV OS plate, Paths plate, Final CTA plate.

**Total new raster budget target:** ≤ ~400 KB decoded transfer for the two emotional images (modern formats + `sizes`). Diagrams: ≤ ~200 KB combined SVG.

### 5. Responsive / crop / order rules

| Asset | Tablet | Mobile | Crop | Text/visual order |
|-------|--------|--------|------|-------------------|
| `V-BREATH` | stack under copy | stack; max-h ~220px | keep both axes of dual system visible | text first |
| `V-TWIN` | stack | stack; do not crop through the luminous threshold | preserve dual presence | text first |
| `V-LEGACY` | stack | stack; keep soft archival center | avoid cropping “handoff” zone | **mobile: text first** (keep current `order-1` text); desktop visual left |
| `V-SOCIETY` | stack | stack; simplify to ≤5 nodes if needed | never densify into hairball | text first |
| `V-TRADER` | stack | stack; preserve abstain branch label | never crop away abstain | text first |
| `V-MARKET` | full width under copy | full width | none | inline under body |
| `V-BUILT` | stack | stack; three-stage labels remain readable | keep stage order L→R or top→bottom | text first |

**Formats:** SVG for diagrams; AVIF + WebP (+ PNG fallback only if required) for illustrations; no unoptimized PNG hero dumps. Use `next/image` for rasters with explicit `width`/`height`/`sizes`.

### 6. Accessibility / alt-text intent

| Asset | Alt intent (not decorative) |
|-------|-----------------------------|
| `V-BREATH` | Describe dual open-resources and open-work relationship; do not invent treasury amounts. |
| `V-TWIN` | Describe human and twin presence meeting as co-researchers — not “AI robot.” |
| `V-LEGACY` | Describe continuity of care/values across time — not immortality. |
| `V-SOCIETY` | Describe independent participants with sparse alignment — not a social network. |
| `V-TRADER` | Describe research-to-evidence flow including the choice not to trade. |
| `V-MARKET` | Describe need-first path vs offer-first funnel. |
| `V-BUILT` | Describe research → operating system → public code pipeline. |

Diagrams that convey unique information must not rely on color alone; labels remain in the SVG or adjacent text. Reserved slots today use `role="img"` + purpose; Phase B replaces with real `alt` / titled SVG.

### 7. Motion recommendations

| Location | Motion | Reduced motion |
|----------|--------|----------------|
| `V-TWIN` | Optional slow opacity settle / soft rim pulse (ceremonial, rare) | static |
| `V-LEGACY` | Optional ultra-slow light drift | static |
| `V-BREATH` | Optional very slow dual-axis “breath” opacity when DEE-606 data is live | static diagram |
| `V-TRADER` | Optional one-time path draw on first in-view | static full path |
| Page ambient | Do not add scroll-jacking parallax | n/a |

Max concurrent ornamental motion: **one** on-screen.

### 8. Media-slot disposition (current → Phase B)

| Slot `testId` | Disposition | Change |
|---------------|-------------|--------|
| `landing-breath-media` | **KEEP** | Replace reserved shell with `V-BREATH` diagram |
| `landing-human-bridge-media` | **REMOVE** | Drop slot; section becomes single-column text |
| `landing-ai-twin-media` | **KEEP** | `V-TWIN` final image; may enlarge min-height to ~16–18rem desktop |
| `landing-living-legacy-media` | **KEEP** | `V-LEGACY`; preserve left/right alternation |
| `landing-society-media` | **KEEP** | `V-SOCIETY` diagram; optional layout flip to left |
| `landing-business-3p-media` | **REMOVE** | Pillars remain the visual |
| `landing-ai-trader-media` | **KEEP** | `V-TRADER` process diagram |
| `landing-how-built-media` | **KEEP** | `V-BUILT` pipeline diagram |
| *(new)* Marketplace | **ADD compact** | Inline under marketplace copy — not a full `NarrativeMediaSlot` card |

`NarrativeMediaSlot.tsx` stays homepage-local; Phase B may extend it to accept `children` / `src` **without** touching shared design-system primitives.

### 9. Proposed layout changes (Phase B only — after approval)

- Remove Human-bridge and 3P media columns (homepage-local section files only).
- Optionally enlarge Twin/Legacy media min-heights for emotional weight.
- Optionally alternate Society to visual-left.
- Add compact Marketplace inversion mark.
- **Do not** change Hero `lg:-mt-20` or Auth `lg:mt-[100px]` geometry unless Human explicitly re-opens spacing.
- **Do not** mutate shared UI primitives used by trader surfaces.

### 10. Exact files Phase B would modify/add

**Likely modify**

- `components/landing/BreathOfWaiaSection.tsx`
- `components/landing/HumanBridgeSection.tsx` (remove slot)
- `components/landing/AiTwinSection.tsx`
- `components/landing/LivingLegacySection.tsx`
- `components/landing/SocietySection.tsx`
- `components/landing/Business3PSection.tsx` (remove slot)
- `components/landing/AiTraderSection.tsx`
- `components/landing/AiMarketplaceSection.tsx`
- `components/landing/HowWaiaIsBuiltSection.tsx`
- `components/landing/NarrativeMediaSlot.tsx` (homepage-local capability only)
- `tests/unit/landing-page.test.tsx`
- `tests/e2e/landing.spec.ts` (slot keep/remove assertions; geometry unchanged)

**Likely add**

- `public/landing/visuals/` (or `app`-adjacent static) — `breath.svg`, `society.svg`, `trader-method.svg`, `how-built.svg`, `marketplace-inversion.svg`, `ai-twin.webp` (+ avif), `living-legacy.webp` (+ avif)
- Optional: `components/landing/visuals/*` thin wrappers

**Must not touch**

- `lib/trader/**`, trader UI routes, Execution Server, DEE-518 worktree
- Shared `components/ui/**` primitives unless STOP + Human approval
- Approved copy in `lib/landing/homepage-copy.ts` (except typo/a11y if Human directs)

### Phase A evidence

- Live DEE-608 fetched: included under DEE-605; execute in PR #457; no separate integration PR.
- Accepted content baseline: `ecc02ae` — Hero definition 80px up; Auth ~100px gap; qualitative readiness; full pending Breath contract; approved English meaning preserved.
- Phase A produces **documentation only** in this plan (+ PR Includes update). **No final artwork generated. No approved copy rewritten.**

### Human decision required

Approve / amend this visual direction. Next agent step after approval: **Phase B asset production + integration inside PR #457** — still **no merge** until Human accepts the final visual result.

---

## DEE-608 Phase B1 — Deterministic visual implementation

**Status:** implemented for Human B1 review  
**Gate:** `READY_FOR_HUMAN_DEE_608_B1_VISUAL_IMPLEMENTATION_REVIEW`  
**Not done:** `V-TWIN` / `V-LEGACY` final rasters (B2)

### B1 delivered

| Asset | Implementation |
|-------|----------------|
| `V-BREATH` | SVG dual resource ↔ work + GitHub inspectability (`BreathDiagram`) |
| `V-SOCIETY` | SVG sparse person/Twin pairs; visual-**left** on desktop; text-first on mobile |
| `V-TRADER` | SVG pipeline + equal-weight **NO TRADE**; restrained path reveal; reduced-motion static |
| `V-MARKET` | Compact inline SVG inversion (`MarketplaceDiagram`) |
| `V-BUILT` | SVG Question→…→Knowledge with DEV OS span + Human authority notes |
| 3P | Media slot **removed**; pillars elevated as operating structure |
| Human bridge | Media slot **removed**; typographic silence |
| Epistemic | No illustration; method steps typography clarified |
| `V-TWIN` / `V-LEGACY` | `FinalArtReadySlot` calm composition (`data-media-slot="final-art-ready"`) — **no fake final art** |

### Files (B1)

Added under `components/landing/visuals/`: `diagram-shell.tsx`, `breath-diagram.tsx`, `society-diagram.tsx`, `trader-diagram.tsx` + `.module.css`, `marketplace-diagram.tsx`, `how-built-diagram.tsx`, `final-art-ready-slot.tsx`.

Removed: `components/landing/NarrativeMediaSlot.tsx` (superseded).

Section updates: Breath, HumanBridge, AiTwin, LivingLegacy, Society, Business3P, AiTrader, Epistemic, AiMarketplace, HowBuilt.

### Final production brief — V-TWIN (B2)

**Asset ID:** `V-TWIN`  
**Slot:** `landing-ai-twin-media` · desktop right · aspect **4:5** · WebP (AVIF optional) ≤ ~180 KB  
**Semantic goal:** Relationship between one human and a progressively forming digital reflection — Mirror → Model → Observer → Co-Researcher — **not** a clone, robot, or authority.

**Composition**

- Vertical 4:5 field on midnight/black.
- **Left ~40%:** warm human presence (partial profile or three-quarter, soft edge) — gold/warm skin/cloth tones, not stock “business person.”
- **Right ~40%:** cool platinum presence — related silhouette/light-form, incomplete/porous edges suggesting formation, not a finished twin face copy.
- **Center ~20%:** luminous threshold / soft connecting point of light (logo myth) — closeness without merger.
- Gaze: if eyes readable, human looks slightly toward twin or shared middle; twin does **not** stare down or dominate. Prefer contemplative lateral orientation over confrontational eye contact.
- Depth: shallow; soft rim light; one focal lamp at threshold.
- Abstraction: semi-abstract illustration preferred over photoreal stock; allow mystery/incompleteness in the AI presence.
- Do **not** stamp all four progression labels into the image unless Human later requests a quiet caption outside the art.

**Prohibited:** humanoid robot; glowing brain; circuit head; holographic assistant; surveillance camera tropes; clone face duplicate; AI as throne/center controlling human; neural webs; neon sci-fi HUD.

**Crops**

- Desktop: preserve both presence fields + threshold in frame.
- Mobile: never crop through the threshold; prefer slight vertical bias keeping both silhouettes.

**Alt-text intent:** “A human presence and a related cool digital presence meet at a soft luminous threshold — AI-TWIN as co-researcher, not a machine overseer.”

**Temporary B1 slot:** calm dual radial + silhouette guides (`FinalArtReadySlot` motif `twin`) — replace entirely with final art.

---

### Final production brief — V-LEGACY (B2)

**Asset ID:** `V-LEGACY`  
**Slot:** `landing-living-legacy-media` · desktop **visual-left** · aspect **4:5** · WebP (AVIF optional) ≤ ~180 KB  
**Semantic goal:** Continuity of lived experience, values, stories, mistakes, and decisions across generations — **not** immortality, resurrection, ghost, or consciousness upload.

**Composition**

- Vertical 4:5 midnight field, restrained warmth.
- **Present human** (foreground, warmer, clearer): quiet dignity; not grieving theatre.
- **Subtle preserved layer** (mid): soft archival trace — light, paper, woven memory, or translucent prior presence — readable as *understood experience*, not a specter.
- **Later-generation human** (background or lower right, softer): receiving meaning, not haunted.
- Symbolic continuity: a thin warm continuum / soft handoff of light between figures — **not** DNA helix, family-tree infographic, or tombstone.
- Lighting: archival evening warmth; no heaven beams; no cold horror lighting.
- Depth: gentle layers; emotional restraint; credible and humane.
- Abstraction: painterly or soft illustrative; avoid literal genealogy chart unless composition truly benefits (default: **no** chart).

**Prohibited:** immortality / “live forever”; resurrection; ghost/apparition; digital consciousness upload; angelic afterlife; skulls/memento-mori kitsch; creepy uncanny double.

**Crops**

- Desktop: keep present + trace + later presence relationship.
- Mobile: protect the continuum/handoff zone; text remains first in reading order (`order-1`).

**Alt-text intent:** “A present human, a soft preserved layer of lived experience, and a later human presence — continuity of meaning across time, not immortality.”

**Temporary B1 slot:** calm archival dual presence + continuum line (`FinalArtReadySlot` motif `legacy`) — replace entirely with final art.

---

### Human decision (B1)

Review deterministic diagrams + slot cleanup locally / on PR preview.  
Next: approve production of **V-TWIN** and **V-LEGACY**, then B2 integration inside PR #457.  
**Do not merge** until B2 visuals are also Human-accepted.  
DEE-608 remains incomplete until B2.

---

## DEE-608 Phase B2 — Final raster integration

**B1 status:** Human-approved (HEAD `74ef5d8`).

**B2 status:** final assets integrated — gate `READY_FOR_HUMAN_DEE_608_B2_FINAL_VISUAL_REVIEW`

| Item | Result |
|------|--------|
| Source `ai-twin-source.png` | PNG RGB 8-bit, **1122×1402**, 2,247,189 bytes, ratio ≈0.8003, no alpha; orientation normal |
| Source `living-legacy-source.png` | PNG RGB 8-bit, **1122×1402**, 2,016,158 bytes, ratio ≈0.8003, no alpha; orientation normal |
| Production crop | Center extract **1120×1400** (1px each edge) — exact 4:5; threshold/handoff preserved |
| Tool | Node `sharp@0.34.5` true WebP encoder (`effort: 6`, `smartSubsample`) |
| `ai-twin.webp` | **1120×1400**, **167,110 bytes** (~163 KB), quality **82** |
| `living-legacy.webp` | **1120×1400**, **168,936 bytes** (~165 KB), quality **86** |
| AVIF | **Not used** — WebP alone meets budget/quality; avoid unused complexity |
| Source PNGs in git | **Excluded** (staging only; removed from worktree before commit) |
| Twin/Legacy UI | `NarrativeFinalImage` → `data-media-slot="final-art"`; `FinalArtReadySlot` deleted |
| Marketplace markers | `#mkt-arrow-dim` / `#mkt-arrow-gold` preserved |
| Public alt | Contract in `FINAL_VISUAL_ALT` (no internal IDs / DEE / approval language) |

**Do not merge** until Human accepts the completed visual homepage.
