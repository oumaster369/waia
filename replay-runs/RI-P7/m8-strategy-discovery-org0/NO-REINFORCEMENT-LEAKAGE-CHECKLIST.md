# No-Reinforcement Leakage Checklist (M8 PR)

**Policy:** [`docs/waia-governance/NO-REINFORCEMENT-LEAKAGE-POLICY.md`](../../../docs/waia-governance/NO-REINFORCEMENT-LEAKAGE-POLICY.md)  
**ADR:** [`docs/adr/0020-m8-discovery-architecture-no-reinforcement.md`](../../../docs/adr/0020-m8-discovery-architecture-no-reinforcement.md)

## Code review checklist

- [x] Comparator uses `EpistemicEvidenceDimension` allowlist only
- [x] `BANNED_DISCOVERY_FIELDS` includes PnL/fitness variants (`pnl`, `tradePnl`, `fitness`, `winRate`, …)
- [x] `assertNoBannedFields` called on evidence append, derive, and comparator inputs
- [x] Promotion proposal builder is recommend-only (no FSM imports)
- [x] Hypothesis studio outputs inert proposals pre-MI registration
- [x] M6/M7 refs are descriptive types in observation layer
- [x] Unit test rejects banned fields in comparator evidence payload
- [x] Unit test asserts evidence JSON excludes PnL field names

## Static isolation

- [x] No edits to `lib/trader/guardian/*`, `lib/trader/exits/*`, `lib/trader/events/*`
- [x] No edits to `paper-cycle-runner.ts` discovery hooks
- [x] No import of pattern-catalog scoring into `candidate-comparator.ts`

## Runtime posture

- [x] `DEFAULT_DISCOVERY_RUN_CONFIG.enabled = false`
- [x] CLI requires `--enable=1` + `--operator-attestation`
- [x] No cron/scheduler wiring
