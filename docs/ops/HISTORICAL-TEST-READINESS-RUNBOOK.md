# Historical Test Readiness — Operator Runbook

**Owner:** Architect · **Linear:** DEE-415 · **Work package:** HTR-WP23  
**Status:** Phase-A code-ready package (Option A — no Execution Server mutation during HTR)

> **Scope boundary.** This runbook assembles the readiness package that pins FHV Run Contract v0, operator report schema, gate groups CG-A..CG-H, and the code-ready Execution Server manifest. It does **not** authorize a full historical validation run, blind holdout access, or HTX dataset acquisition.

## Related documents

- [`HTR-EXECUTION-SERVER-CODE-READY-PACKAGE.md`](./HTR-EXECUTION-SERVER-CODE-READY-PACKAGE.md) — Option A package manifest
- [`EXECUTION-SERVER-RUNBOOK.md`](./EXECUTION-SERVER-RUNBOOK.md) — Human-only deploy topology (post-certification)
- [`../plans/dee-415-ai-trader-historical-test-readiness.md`](../plans/dee-415-ai-trader-historical-test-readiness.md) — canonical integration plan
- [`../product-specs/ai-trader-historical-test-readiness-completion.md`](../product-specs/ai-trader-historical-test-readiness-completion.md) — completion spec (CG-A..CG-H)

---

## 1. Preconditions

| Requirement | Value |
|-------------|-------|
| Program state | DEE-415 branch `dee-415-ai-trader-historical-test-readiness` |
| FHV authorization | **Not granted** until `CERTIFY-HTR-READY` (D-12) after whole-program audit |
| Dataset source | `NOT_AVAILABLE` — real HTX 2020–2025 acquisition is a separate Human decision |
| Blind holdout | `SEALED_NOT_ACCESSED` — no 2025 price content for strategy development |
| D-11B dataset | `D11B_INFRASTRUCTURE_QUALIFICATION_ONLY` — must not substitute for FHV venue/dataset |
| Execution Server | Code-ready package only — **no host mutation** during HTR |

---

## 2. Pinned FHV Run Contract v0

The readiness preflight pins `FULL_HISTORICAL_VALIDATION_RUN_CONTRACT_V0`:

| Field | Pin |
|-------|-----|
| Venue | HTX_ONLY · SPOT · BTCUSDT + ETHUSDT |
| Base interval | 1m → closed-bar 15m/1h/4h/1d |
| Initial portfolio | 100,000 USDT · 0 BTC · 0 ETH · SHARED_MULTI_INSTRUMENT |
| Leverage / borrowing / shorting | 0 / PROHIBITED / PROHIBITED |
| Full period | 2020-01-01T00:00:00.000Z … 2025-12-31T23:59:00.000Z |
| Development | 2020-01-01 … 2022-12-31 |
| Walk-forward | 2023-01-01 … 2024-12-31 |
| Blind holdout | 2025-01-01 … 2025-12-31 · SEALED_NOT_ACCESSED |
| Cost model | `waia.trader.cost-model.v1` · fees 10 bps · slippage 5 bps |
| Drawdown (D-20) | account 25% · monthly 15% · strategy 20% · CLOSE_ONLY_THEN_STOP_ACCOUNT |
| Dataset manifest digest | `fd7d489595f8fc20e4311c74e5d82b2957e7cca5b80319b8cb8d5f0893544663` (WP12 template) |

Implementation: `lib/trader/readiness/htr-fhv-run-contract-v0.ts`

---

## 3. Readiness preflight CLI

### Self-test (hermetic — no Postgres required)

```bash
pnpm trader:htr:readiness:preflight -- --self-test
```

Validates pinned contracts, gate groups index, Execution Server package manifest, and operator report schema version. Exit 0 = `HTR_WP23_READINESS_PREFLIGHT_PASS`.

### Candidate-run validation

```bash
pnpm trader:htr:readiness:preflight -- --candidate-json '{"venue":"HTX","venueScope":"HTX_ONLY",...}'
```

Rejects any parameter that differs from the pinned FHV Run Contract v0.

### Optional Postgres connection-identity check

When validating GAP-043 suites or local profile alignment:

```bash
WAIA_PG_INTEGRATION=1 \
WAIA_DB_BACKEND=postgres \
DATABASE_URL_POSTGRES=postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate \
pnpm trader:htr:readiness:preflight -- --self-test --validate-postgres-connection
```

**Do not print passwords in evidence or logs.**

---

## 4. Local Postgres validation profile (GAP-043)

Mandatory profile for all 13 GAP-043 parity suites:

```text
host=127.0.0.1
port=54329
database=waia_validate
role=waia_validate
WAIA_DB_BACKEND=postgres
WAIA_PG_INTEGRATION=1
DATABASE_URL_POSTGRES=<local validation URL — see .env.example>
```

Bootstrap stack:

```bash
pnpm db:postgres:bootstrap
```

Run each suite **separately** (never enable `WAIA_PG_INTEGRATION=1` for the full repository test chain):

```bash
pnpm vitest run tests/integration/postgres-hwm-ledger-parity.test.ts
# … (12 additional suites — see packet §10.3)
```

Connection-identity preflight runs via `lib/trader/readiness/htr-postgres-connection-preflight.ts` (WP22 shared contract).

---

## 5. Gate groups (CG-A..CG-H)

Preflight indexes all gate groups requiring readiness checks. Phase-A leaves formal gap closure to independent Phase B:

| Gap | Phase-A owner | Closure deferred |
|-----|---------------|------------------|
| HTR-GAP-028 | HTR-WP23 | Phase B |
| HTR-GAP-042 | HTR-WP23 | Phase B |
| HTR-GAP-043 | HTR-WP23 | Phase B (13 suites / 29 tests) |

Implementation: `lib/trader/readiness/htr-readiness-gate-groups.ts`

---

## 6. Operator report schema

Versioned operator report contract: `htr-operator-report/v1`

Required sections: capital, returns, costs, drawdown, trades, provenance. Holdout access status must remain `SEALED_NOT_ACCESSED`. Billing HWM must remain distinct from risk drawdown HWM.

Implementation: `lib/trader/readiness/htr-operator-report-schema.v1.ts`

---

## 7. Evidence staging (Phase A only)

Phase-A evidence writes **only** to:

```text
.cursor/plans/dee-415-wp23/evidence-staging/<WP23_WORK_SHA>/
```

Promotion to `replay-runs/RI-P7/htr-wp23-readiness-package/` is **Phase B only** (atomic, sidecar-verified).

Evidence integrity contract: `waia.htr.evidence-integrity.v2`

---

## 8. Operator confirmation tokens (future FHV)

Required before actual full historical validation (not consumed during HTR Phase A):

```text
CERTIFY-HTR-READY
APPROVE-HTR-FHV-DATASET-SOURCE
APPROVE-HTR-EXECSERVER-PACKAGE-MODE:option-a-code-ready
```

---

## 9. Prohibited actions during HTR

- Execution Server sync/build/deploy without Human `--confirm`
- Blind holdout or 2025 partition access
- Silent Binance/D-11B dataset substitution for FHV
- Weakening Decision / Risk / Guardian authority
- Running full test suite with `WAIA_PG_INTEGRATION=1`

---

## 10. Validation matrix (WP23 Phase A)

**Hermetic:**

```bash
pnpm validate:canon && pnpm lint && pnpm typecheck && pnpm test --run && pnpm build && git diff --check
```

**WP23 targeted:**

```bash
pnpm vitest run tests/unit/trader-htr-postgres-connection-preflight.test.ts
pnpm vitest run tests/unit/trader-wp23-readiness-preflight.test.ts
pnpm vitest run tests/unit/trader-wp23-fhv-contract-pin.test.ts
pnpm vitest run tests/unit/trader-wp23-operator-report-schema.test.ts
pnpm vitest run tests/unit/trader-wp23-execution-server-package.test.ts
pnpm vitest run tests/integration/trader-wp23-negative-preflight-matrix.test.ts
pnpm trader:htr:readiness:preflight -- --self-test
```
