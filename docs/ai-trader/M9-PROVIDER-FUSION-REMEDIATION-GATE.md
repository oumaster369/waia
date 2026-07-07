# M9 Provider Fusion Remediation Gate — Applied

**Status:** ✅ **APPLIED** — merged to `dev` via PR #382 · DEE-394 · `7d1401d` · 2026-07-07  
**Parent plan:** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` (updated post-merge)  
**Child plan:** `.cursor/plans/pre-m9_provider_fusion_remediation_654b93f6.plan.md`

## Phase-status row

| Phase | Linear | PR | Status |
|-------|--------|-----|--------|
| Pre-M9 Provider Fusion Remediation | DEE-394 | #382 | ✅ Merged @ `7d1401d` — engineering complete; **Architect re-audit pending** |

## Todo entry (parent plan)

```yaml
- id: m9-provider-fusion-remediation
  content: "Pre-M9 Provider Fusion Remediation (DEE-394) — truthful full-lane replay fusion + telemetry"
  status: completed
```

## Architectural summary (DEE-394 deliverables)

| Capability | Notes |
|------------|-------|
| **Provider Fusion** | `m9-provider-fusion.json` — 20-lane fusion with influence trace |
| **Replay Sidecar v2** | `waia.trader.m9_provider_sidecar.v2` — 20 lanes, `captureAsOfUtc`, `captureOutcomes` |
| **Provider Influence Trace** | Per-provider influence map + reasoningInputs cross-check |
| **Coverage Matrix** | `m9-provider-coverage-matrix.md` + JSON in fusion artifact |
| **Decision Trace** | `m9-decision-trace.json` — reconstructable strategy selection |
| **Truthfulness guarantees** | No fabricated evidence; fail-soft `UNAVAILABLE`; `newsSentiment: null` + `NEWS_SENTIMENT_DEFERRED_PR3` |
| **Database persistence validation** | Sidecar `contentDigest` in blind authorization scope; manifest digests for four artifacts |
| **Digest pinning** | Campaign refuses on sidecar digest mismatch |
| **Deterministic replay** | No-lookahead guard; two-run content-digest reproducibility test |
| **Research isolation** | `assertResearchRuntime` + static import-boundary audit |

**Operator CLI:** `pnpm trader:m9:capture-sidecar` · `--require-provider-fusion=1` on M9 campaign

## Unchanged (remain blocked)

- **Repeat M9:** **NOT RUN** — fresh operator authorization required after Architect re-audit PASS
- **PR3 / PR4:** **NOT STARTED** — context lanes must not change trading permission until PR3

## PR3 debt register (reference only)

Single-capture snapshot not time-aligned to historical bars; MIN-confidence aggregation; context lanes stored-but-not-featurized; bridge coverage semantics need PR3 redesign. See child plan section 13.6.
