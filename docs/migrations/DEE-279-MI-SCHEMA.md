# DEE-279 — Market Intelligence Source & Provenance schema

**Linear:** DEE-279 (LD-2a)  
**Risk tier:** T2 (additive schema, org-scoped, RLS)  
**Doctrine:** `docs/ai-trader/AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md` (Accepted)

## Summary

Adds Layer-0 Market Intelligence **Source & Provenance** persistence:

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_source` | Mutable registry metadata | Org-scoped source identity (`venue`, `feed_kind`, `symbol`) |
| `trader_mi_source_trust` | **Append-only** PIT trust history | Trust scores with `event_time`, `ingest_time`, `revision_of`, `revision_seq`, `content_digest` |

**Trust is never stored as a mutable column on the registry.** Current trust is derived from the latest `revision_seq` row in `trader_mi_source_trust`.

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0015_trader_mi_source_provenance.sql` | Tables, indexes, COALESCE symbol unique index, append-only triggers on trust |
| Postgres | `db/migrations_postgres/0018_trader_mi_source_provenance.sql` | Enum `mi_source_status`, tables, indexes, mutation-block triggers |
| Postgres | `db/migrations_postgres/0019_trader_mi_source_provenance_rls.sql` | RLS deny `authenticated`/`anon` on both tables |

## Invariants (locked)

- **PIT timestamps:** `event_time` (knowable) + `ingest_time` (recorded); UTC; `ingest_time >= event_time` enforced in service layer.
- **Revision chain:** `revision_seq` monotonic per `(organization_id, source_id)`; `revision_of` composite self-FK.
- **Digest:** canonical JSON + SHA-256 (`lib/trader/mi/serialize-source-trust.ts`); LD-2b inherits this contract.
- **Status:** `active|deprecated` on registry is **advisory metadata**; authoritative history is the audit stream (`trader.mi_source.created`, `trader.mi_source.status_changed`).
- **Tenant isolation:** `organization_id` on all rows; composite FKs; release-blocking `*tenant-isolation*` tests.

## Rollback

Additive only. Rollback = drop triggers/policies/function then drop tables (no existing table modified).

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-source-provenance.test.ts tests/unit/trader-mi-source-provenance-tenant-isolation.test.ts
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
