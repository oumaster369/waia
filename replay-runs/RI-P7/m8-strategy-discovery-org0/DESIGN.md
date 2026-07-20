# M8 Design — Autonomous Strategy Discovery & Evolution

**Linear:** DEE-383  
**Status:** Implementation complete (default-off posture)

## Architecture

M8 adds a discovery substrate under `lib/trader/discovery/*` and parametric generation under `lib/trader/generator/*`. Human actuation bridges live in `lib/trader/research/actuation/*`.

### Loop (epistemic, not reinforcement)

```
Observation → Research Question → Hypothesis Proposal → Strategy Synthesis
  → Strategy Candidate (RI experiment) → Epistemic Evidence → Comparator
  → Promotion Proposal (recommend-only)
```

Knowledge Consolidation is append-only and operator-gated.

### Default-off posture

- `DiscoveryRunConfig.enabled = false` by default
- CLI `pnpm trader:discovery:run` requires `--enable=1` + operator attestation
- No scheduler, Worker cron, or paper-cycle hooks

### Integration boundaries

| Layer | M8 may | M8 must not |
|-------|--------|-------------|
| M6 pattern catalog | Read descriptive refs | Import scores/PnL tags as fitness |
| M7 event attribution | Read descriptive refs | Use confidence as reward |
| RI orchestrator | Wrap via simulation broker | Fork blind FSM |
| Validation gate | Draft promotion packages | Call promotion FSM transitions |
| M1–M5 runtime | — | Modify guardian/exits/paper paths |

### Postgres substrate

Migrations `0074` / `0075`: append-only discovery tables + deny RLS for authenticated/anon.

### No-reinforcement guard

`no-reinforcement-guard.ts` bans PnL/fitness fields at runtime; unit tests enforce comparator allowlist.
