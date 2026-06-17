# DEE-222 / DEE-253 — Trader telemetry schema reference

**Type:** Schema reference (documentation only for S1; code in `lib/observability/waia-trader-telemetry.ts`).

**Audience:** Engineers implementing DEE-254–256 and operators validating M7 paper-readiness stdout.

**Related:** [ADR-0003](../adr/0003-stdout-runtime-route-telemetry.md) (`waia_runtime_route`), [DEE-95G Runtime telemetry runbook](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md) (where stdout appears).

---

## Relationship to ADR-0003

| Stream | Filter key | Layer |
|--------|------------|-------|
| Route telemetry | `event: "waia_runtime_route"` | HTTP API routes |
| Trader telemetry | `event: "waia_trader_event"` | Trader service layer |

Both emit **one JSON object per line** via `console.info` (stdout). During paper validation, filter both streams independently.

---

## Base envelope (all kinds)

| Field | Required | Type | Meaning |
|-------|----------|------|---------|
| `event` | yes | `"waia_trader_event"` | Stable filter key |
| `kind` | yes | `execution` \| `reconciliation` \| `counter` \| `paper_loop` | Event taxonomy |
| `organization_id` | yes | string | Org UUID from `OrgContext` |
| `outcome` | yes | string | Kind-specific status token |
| `severity` | yes | `info` \| `critical` | M7 surfacing without alerting automation |
| `duration_ms` | no | number | Non-negative wall time (ms) |
| `error_class` | no | string | `Error.name` only — never message/stack |

Extension fields (S2–S4) must be **scalars only** (`string`, `number`, `boolean`, `null`).

---

## Forbidden keys (runtime enforced)

These keys must **never** appear on payloads (case-sensitive):

`message`, `stack`, `apiKey`, `api_key`, `secret`, `password`, `token`, `credential`, `authorization`, `quantity`, `price`, `client_order_id`, `idempotency_key`, `strategy_signal_id`, `exchange_order_id`

**Allowed for S2+:** `client_order_id_suffix` (short correlation suffix — not the full id).

---

## Kind: `execution` (DEE-254)

Planned `outcome` tokens (not enforced in S1): `submitted`, `risk_rejected`, `submit_blocked`, `connector_uncertain`, `conflict`, transition tokens as needed.

**Golden example:**

```json
{
  "event": "waia_trader_event",
  "kind": "execution",
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "outcome": "submitted",
  "severity": "info",
  "duration_ms": 42
}
```

**Critical example (duplicate-order risk):**

```json
{
  "event": "waia_trader_event",
  "kind": "execution",
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "outcome": "conflict",
  "severity": "critical"
}
```

---

## Kind: `reconciliation` (DEE-255)

Planned `outcome` tokens: `run_complete`, classification-specific surfacing as needed.

**Golden example:**

```json
{
  "event": "waia_trader_event",
  "kind": "reconciliation",
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "outcome": "run_complete",
  "severity": "info",
  "duration_ms": 18
}
```

**Critical example (mismatch surfacing):**

```json
{
  "event": "waia_trader_event",
  "kind": "reconciliation",
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "outcome": "UNKNOWN_POSITION",
  "severity": "critical"
}
```

---

## Kind: `counter` (DEE-256, AT-E5/E6)

Fixed helper shape via `incrementTraderCounter()`:

| Field | Value |
|-------|-------|
| `kind` | `"counter"` |
| `outcome` | `"increment"` |
| `domain` | e.g. `risk`, `decision`, `strategy` |
| `code` | stable reason/signal code |
| `delta` | number (default `1`) |

**Golden example:**

```json
{
  "event": "waia_trader_event",
  "kind": "counter",
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "outcome": "increment",
  "severity": "info",
  "domain": "risk",
  "code": "RISK_MAX_DAILY_LOSS",
  "delta": 1
}
```

---

## Kind: `paper_loop` (DEE-266 / AT-E9 S7)

Orchestrator-level bar-close loop telemetry from `runPaperBarCloseLoop`. Metadata-only soak correlation — not M7 completion, not paper book.

`outcome` tokens: `cycle_complete` (one per bar-close cycle), `rollup` (optional every N cycles when configured).

**Golden example (`cycle_complete`):**

```json
{
  "event": "waia_trader_event",
  "kind": "paper_loop",
  "organization_id": "00000000-0000-4000-8000-000000000001",
  "outcome": "cycle_complete",
  "severity": "info",
  "duration_ms": 120,
  "cycle_id": "test-account-state-0",
  "cycles_run": 1,
  "execution_mode": "mock",
  "signal_outcome": "SIGNAL",
  "skip_reason": null,
  "execution_status": "submitted",
  "risk_outcome": null,
  "reconciliation_classification": "IN_SYNC",
  "state_refreshed": true,
  "open_order_count": 0,
  "position_symbol_count": 1
}
```

**Grep examples:**

```bash
grep '"kind":"paper_loop"' | grep '"outcome":"cycle_complete"'
grep '"cycle_id":"test-account-state-0"'
```

See also [DEE-266-PAPER-LOOP-SOAK-GREP.md](./DEE-266-PAPER-LOOP-SOAK-GREP.md).

---

## Grep examples (staging / paper validation)

```bash
# All trader telemetry lines
grep '"event":"waia_trader_event"'

# Per-org filter (replace UUID)
grep '"event":"waia_trader_event"' | grep '00000000-0000-4000-8000-000000000001'

# Critical surfacing only
grep '"event":"waia_trader_event"' | grep '"severity":"critical"'
```

---

## Deferred wiring (not S1)

Chief decision and strategy signal counters use `incrementTraderCounter()` with `domain: "decision"` / `"strategy"` when AT-E5/AT-E6 land — before AT-E9 paper validation.
