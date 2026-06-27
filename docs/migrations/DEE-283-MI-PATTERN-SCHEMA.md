# DEE-283 — Market Intelligence Pattern Registry schema

**Linear:** DEE-283 (LD-4)  
**Risk tier:** T2 (additive schema, org-scoped, RLS)  
**Doctrine:** `docs/ai-trader/AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md` (Accepted)

## Summary

Adds Layer-4 Market Intelligence **Pattern Registry** — an append-only registry of **recurring-structure records** defined over pinned measurement-definition versions:

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_pattern` | **Append-only** | Org-scoped versioned recurring-structure registry with deterministic `pattern_key`, reproducible `definition_digest`, name/key/org-independent `structural_signature`, and immutable advisory `trial_budget_max` |
| `trader_mi_pattern_lifecycle` | **Append-only** | Org-scoped `ACTIVE`/`ARCHIVED` lifecycle ledger; current state is **derived** from the max-`seq` row (no mutable state column) |

A Pattern is a **recurring structure record**. It is NOT a hypothesis, an edge/profitability claim, an evidence object, a regime-knowledge object, a forecast, a decision, or a strategy signal. The registry stores **declarative definitions only** — no evaluator, no discovery engine, no runtime binding.

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0018_trader_mi_pattern.sql` | Both tables, indexes, append-only triggers |
| Postgres | `db/migrations_postgres/0024_trader_mi_pattern.sql` | Enums `mi_pattern_kind` + `mi_pattern_lifecycle_state`, both tables, indexes, mutation-block triggers |
| Postgres | `db/migrations_postgres/0025_trader_mi_pattern_rls.sql` | RLS deny `authenticated`/`anon` on both tables |

## Invariants (locked — P1–P7)

- **Identity separation (P1/RC-3):** three distinct concepts, never collapsed:
  - `pattern_key = sha256(canonicalJson({ organizationId, patternKind, name }))` — stable logical family key.
  - `definition_digest` — reproducible per-version content fingerprint over `{ schemaVersion, organizationId, patternKey, patternKind, name, definitionCanonical }`; the future LD-5 Evidence-pin target.
  - `structural_signature` — name/key/org-independent duplicate detector over `{ schemaVersion, patternKind, definitionCanonical }` (excludes `name`, `pattern_key`, `organizationId`).
- **Lifecycle (P2/RC-4):** only `ACTIVE` and `ARCHIVED`. Current state is derived from the append-only `trader_mi_pattern_lifecycle` ledger (max `seq`); no mutable current-state column, no deletion, no auto-archive. No `DISCOVERED`/`OBSERVED`/`TRIALED`.
- **Trial budget (P3/RC-1):** `trial_budget_max` is **immutable advisory allocation metadata** — recorded at registration, inherited unchanged across versions. No consumption, no enforcement, no remaining-budget, no FDR discipline, no trial events/refs. Actual trial accounting belongs to a future Hypothesis/Evidence layer.
- **Reproducibility pin (P4/RC-2):** definitions reference measurements by value pairs `{ measurementKey, measurementDefinitionDigest }` inside `definition_json` (≥1 required, validated to resolve to a known measurement version). No row-level FK. Pinned digests participate in `definition_digest`. This LD-4 reproducibility pin is **not** the LD-5 Evidence pin.
- **Pattern firewall (P5/RC-5):** definitions must not encode profitability/edge/expectancy/directional/sizing/null-comparator/prior/relationshipType/falsification claims (→ Hypothesis) nor validated regime-model/regime-transition claims (→ Regime Knowledge). Enforced by a key-scan firewall over `definition_json`.
- **Digest contract (P6):** canonical JSON + SHA-256, same standard as LD-2a/LD-2b/LD-3; numeric definition params normalized to fixed-precision decimal strings (`PATTERN_PARAM_PRECISION = 8`).
- **Inert registry (P7):** declarative metadata only; no pattern discovery engine, no miner, no recurrence detector, no strategy evaluator, no signal engine; Feature Engine and `runEvaluationCycle` untouched.
- **Tenant isolation:** `organization_id` on all rows; composite FKs `(id, organization_id)` and `(pattern_id, organization_id)`; Postgres RLS deny `authenticated`/`anon`; release-blocking `*tenant-isolation*` tests.

## Digest contract — `PATTERN_PARAM_PRECISION = 8` (locked)

`definition_digest` and `structural_signature` normalize **every** numeric value in the definition to a fixed-precision decimal string via `Number#toFixed(8)` before canonical JSON + SHA-256 (`lib/trader/mi/serialize-pattern.ts` → `PATTERN_PARAM_PRECISION`). This constant is **part of the digest contract**, not an implementation detail:

- **Changing the precision changes digest semantics** — it would break reproducibility and any future LD-5 Evidence pin.
- **Treat as an immutable contract once any row exists** — a change is a schema-version evolution requiring a bump of `MI_PATTERN_SCHEMA_VERSION`.
- **Digests are not `sha256(definition_json)`** — `definition_json` is stored as authored (raw); digests are derived from the canonicalized + normalized form plus envelope fields. Re-derive only via `buildPatternDefinitionDigest` / `buildPatternStructuralSignature`.

## Structural-duplicate policy (RC-3)

Registration is **hard-rejected** when an `ACTIVE` family in the same org already carries the same `structural_signature` on its latest version (`MiPatternStructuralDuplicateError`). `ARCHIVED` families do **not** block re-registration. `appendPatternVersion` is unaffected by the dedup gate.

## Audit vocabulary

`trader.mi_pattern.registered`, `trader.mi_pattern.revised`, `trader.mi_pattern.archived`, `trader.mi_pattern.reactivated` over entity types `trader.mi_pattern` and `trader.mi_pattern_lifecycle`.

## Rollback

Additive only. Rollback = drop triggers/policies/functions then drop the two tables and the two enums (no existing table modified).

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-pattern.test.ts tests/unit/trader-mi-pattern-tenant-isolation.test.ts
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
