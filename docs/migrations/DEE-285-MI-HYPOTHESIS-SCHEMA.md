# DEE-285 — Market Intelligence Hypothesis Registry schema

**Linear:** DEE-285 (LD-5a.1a)  
**Risk tier:** T2 (additive schema, org-scoped, RLS)  
**Doctrine:** `docs/ai-trader/AI-TRADER-HYPOTHESIS-EVIDENCE-LEDGER.md` (Ratified)

## Summary

Adds Layer-5a Market Intelligence **Hypothesis Registry** — an append-only registry of **falsifiable market claims** pinned to upstream Pattern/Measurement definition versions:

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_hypothesis` | **Append-only** | Org-scoped versioned hypothesis registry with deterministic `hypothesis_key`, reproducible `definition_digest`, and optional `supersedes_json` (outside digest) |
| `trader_mi_hypothesis_lifecycle` | **Append-only** | Org-scoped lifecycle ledger; only `PROPOSED` written in LD-5a.1a; current state derived from max-`seq` row |

A Hypothesis is a **falsifiable market claim**. It is NOT a Pattern, an Evidence object, a Forecast, a Decision, or a Strategy signal. The registry stores **declarative definitions only** — no evidence ledger, no trial outcomes, no confidence model, no lifecycle transition validation (deferred to LD-5a.1b).

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0019_trader_mi_hypothesis.sql` | Both tables, indexes, append-only triggers |
| Postgres | `db/migrations_postgres/0026_trader_mi_hypothesis.sql` | Enums `mi_hypothesis_kind` + `mi_hypothesis_lifecycle_state`, both tables, indexes, mutation-block triggers |
| Postgres | `db/migrations_postgres/0027_trader_mi_hypothesis_rls.sql` | RLS deny `authenticated`/`anon` on both tables |

## Invariants (locked)

- **Identity separation:** two distinct concepts, never collapsed:
  - `hypothesis_key = sha256(canonicalJson({ organizationId, hypothesisKind, name }))` — stable logical family key.
  - `definition_digest` — reproducible per-version content fingerprint over `{ schemaVersion, organizationId, hypothesisKey, hypothesisKind, name, definitionCanonical }`; claim shape sealed inside; `supersedes` excluded.
- **No structural_signature / trial_budget_max:** hypotheses do not carry LD-4 structural duplicate or advisory trial-budget columns.
- **Required Null Contract:** closed enum `{always-flat-cash, buy-and-hold, simple-trend-baseline, random-entry-matched-exposure}`; mandatory floor derived from claim shape; declared `requiredNulls` must equal or superset floor.
- **Claim Shape Contract:** `relationshipType` ∈ `{correlational, predictive, causal-conjecture}` + required booleans `isDirectional`, `isTrendEdge`, `isTimingEdge`; sealed in digest.
- **Supersedes Contract:** optional backward-only factual reference stored in `supersedes_json`; outside digest; zero lifecycle effect in 1a.
- **Hypothesis firewall (inverse of LD-4):** allows prior/relationshipType/falsification/nulls; forbids forecast/edge/sizing/decision/strategy/regime-model/confidence/evidence/trial keys.
- **Lifecycle bootstrap (1a):** `registerHypothesis` inserts version row + initial `PROPOSED` lifecycle row (seq 1); transition validation deferred to LD-5a.1b.
- **Digest contract:** canonical JSON + SHA-256; numeric params normalized via `HYPOTHESIS_PARAM_PRECISION = 8`.
- **Tenant isolation:** `organization_id` on all rows; composite FKs; Postgres RLS deny `authenticated`/`anon`; release-blocking `*tenant-isolation*` tests.

## Digest contract — `HYPOTHESIS_PARAM_PRECISION = 8` (locked)

Same rules as LD-4 Pattern: changing precision or schema version bumps `MI_HYPOTHESIS_SCHEMA_VERSION`. Re-derive only via `buildHypothesisDefinitionDigest`.

## Golden fixture

`tests/unit/trader-mi-hypothesis-serialize.test.ts` pins digest `0f9af018b3e9209893cf2afb42e1509c4c881e66909b739e1300392c43ac726b` for org `00000000-0000-4000-8000-00000000b285`, kind `market_claim`, name `golden_hypothesis`.

## Audit vocabulary

`trader.mi_hypothesis.registered`, `trader.mi_hypothesis.revised` over entity types `trader.mi_hypothesis` and `trader.mi_hypothesis_lifecycle`.

## Rollback

Additive only. Rollback = drop triggers/policies/functions then drop the two tables and the two enums (no existing table modified).

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-hypothesis.test.ts tests/unit/trader-mi-hypothesis-tenant-isolation.test.ts
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
