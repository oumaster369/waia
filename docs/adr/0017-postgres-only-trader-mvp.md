# ADR-0017 — Postgres-only for new AI-TRADER MVP code

Status: Accepted  
Date: 2026-06-26  
Supersedes (partial): ADR-0002 dual-write expansion for **new** trader scope during MVP Execution Freeze

## Context

AI-TRADER MVP Execution Program v2 (Pipeline P1) requires a single durable runtime path for all **new** trader work. Maintaining SQLite parity for every new module slows MVP delivery and duplicates schema drift already tracked under DEE-64 / DEE-95.

Existing SQLite migrations and dual adapters for merged modules remain until Post-MVP removal (DEE-85).

## Decision

From **2026-06-26** until MVP completion:

1. **New** AI-TRADER modules, migrations, repositories, and integration tests target **Postgres only**.
2. Do **not** add new SQLite migrations or SQLite repository adapters for new trader features.
3. Existing dual adapters may receive bugfix parity only when required to keep `dev` green — not feature expansion.
4. CI **Postgres integration** (`postgres-integration.yml`) is the required gate for migration-bearing trader PRs.
5. Production apply remains **targeted SQL** on `waia-prod` (never blind full migrate).

## Consequences

+ Faster MVP execution on one durable path  
− SQLite-only local workflows for new trader code are unsupported  
− Existing modules keep dual adapters until explicit removal epic

## Links

- [`../ai-trader/AI-TRADER-MVP-EXECUTION-PROGRAM-v2.md`](../ai-trader/AI-TRADER-MVP-EXECUTION-PROGRAM-v2.md) (P1 NEW-2 / DEE-328)
- [`0002-staged-postgres-runtime-rollout-discipline.md`](0002-staged-postgres-runtime-rollout-discipline.md)
- [`../../db/AGENTS.md`](../../db/AGENTS.md)
