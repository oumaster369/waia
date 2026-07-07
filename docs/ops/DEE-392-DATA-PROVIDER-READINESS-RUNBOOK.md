# DEE-392 — Data Provider Readiness Operator Runbook

**Status:** ✅ **Phase complete** — merged to `dev` as PR #379 @ `9c1df25` · Date: 2026-07-07  
**Linear:** [DEE-392](https://linear.app/deepsense/issue/DEE-392/data-provider-readiness-operatorenv-gateway-config-validation) — **Done**  
**Phase:** Data Provider Readiness (post PR2.6, pre Full Market Data Source Integration)  
**Merge baseline:** `origin/dev` @ `9c1df25`  
**Binding spec:** [`docs/ai-trader/AI-TRADER-DATA-PROVIDERS.md`](../ai-trader/AI-TRADER-DATA-PROVIDERS.md)  
**Canonical provisioning (from zero):** [`docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](../ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md) — **use this for all operator provisioning steps**  
**Validation checklist:** [`docs/ai-trader/AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md`](../ai-trader/AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md)

> **No secret values in this document.** Placeholders only.

---

## Preflight

1. Confirm integration branch is `dev` with PR2.6 merged.
2. Read binding spec and this runbook before changing env.
3. Run repository audit:

```bash
pnpm validate:provider-readiness
```

4. Run full validation chain before sign-off:

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build && pnpm validate:provider-readiness
```

**Repeat M9 v0.1.7 remains BLOCKED** until Data Provider Readiness **and** Full Market Data Source Integration pass.

---

## Post-merge Operator Provisioning Sequence

Execute in this exact order after the Data Provider Readiness PR merges to `dev`:

1. **Merge this PR into dev.**
2. **Operator creates/updates local `.env.local`** — copy from `.env.example`; never commit.
3. **Operator adds only non-exchange provider keys to `.env.local`** — e.g. `COINGECKO_API_KEY`, master key dev, Market Brain / Paper Loop toggles. **Do not add HTX trade credentials to env files.**
4. **Operator runs `pnpm validate:provider-readiness`.**
5. **Operator fixes all validation failures before continuing.**
6. **Operator provisions production secrets via Cloudflare / managed secret store** — `COINGECKO_API_KEY`, `AI_TRADER_MASTER_KEY`, `TRONGRID_API_KEY` (watcher), etc. See [`docs/cloudflare-env-vars.md`](../cloudflare-env-vars.md).
7. **HTX trade credentials are NEVER placed in .env files.**
8. **HTX API Key / Secret / Passphrase are entered only through Trader UI** at `/trader` (Trader Workspace connect flow).
9. **Backend validates and encrypts HTX credentials** using the existing credential architecture ([`DEE-220-MASTER-KEY-RUNBOOK.md`](DEE-220-MASTER-KEY-RUNBOOK.md)).
10. **Verify provider readiness:** balance sync, account sync, Market Brain connectivity, and Paper Loop — without starting Repeat M9.
11. **Only after this phase passes** may the project proceed to **Full Market Data Source Integration**.
12. **Repeat M9 remains blocked** until Full Market Data Source Integration also passes.

---

## Local environment setup

```bash
cp .env.example .env.local
# Edit .env.local — placeholders only; never commit
set -a && source .env.local && set +a
```

Minimum local MI block:

| Variable | Example placeholder | Required locally? |
|----------|---------------------|-----------------|
| `AI_TRADER_MASTER_KEY_DEV` | output of `openssl rand -base64 32` | Yes for HTX cred crypto |
| `AI_TRADER_MASTER_KEY_MODE` | `dev` | Recommended |
| `WAIA_DEPLOYMENT_TIER` | `local` | Recommended |
| `MARKET_BRAIN_ENABLED` | `1` | If testing cron ingest |
| `MARKET_BRAIN_ORGANIZATION_ID` | org UUID | If Market Brain enabled |
| `HTX_REST_HOST` | unset (uses default) | Optional |
| `COINGECKO_API_KEY` | CoinGecko demo key | Optional (fail-soft) |

Workers local preview: copy `.dev.vars.example` → `.dev.vars` with the same MI placeholders.

---

## Per-provider matrix

### HTX Spot (`htx_spot`) — Repeat M9 **Required**

| Field | Value |
|-------|-------|
| **Purpose** | Primary execution venue; MTF OHLCV; L1 quote |
| **Obtain** | Public REST: no key. Trade: HTX API management portal |
| **Place** | Public REST: optional `HTX_REST_HOST`. Trade: **Trader UI only** |
| **Verify** | `pnpm test --run tests/integration/trader-htx-bar-poll-cycle.test.ts`; balance sync via Trader Workspace |
| **Rotate** | Reconnect in Trader UI; rotate master key per DEE-220 if compromised |
| **Mandatory for Repeat M9** | **Yes** |
| **Blocked without** | Yes — primary bars fail-closed |

**Withdraw permissions must remain disabled.**

### Binance Public (`binance_public`) — Repeat M9 **Required (fail-soft)**

| Field | Value |
|-------|-------|
| **Purpose** | Cross-exchange price confirmation |
| **Auth** | No API key |
| **Place** | N/A |
| **Verify** | `pnpm test --run tests/unit/trader-provider-adapters.test.ts` |
| **Mandatory for Repeat M9** | Yes (degrades if unavailable) |

### Bybit Public (`bybit_public`) — Repeat M9 **Required (fail-soft)**

Same pattern as Binance — public v5 market endpoints, no key.

### Alternative.me (`alternative_me`) — Repeat M9 **Required (fail-soft)**

| Field | Value |
|-------|-------|
| **Purpose** | Fear & Greed index |
| **Auth** | No API key |
| **Verify** | `trader-provider-adapters.test.ts` + gateway mock tests |

### CoinGecko Global (`coingecko_global`) — Repeat M9 **Required (fail-soft)**

| Field | Value |
|-------|-------|
| **Obtain** | https://www.coingecko.com/en/developers/dashboard |
| **Place** | `.env.local` / `wrangler secret put COINGECKO_API_KEY` |
| **Verify** | `trader-provider-adapters.test.ts`; optional key sends `x-cg-demo-api-key` header |
| **Rotate** | Replace secret in Cloudflare / `.env.local` |
| **Mandatory for Repeat M9** | No (fail-soft without key) |

### Master key — Repeat M9 path **Required**

| Field | Value |
|-------|-------|
| **Local** | `AI_TRADER_MASTER_KEY_DEV` in `.env.local` |
| **Production** | Cloudflare Secrets Store `AI_TRADER_MASTER_KEY` |
| **Runbook** | [`DEE-220-MASTER-KEY-RUNBOOK.md`](DEE-220-MASTER-KEY-RUNBOOK.md) |

### TronGrid payment watcher — **Settlement only (not MI gateway)**

| Field | Value |
|-------|-------|
| **Purpose** | USDT TRC-20 deposit observation |
| **Place** | `TRONGRID_API_KEY` Worker secret |
| **Verify** | Payment watcher health (BP-9A Step 6) |
| **Mandatory for Repeat M9** | No (settlement subsystem) |
| **Note** | **Do not reuse** this key for future AI-TRADER TronGrid intelligence |

### Deferred providers (FRED, Infura, GDELT, RSS, on-chain, etc.)

Documented in binding spec tier table. **Not configured in this phase.** No env var names invented.

---

## Cloudflare production provisioning

Mirror BP-9A Step 9 pattern for MI workers:

| Variable | Storage | Required prod? |
|----------|---------|----------------|
| `MARKET_BRAIN_ENABLED` | `wrangler.jsonc` plain var | Yes (if ingest on) |
| `MARKET_BRAIN_ORGANIZATION_ID` | `wrangler.jsonc` plain var | Yes |
| `HTX_REST_HOST` | plain var or secret | Optional (default works) |
| `COINGECKO_API_KEY` | `wrangler secret put` | Optional |
| `PAPER_LOOP_*` | plain vars | Per paper config |
| `AI_TRADER_MASTER_KEY` | Secrets Store binding | Yes |
| `TRONGRID_API_KEY` | Worker secret | Watcher only |

Full inventory: [`docs/cloudflare-env-vars.md`](../cloudflare-env-vars.md).

---

## Failure drills (degradation, not crash)

1. Unset `COINGECKO_API_KEY` — gateway must append `coingecko_unavailable` degradation reason; cycle continues.
2. Run gateway tests with `disableOptionalProviders: true` — HTX-only deterministic mode.
3. Confirm CDE downgrades permission on `STALE`/`UNAVAILABLE` aggregate health (unit tests in `trader-market-data-pr25.test.ts`).

Optional providers must **never** crash Market Brain or paper cycles.

---

## Explicit blockers

| Milestone | Blocked until |
|-----------|---------------|
| **Full Market Data Source Integration** | Data Provider Readiness PR merged + operator sign-off |
| **Repeat M9 v0.1.7** | Data Provider Readiness **and** Full Market Data Source Integration pass |
| **PR3 / PR4** | Gate A passes |
| **M10 paper soak** | PR1–PR4 + Gate A + Gate B |

---

## Related documents

- [`AI-TRADER-DATA-PROVIDERS.md`](../ai-trader/AI-TRADER-DATA-PROVIDERS.md)
- [`AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md`](../ai-trader/AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md)
- [`AI-TRADER-ENGINEERING-STATUS.md`](../../replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md)
- [`GATE-A-VALIDATION.md`](../../replay-runs/RI-P7/m9-v2-research-campaign-org0/GATE-A-VALIDATION.md)
