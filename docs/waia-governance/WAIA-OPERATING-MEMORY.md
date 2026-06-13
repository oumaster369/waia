# WAIA operating memory (Layer 2)

**Status:** Operational synchronization snapshot — not doctrine, not vision, not an implementation log.  
**Role:** Single place to answer *what is true for execution right now* without rereading the whole corpus.  
**Authority:** Subordinate to [`AGENTS.md`](../../AGENTS.md), [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md), [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md), active constitutional doctrine ([`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md)), product specs (`docs/product/**`), and migration trackers (`docs/migrations/**`). On conflict, those sources win — update this file or file a STOP, do not “interpret around” them. **Ecosystem orientation** (interpretive only): [`WAIA-NORTH-STAR.md`](WAIA-NORTH-STAR.md) — does not override the binding stack above.

**Layer 2 means:** Stable enough to align Architect, Cursor, and future agents on current truth; compact enough to skim before work; **replaced or patched** when reality moves — not append-only history; **not** the canonical orientation artifact (see North Star).

---

## 1. Current system identity

**WAIA intent (ecosystem orientation, slow-moving):** [`WAIA-NORTH-STAR.md`](WAIA-NORTH-STAR.md) — clarity, honest alignment, consensual coordination, grounded understanding; anti-drift guardrails for contributors and agents.

| Fact | Source of truth |
|------|-----------------|
| **WAIA DEV OS** — governed human–agent–Linear–Git workflow that ships the product | [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md), [`AGENTS.md`](../../AGENTS.md) |
| **Product in flight** — AI-Twin **v1** (dashboard, Twin dialogue, readiness, Diary/Society gates, Socialization) | [`../product/WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md), [`SYSTEM-MAP.md`](SYSTEM-MAP.md) |
| **Runtime posture** — split SQLite / Postgres behind explicit policy (`getWaiaRuntimeDb()`, env gates, phased route adoption); telemetry as stdout JSON on instrumented routes | [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md), [`../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md`](../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md), [`../migrations/DEE-95E-OPERATIONAL-READINESS-PLAN.md`](../migrations/DEE-95E-OPERATIONAL-READINESS-PLAN.md) |
| **Executable work** — Linear project WAIA only; `dee-<NN>-<slug>` branches; humans merge | [`AGENTS.md`](../../AGENTS.md), [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md) |

---

## 2. Current MVP truth

- **Journey:** Landing → Auth → Dashboard; Twin tab active first; Diary locked until total readiness ≥ **60%**; at **100%** readiness, Socialization appears while Society remains gated per product flow; post-Socialization, Society usable — detail and edge cases in [`../product/ai-twin-user-flow.md`](../product/ai-twin-user-flow.md), not reinterpreted here.
- **Landing (on `dev`, post–PR #154 / `49b47a2`):** First block is a single responsive WebP hero (desktop `/brand/heap_comp_1.webp`, mobile `/brand/head_mobile_1.webp`); cinematic dark field + glass/gold auth; **Create Twin** requires **Your Name** (`fullName` maps via existing `identityLabel` / `identity_label` path — **no** schema migration); **Manrope** for UI/forms, **Cormorant Garamond** for ceremonial headings. Promotion to `main`/production is **out of band** for this memory line.
- **Center:** Dialogue + Diary (when unlocked) + readiness model drive the MVP narrative; infrastructure work is **enabling**, not the product story ([`WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md)).
- **Explicitly deferred:** Business / 3P, AI-Trader, AI-Marketplace, speculative multi-agent choreography ([`NON-GOALS.md`](NON-GOALS.md)).

---

## 3. Current architectural reality

- **App shell:** Next.js App Router; dashboard regions and modes per [`../product/ai-twin-dashboard-shell.md`](../product/ai-twin-dashboard-shell.md).
- **API / data:** Dashboard and Twin HTTP surfaces increasingly routed through **`getWaiaRuntimeDb()`** + **`resolveTwinPersistence`**; SQLite remains default when backend env unset or `sqlite`; Postgres path env-gated ([`DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) **Current Status**).
- **Twin cognition libs:** Sync SQLite engine remains canonical for much of `runTwinEngine`; Postgres async orchestration and ports exist as staged slices — tracker lists what is wired vs deferred ([`DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) §Remaining Work, §Forbidden Shortcuts).
- **AI Gateway:** Bounded architecture and rollout scaffolding (DEE-76–80 family); gateway foundation + optional provider egress per tracker — **no** promise that every backlog slice is production-active without checking env + merged code ([`DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) §AI Gateway).
- **Observability:** `waia_runtime_route` stdout JSON on instrumented handlers — runbook and staging expectations in [`../migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](../migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md); external aggregation/SLOs **not** in-app.

---

## 4. Current roadmap reality

- **Board:** Linear project WAIA is the live queue; this file does **not** mirror ticket states ([`AGENTS.md`](../../AGENTS.md) §Linear Integration).
- **Engineering spine (names only):** DEE-64 staged persistence/runtime; **DEE-95\*** runtime routing + telemetry + ops readiness docs; **DEE-72\*** Postgres twin persistence and reasoning ports; **DEE-76–80** AI Gateway; post–DEE-105 items such as auth/OAuth `getDb()` migration called **deferred** in tracker ([`DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md)).
- **Partner / production path:** Release discipline and env alignment for `dev` → `main` → production Worker documented in [`../ops/DEE-128-PARTNER-PREVIEW-RELEASE-NOTES.md`](../ops/DEE-128-PARTNER-PREVIEW-RELEASE-NOTES.md) (operator checklist; not a substitute for live infra state).
- **In-repo gap:** No document titled “SENSE CODING roadmap.” Coding discipline for agents is **`AGENTS.md`** + Cursor workflow commands + [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md) (five-memory traces).

---

## 5. Current operational priorities

1. Ship **AI-Twin v1** behaviors against **`docs/product/**`** acceptance paths; avoid scope bleed into deferred modules ([`NON-GOALS.md`](NON-GOALS.md)).
2. Keep **runtime migrations honest**: code ↔ tracker alignment; cite trackers in PRs when touching persistence/routes/telemetry ([`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md)).
3. Maintain **governance hygiene**: one execution label per Linear issue, validation canon before PR readiness, no agent merge, no direct push to `main`/`dev` ([`AGENTS.md`](../../AGENTS.md)).
4. Advance **production readiness** only with ops artifacts (telemetry read path, staging checklists, rollback) per **DEE-95e** / **DEE-128** — no silent broad Postgres rollout ([`DEE-95E-OPERATIONAL-READINESS-PLAN.md`](../migrations/DEE-95E-OPERATIONAL-READINESS-PLAN.md)).

---

## 6. Current forbidden directions

- Building **agent society**, persistent autonomous loops, multi-agent councils, or DEV-OS-as-product ([`constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md`](constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md) vision tier; [`NON-GOALS.md`](NON-GOALS.md)).
- **Skipping migration doctrine**: fake neutral DB APIs, premature `runWaiaTransaction`, widening SQLite transaction callbacks for Postgres, removing SQLite before **DEE-85** — verbatim **Forbidden Shortcuts** live only in [`DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) (do not duplicate here).
- **Governance inflation:** new binding layers, autonomous governance, or rewriting the whole doc tree for symbolism ([`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md) — constitutional mutation procedure is human-only, append-only history).
- **Gate skipping:** Gates **B / C / D** are not authorized without completing prior gates ([`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md) §5).

---

## 7. Current governance constraints

- **Conflict order:** Product specs → governance → migration doctrine → Linear issue → code (may lag) ([`AGENTS.md`](../../AGENTS.md)); **`AGENTS.md` vs `EXECUTION-CONTRACT.md`** deliberate PR pairing when baseline changes.
- **Agents:** Event-triggered assistants; **humans decide** merge, scope, and production; no governance document mutation by agents except when explicitly tasked for mechanical edits aligned with Architect intent ([`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md) carry-forward; [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)).
- **Risk tiers** gate autonomy ([`RISK-TIERS.md`](RISK-TIERS.md)); **Human override** remains emergency path ([`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md)).
- **Constitutional doctrine** binds only within its articles; operational canon wins on conflict until reconciled by deliberate PR ([`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md) §3).

---

## 8. Current migration state (summary)

**Program:** **DEE-64** — staged separation of SQLite assumptions from runtime/postgres readiness; **DEE-95\*** — routing facade, alignment waves, stdout telemetry, ops runbooks/checklists.

**Merged highlights (check tracker for authoritative list):** Transaction facades and persistence resolution (**D5a**); Postgres twin persistence + reasoning ports (**DEE-72.x**); **`runTwinEngineForRuntimeAsync`** + Twin Engine route (**DEE-95a/c**); prediction verification + repeatability alignment (**DEE-95d**); telemetry helper (**DEE-95f**); ops docs (**DEE-95g**); twin-dialogue routes (**DEE-95h** / Linear **DEE-104**); dashboard read-plane readiness + diary entries + downstream reasoning/scenario routes (**DEE-105**); post–DEE-105 alignment for prediction/pattern/contradictions/diary scenario per tracker.

**Still open at doctrine level:** Broad production Postgres rollout sign-off; remaining `getDb()` waves (e.g. auth/OAuth); neutral `runWaiaTransaction` only when policy validates; AI Gateway persistence (**DEE-107** per tracker mention), streaming, tooling — see [`DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) (Remaining Work, AI Gateway, D6).

---

## 9. Current product center of gravity

**Human-centered alignment** over time via Twin dialogue, Diary, and readiness — increases coherence between stated values, behavior, and trajectory ([`WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md) §North Star). **Privacy:** Diary literal text does not leak to Society feeds — [`../product/ai-twin-user-flow.md`](../product/ai-twin-user-flow.md) §8.

---

## 10. Current execution sequencing

1. Linear issue approved with single execution label + acceptance criteria ([`AGENTS.md`](../../AGENTS.md) Task Contract).
2. Branch `dee-<NN>-<slug>` → implement → `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, `pnpm build` (+ e2e when UI touches per rules).
3. PR readiness to **`dev`**; human review + merge; post-merge closeout ([`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md)).
4. Migration-touching PRs: declare tracker touchpoints ([`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md)).

---

## 11. Current active risks

| Risk | Mitigation pointer |
|------|-------------------|
| **Complexity / clarity loss** | Prefer pointers + tracker updates over parallel narratives ([`CORE-PRINCIPLES.md`](CORE-PRINCIPLES.md); this file). |
| **Silent dual-backend drift** | Trackers + telemetry + staging checklists ([`DEE-95E`](../migrations/DEE-95E-OPERATIONAL-READINESS-PLAN.md), [`DEE-95G-STAGING-CHECKLIST.md`](../migrations/DEE-95G-STAGING-CHECKLIST.md)). |
| **Scope creep into deferred modules** | [`NON-GOALS.md`](NON-GOALS.md), MVP spec guards. |
| **Operational canon vs doctrine confusion** | [`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md) §3; escalate via [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md). |
| **Production env drift** | Treat [`DEE-128`](../ops/DEE-128-PARTNER-PREVIEW-RELEASE-NOTES.md) as checklist template; verify live Worker/dashboard after deploy. |

---

## 12. Current doctrine holds

From active constitutional acceptance (**binding within stated scope**): DEV OS is **infrastructure for AI-Twin**, not autonomous agent platform; Gate **A** authorized to plan only; Gates **B–D** **not** authorized yet; MVP protection for AI-Twin v1; advisory-only agent posture; sequential **doctrine → identity → permission → behavior → telemetry → enforcement** ([`constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md`](constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md)). Vision-tier agent-society items are **not** engineering mandate ([`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md)).

---

## 13. Current definition of success

- **Product:** MVP surfaces match authoritative flow + shell docs; unlock ordering has no contradictions ([`WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md) §MVP definition of done).
- **Engineering:** CI validation canon green; migration changes leave traceable tracker memory ([`AGENTS.md`](../../AGENTS.md), [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md)).
- **Operations:** Staged Postgres / gateway rollouts follow written rollback and observability paths ([`DEE-95E`](../migrations/DEE-95E-OPERATIONAL-READINESS-PLAN.md), runbooks).
- **Governance:** Audit trail (Linear + PR + git); no silent supersession of canon.

---

## 14. Rules for updating this memory

**Who:** Architect or explicitly delegated human maintainer; agents **may** propose edits via PR when tasked — semantic shifts need human review ([`PR-PROTOCOL.md`](PR-PROTOCOL.md)).

**Do update when:**

- A merged milestone changes **facts** this file summarizes (e.g. tracker “Current Status”, new production gate, MVP threshold change in product specs).
- Orientation drift is observed — refresh pointers, not prose volume.
- Conflict is found vs upstream canon — **fix this file** or fix the authoritative doc in the same change-set per governance rules.

**Do not update when:**

- Replacing Linear, trackers, or product specs (those stay authoritative; no duplication).
- Logging daily churn — use Linear comments and git history.
- Encoding vision, philosophy, or speculative futures beyond what §12 cites — use constitutional/product tiers instead.
- Copy-pasting **Forbidden Shortcuts**, full acceptance criteria, or long roadmap tables — link.

**Maintenance shape:** Prefer **small surgical edits** to numbered sections; bump **Last reconciled** below; avoid append-only appendices.

**Last reconciled:** 2026-05-17 — Git remote + Cloudflare Worker hygiene recorded (§15); landing line unchanged (§2).

---

## 15. Git and Cloudflare hygiene (recorded)

**GitHub — facts (post-cleanup):**

- **Long-lived remotes:** only **`dev`** and **`main`**.
- **Stale design branch removed:** `dee-109-ceremonial-landing-atmosphere` **archived** as tag **`archive/dee-109-ceremonial-landing-atmosphere`** at **`0e81e4130294ee71a3c945b0138892e39944f30d`**, then the remote branch **deleted**.
- **`origin/main` and `origin/dev`:** **identical file trees**; **`origin/main` is an ancestor of `origin/dev`** after **PR #159** (`main` history merged into `dev` with a **real merge commit**).
- **UI noise:** GitHub may still show **`main` as “commits behind” `dev`** — that is **history count only**, not content drift.
- **Branch roles:** **production source = `main`**; **integration / development = `dev`**.

**Git — operational rules:**

- **Long-lived branches:** only **`dev`** and **`main`** on the remote.
- **Temporary branches** (`dee-*`, promotion, fix, chore): **merge**, **archive** (e.g. `git tag archive/…` on the tip), or **delete** when finished — do not let orphans accumulate.
- **After a `dev` → `main` release**, if **`main` must be joined back into `dev` for a clean DAG: merge with GitHub **Create a merge commit** — **not** squash merge and **not** rebase merge — so `main` becomes an ancestor of `dev` and comparisons stay honest.

**Cloudflare — facts (post-cleanup):**

- **`waia-app`:** production Worker for **`waia.life`**; active production deployment on **`main`** commit **`536a288`**, **100% traffic** (recorded at cleanup reconciliation).
- **Deleted after dashboard confirmation** (no custom domain, no routes, no meaningful traffic, no undeclared deps): **`waia-app-dee109-staging`**; **`waia-app-pr-130`** (legacy DEE-79 preview/sandbox).
- **Kept intentionally:** **`waia-app-dee114-walkthrough`** — walkthrough / eval Worker ([`wrangler.dee114-walkthrough.jsonc`](../../wrangler.dee114-walkthrough.jsonc); see architecture docs).
- **Untouched:** **`legco-landing`** — separate project; not WAIA app repo scope.

**Cloudflare — operational rules:**

- **Production `waia-app`** must remain tied to **`main`** commits promoted through the normal release path; **preview / `dev` / PR Workers** must **not** receive **`waia.life`** (or other production hostnames) unless deliberately reconfigured with full ops sign-off.
- **Stale preview or staging Workers** (`waia-app-pr-*`, ad-hoc staging names): **audit periodically**; **delete only after** dashboard confirmation of **no custom domains, no production routes, negligible or zero traffic, and no dependency** (OAuth callbacks, bookmarks, internal runbooks, bindings to other services).

---

## Validation checklist (for contributors editing this file)

- [ ] No new binding rules that belong in `EXECUTION-CONTRACT` / constitution without the proper procedure.
- [ ] No restatement of DEE-64 forbidden shortcuts — pointer only.
- [ ] Terminology consistent with [`GLOSSARY.md`](GLOSSARY.md) where terms appear.
- [ ] Product numbers (thresholds, ordering) still match `docs/product/**` or explicitly defer there.
