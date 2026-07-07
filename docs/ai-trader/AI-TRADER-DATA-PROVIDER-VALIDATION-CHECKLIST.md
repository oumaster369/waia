# AI-TRADER Data Provider Validation Checklist

**Phase:** Full Market Data Source Integration (DEE-393) — **engineering complete pending merge**  
**Prior phase:** Data Provider Readiness (DEE-392) — **complete** (#379 merged)  
**Repeat M9:** **BLOCKED** until DEE-393 merges and operator validation passes

**Canonical provisioning:** [`AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md) (Sections A–F)

Use this checklist for Architect/operator sign-off. No secret values — verify names and locations only.

---

## Automated repository audit

```bash
pnpm validate:provider-readiness
pnpm validate:market-data-integration
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
```

- [ ] `pnpm validate:provider-readiness` exits 0
- [ ] `pnpm validate:market-data-integration` exits 0
- [ ] Full validation chain green

---

## Documentation

- [ ] [`AI-TRADER-DATA-PROVIDERS.md`](AI-TRADER-DATA-PROVIDERS.md) contains Canonical 20-source tier table
- [ ] 20/20 registry readiness matrix documented
- [ ] Fused context v2 (`waia.trader.fused_context.v2`) documented
- [ ] Repeat M9 required vs deferred sources documented
- [ ] Environment and secrets section complete (incl. 7 integration env vars)
- [ ] Provider health observability documented
- [ ] Gateway bypass inventory documented
- [ ] `order_book_snapshot` gap **closed** (HTX depth adapter + normalizer)
- [ ] [`AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md) Tier 3–8 marked implemented
- [ ] [`DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](../ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) exists
- [ ] [`DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md`](../ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md) exists
- [ ] [`AI-TRADER-ENGINEERING-STATUS.md`](../../replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md) shows DEE-393 complete pending merge
- [ ] [`GATE-A-VALIDATION.md`](../../replay-runs/RI-P7/m9-v2-research-campaign-org0/GATE-A-VALIDATION.md) lists DEE-393; Repeat M9 BLOCKED until validated

---

## Provider registry (20/20)

- [ ] All 20 `MARKET_DATA_PROVIDER_IDS` registered in `provider-registry.ts`
- [ ] Tier 0–2 Repeat M9 required providers validated via gateway
- [ ] Tier 3–8 optional adapters present and fail-soft
- [ ] `order_book_snapshot` normalized via `normalizeOrderBookSnapshotObservation`

---

## Environment templates (placeholders only)

- [ ] `.env.example` documents MI vars + 7 integration env vars
- [ ] `.dev.vars.example` documents MI worker preview vars + integration vars
- [ ] `docs/cloudflare-env-vars.md` inventories all MI + integration vars
- [ ] `FRED_API_KEY` documented (not forbidden)
- [ ] No bare `INFURA_API_KEY` or `INFURA_PROJECT_ID` in templates
- [ ] `AI_TRADER_TRONGRID_API_KEY` documented separately from `TRONGRID_API_KEY`
- [ ] No real secrets in repo, fixtures, tests, or docs

---

## Secrets placement

- [ ] HTX trade credentials documented as **Trader UI only** — never env vars
- [ ] `COINGECKO_API_KEY` documented as optional local/Cloudflare secret
- [ ] `FRED_API_KEY` and `AI_TRADER_INFURA_*` documented as optional MI secrets
- [ ] `AI_TRADER_MASTER_KEY` / `AI_TRADER_MASTER_KEY_DEV` documented per DEE-220
- [ ] `TRONGRID_API_KEY` documented as payment watcher only — separate from `AI_TRADER_TRONGRID_API_KEY`

---

## Gateway and bypass

- [ ] Governed path: Registry → Gateway → Normalization → Validation → Freshness/Reliability → Context Fusion v2 → Understanding Bridge
- [ ] Gateway uses `fuseContextV1` producing `waia.trader.fused_context.v2`
- [ ] Research modules do not import provider clients directly
- [ ] Intentional bypasses documented (execution connector, backfill script, replay builder)
- [ ] MI env vars bridged in `lib/trader/cron/worker-cron-env.ts` (incl. 7 integration vars)

---

## Health and degradation

- [ ] Fail-soft for optional providers documented
- [ ] Fail-closed for HTX primary bars documented
- [ ] Per-kind freshness policy documented (`freshness-policy.ts`)
- [ ] Health → CDE permission mapping documented
- [ ] Operator can verify via unit/integration tests without Repeat M9

---

## Operator provisioning sequence (post DEE-393 merge)

- [ ] Operator executed DEE-393 runbook post-merge steps
- [ ] Local `.env.local` configured (optional Tier 3–8 keys; **no HTX trade creds**)
- [ ] Production secrets provisioned via Cloudflare where applicable
- [ ] HTX credentials connected via Trader UI and encrypted
- [ ] Market Brain / Paper Loop connectivity verified
- [ ] Gateway poll produces fused context v2
- [ ] `pnpm trader:m9:capture-sidecar` produces v2 sidecar with `captureOutcomes` for 20 providers
- [ ] Replay fused context fuses all lanes (populated or honest `UNAVAILABLE`) — no hardcoded `[]` evidence
- [ ] `newsSentiment` is `null` with `NEWS_SENTIMENT_DEFERRED_PR3` reason code (not fabricated `"0"`)
- [ ] M9 campaign emits `m9-provider-fusion.json`, `m9-provider-coverage-matrix.md`, `m9-decision-trace.json` with manifest digests
- [ ] Sidecar `contentDigest` pinned in blind authorization scope

---

## Phase exit — DEE-393

- [ ] All items above checked
- [ ] **Full Market Data Source Integration — PASS**
- [ ] Pre-M9 Provider Fusion Remediation engineering merged (DEE-394 / #382)
- [ ] **Repeat M9 v0.1.7 may be operator-authorized** only after DEE-394 Architect re-audit PASS + fresh campaign authorization
- [ ] Gate A still open until Repeat M9 succeeds

**Sign-off**

| Role | Name | Date | PASS/FAIL |
|------|------|------|-----------|
| Operator | | | |
| Architect | | | |

---

## Appendix — DEE-394 engineering record (merged)

Pre-M9 Provider Fusion Remediation (#382 @ `7d1401d`) merged 2026-07-07. Engineering deliverables: Sidecar v2, replay lane normalizers, fusion/coverage/decision-trace artifacts, digest pinning, research isolation. **Repeat M9 NOT RUN.** Operator sign-off items in provisioning sequence remain pending until Architect re-audit. Gate record: [`M9-PROVIDER-FUSION-REMEDIATION-GATE.md`](M9-PROVIDER-FUSION-REMEDIATION-GATE.md).

---

## Appendix — DEE-392 phase record (complete)

Data Provider Readiness (#379) checklist items remain satisfied. See git history and [`DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](../ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) for the prior phase record.
