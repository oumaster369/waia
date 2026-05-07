# DEE-64 migration — Linear closeout handoff (reconciliation)

**Purpose:** Reconcile **repository truth** with **Linear** after DEE-72.6 / DEE-93 / DEE-94. Copy comments below into each issue when moving status. **Automation:** This file does not change Linear; an operator updates Linear manually.

**Baseline (verify before closeout):** `origin/dev` should include at least:

| Slice | Merge evidence (typical) |
|-------|---------------------------|
| DEE-72.6 | `2f087b4` — PR **#88** |
| DEE-93 | `a85fa78` — on `dev` |
| DEE-94 | `c170fb6` — PR **#89** (squash; local feature SHA `4da75f8` is not on first-parent line) |

Run: `git fetch origin && git log origin/dev -5 --oneline`

---

## 1. Recommended **Done** (if Definition of Done = merged to `origin/dev`)

### DEE-72.6

- **Why Done:** `runTwinEnginePostgresAsync` shipped; opt-in integration tests; production Twin Engine route unchanged per slice.
- **Paste as Linear comment:**

```text
Merged on dev: 2f087b4 / PR #88. Additive runTwinEnginePostgresAsync (twin-engine-postgres.ts); production route still SQLite/sync. Opt-in: postgres-twin-engine.test.ts (WAIA_PG_INTEGRATION + DATABASE_URL_POSTGRES).
```

### DEE-93

- **Why Done:** Audit deliverable merged on `dev`.
- **Paste as Linear comment:**

```text
Closed on dev: a85fa78. Deliverable docs/migrations/DEE-93-REPEATABILITY-MIGRATION-AUDIT.md. Twin Engine repeatability read path on Postgres OK for future routing; verification/repeatability GET writer alignment deferred to DEE-95+ per audit.
```

### DEE-94

- **Why Done:** Orchestration **plan** merged on `dev` (squash commit on GitHub may differ from pre-merge feature SHA).
- **Paste as Linear comment:**

```text
Merged on dev: c170fb6 / PR #89. Deliverable docs/migrations/DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md — planning only; no facade/routing code. Next: DEE-95 runtime strategy.
```

---

## 2. DEE-95 — keep **In Progress** or **Todo** (not Done)

- **Repo evidence:** [`DEE-64-TRACKER.md`](DEE-64-TRACKER.md) — “Still not done: production route migration (**DEE-95+**)”, unified facade **implementation**, verification/repeatability alignment with engine reads.
- **Code evidence:** [`app/api/dashboard/twin/engine/route.ts`](../../app/api/dashboard/twin/engine/route.ts) still uses `getDb()` + sync `runTwinEngine`.
- **Blocking / inputs:** DEE-94 plan (orchestration); DEE-93 writer/reader gap; env/flags/rollback (to be defined in DEE-95 scope).
- **Suggested Linear comment (optional):**

```text
Not merged: production Twin Engine routing + unified async facade per DEE-94 plan still pending. Tracker DEE-64 Remaining Work references DEE-95+. Next slice: define routing strategy, flags, and aligned routes.
```

---

## 3. DEE-96 — verify in Linear (not in DEE-64 tracker)

- If issue = pgvector / memory retrieval research: status **Backlog** or **In Progress** per actual work; add tracker cross-link when scope is ratified.

---

## Related

- Migration tracker: [`DEE-64-TRACKER.md`](DEE-64-TRACKER.md)
- Truth reconciliation rationale: Cursor plan “Migration truth reconciliation” (same content as issue closeout tables).
