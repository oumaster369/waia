# M8 Scope Audit

**Linear:** DEE-383  
**Branch:** `dee-383-m8-strategy-discovery`

## In scope (delivered)

- [x] `docs/waia-governance/NO-REINFORCEMENT-LEAKAGE-POLICY.md`
- [x] `docs/adr/0020-m8-discovery-architecture-no-reinforcement.md`
- [x] `lib/trader/discovery/*` (27 modules)
- [x] `lib/trader/generator/*` (5 modules)
- [x] `lib/trader/research/actuation/*` (4 modules)
- [x] `db/migrations_postgres/0074_trader_discovery_substrate.sql`
- [x] `db/migrations_postgres/0075_trader_discovery_substrate_rls.sql`
- [x] `db/schema.postgres.ts` discovery tables
- [x] Operator authority extensions (`authorize_discovery_run`, etc.)
- [x] `scripts/trader/discovery-run.ts` + `pnpm trader:discovery:run`
- [x] Unit tests: `tests/unit/trader-discovery-*`, `tests/unit/trader-generator-*`

## Out of scope (verified absent)

- [ ] No changes under `lib/trader/guardian/`, `lib/trader/exits/`, `lib/trader/events/`
- [ ] No changes to `paper-cycle-runner.ts` decision paths
- [ ] No GA/RL/program synthesis
- [ ] No auto-promotion or validation-gate FSM calls
- [ ] No Worker cron / scheduler for discovery
- [ ] No live capital promotion from discovery orchestrator

## M6/M7 read posture

M8 observation synthesizer accepts **descriptive refs only** — pattern/event identifiers and labels, never confidence or PnL-derived scores as comparator weights.
