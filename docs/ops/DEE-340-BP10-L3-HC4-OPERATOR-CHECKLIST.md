# DEE-340 / BP-10 — L3 HC-4 Operator Checklist

**Linear:** [DEE-340](https://linear.app/deepsense/issue/DEE-340) · **Checkpoint:** HC-4 · **Status:** **READY — NOT EXECUTED**  
**Authority:** [ADR-0011](../adr/0011-single-operator-governance-model.md) · [ADR-0009](../adr/0009-regulatory-posture.md) · [ADR-0010](../adr/0010-strategy-validation-gate.md)  
**Runbook:** [DEE-340-BP10-LAUNCH-RUNBOOK.md](DEE-340-BP10-LAUNCH-RUNBOOK.md) §3, §5 · **Evidence ledger:** [DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) §4

> **Operator-only.** Governed Org-0 live-enable ceremony — **NOT STARTED**. Execute only after **HC-3.5 COMPLETE** (closure §3.5 sealed) and Architect authorization (precondition P-5). **STOP after Step 7** — do **not** proceed to L4 without **HC-2** (sequencing) and **HC-5** (supervision).  
> **UX backlog (post-MVP):** [DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md](DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md)

---

## Purpose

Exercise the ADR-0011 governed Org-0 live-enable FSM (L3) so the live path reaches **ENABLED** with a **minimal notional cap** (Architect-approved; default **10 USDT** per runbook §5) before any supervised live order (L4).

This checklist arms the live path only. It does **not** place a live order.

---

## Scope

| In scope | Out of scope (see Non-goals) |
|----------|------------------------------|
| Pre-flight re-confirmation PF-1–PF-10 on execution day | First capped live spot order (L4) |
| Org-0 live-enable FSM: `DISABLED → REQUESTED → COOLING_OFF → ENABLED` | Strategy promotion or validation-gate bypass |
| Cooling-off wait and explicit ack confirmation | L2 / HC-3 billing re-exercise |
| Post-enable status + optional fail-closed probes (no order) | `dev→main` promotion (L5) |
| Evidence handoff to closure report §4 | External-org or multi-tenant enablement |
| Org-0 in-house capital only ([ADR-0009](../adr/0009-regulatory-posture.md)) | Runtime or MVP scope changes |

**FSM (canonical):** `DISABLED → REQUESTED → COOLING_OFF → ENABLED → DISABLED` (disable is L4 post-order or abort only — **not** part of HC-4 success path).

**Governed surfaces (pick one; both write the same audit trail on Postgres):**

- **CLI (runbook-canonical):** `pnpm trader:live:request`, `confirm`, `enable`, `status` — requires `WAIA_TRADER_CLI=1`, `WAIA_DB_BACKEND=postgres`, and non-empty `DATABASE_URL_POSTGRES` on the execution host
- **Admin UI (alternate):** `/admin/live-enable` on production trader host — Request / Confirm / Mark enabled

**U1 policy:** Production launch uses **Postgres** only. SQLite `DATABASE_URL` without `WAIA_DB_BACKEND=postgres` is for **local BP-7 drills** — not HC-4 on production.

---

## Explicit non-goals

- **No** live spot order — L4 is a separate ceremony under HC-2 + HC-5.
- **No** strategy promotion or validation-gate bypass ([ADR-0010](../adr/0010-strategy-validation-gate.md)).
- **No** L2 / HC-3 billing gate re-exercise — criterion **10** is **PASS**; closure §3 is sealed.
- **No** `dev→main` Launch promotion (L5).
- **No** external-org or multi-tenant live enablement ([ADR-0009](../adr/0009-regulatory-posture.md)).
- **No** runtime, architecture, or MVP scope changes.

---

## Preconditions (verify before Step 0)

| # | Check | Expected |
|---|-------|----------|
| P-0 | L0–L2 sealed | Closure report §2 **COMPLETE**; §3 **COMPLETE**; criterion **10** **PASS** |
| P-0b | HC-3.5 complete | Closure report §3.5 **COMPLETE**; production Postgres **EFFECTIVE** promotion for `mean_reversion_v0` @ `0.1.0` |
| P-1 | L3 not started | Closure report §4 `_not started_`; §5 `_not started_` |
| P-2 | Org-0 live-enable DISABLED | Admin `/admin/live-enable` or `pnpm trader:live:status` → state **DISABLED** (or equivalent not-enabled) |
| P-3 | Org-0 identity | Organization UUID matches operator vault Org-0 (org prefix **`3c50b4e9…`** per BP-9A Step 4) |
| P-4 | Platform admin session | If using admin UI: signed-in operator with platform **`admin`** role on production trader host |
| P-5 | Architect authorization | Explicit written or recorded go-ahead to begin HC-4 execution (date only in evidence — no secrets) |
| P-6 | HC-4 package published | This checklist + runbook §5 + closure §4 slot cross-linked on canonical `dev` |
| P-7 | Canonical `dev` SHA (PF-9) | `9e0deaaf0c85dd7efc6a2988780e64356c87432b` (IMP-U1 S8 / sign-off) — re-run validation chain if `dev` has advanced |

If **any** precondition fails: **STOP**. Do not run `pnpm trader:live:request` or equivalent admin Request command.

---

## Step 0 — Pre-flight checks (PF-1–PF-10)

Re-confirm immediately before HC-4 execution. All must **PASS**; record evidence in the table below.

| # | Check | How | Expected evidence shape | Operator result | Timestamp (ISO-8601) |
|---|-------|-----|-------------------------|-----------------|----------------------|
| PF-1 | Execution host health | `GET /health` on execution host (operator vault URL) | HTTP **200**; `{"status":"ok","service":"ai-trader-execution-host"}` | | |
| PF-2 | HTX Step-5 sync re-confirm | Trader Workspace `/trader` — balance, position, trade-history sync for Org-0 credential | HTTP **200** on sync; credential count **1**; `withdrawForbidden=true`; `transferForbidden=true` | | |
| PF-3 | Master-key decrypt probe | Host/CLI path resolves production Secrets Store / `AI_TRADER_MASTER_KEY` (no secret values logged) | Decrypt succeeds or explicit fail-closed denial with actionable error | | |
| PF-4 | Kill-switch posture | Admin console — global/org kill switches | All clear (not armed) before enable | | |
| PF-5 | Criterion 10 gate sealed | Closure report §3 — L2 / HC-3 **COMPLETE**; criterion **10** **PASS** | **Do not re-run billing gate** | | |
| PF-6 | Production promotion (Postgres) | Admin `/admin/strategy-promotions` or read-only query on `trader_strategy_promotion_records` for Org-0 | **EFFECTIVE** row for `mean_reversion_v0` @ `0.1.0` — sealed in closure §3.5; **not** DEE-178 SQLite replay alone | | |
| PF-7 | Org-0 allowlist | `WAIA_TRADER_ORG0_ORGANIZATION_ID` set on host/CLI env | Live path rejects non-Org-0 fail-closed | | |
| PF-8 | Telegram alerting | Production drill endpoint or recent alert telemetry | Router configured; non-blocking delivery path live | | |
| PF-9 | Validation chain (repo) | `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` on canonical `dev` SHA | All green | | |
| PF-10 | Postgres launch env | Execution host / CLI env for `trader:live:*` | `WAIA_DB_BACKEND=postgres` + `DATABASE_URL_POSTGRES`; fail-closed without both | | |

**PF pass count required:** **10/10**. If any row fails, **STOP** — do not proceed to Step 1.

---

## Step 1 — Verify baseline state (DISABLED)

1. Confirm Org-0 organization selected (prefix **`3c50b4e9…`**).
2. Read current live-enable state:

   **CLI:**

   ```bash
   pnpm trader:live:status -- --org-id=<ORG0>
   ```

   **Admin UI:** `/admin/live-enable` → Load state.

3. Confirm state is **DISABLED** (or equivalent not-enabled).
4. Record baseline `stateVersion` (typically **0** or absent) and ISO-8601 timestamp.

If state is already **REQUESTED**, **COOLING_OFF**, or **ENABLED**: **STOP** — escalate to Architect before continuing. Do not stack a second enable sequence.

---

## Step 2 — Request live-enable (DISABLED → REQUESTED)

**Purpose:** Record intent and set minimal notional cap under ADR-0011.

**CLI (replace `<ORG0>` and cap per Architect approval; default **10** USDT):**

```bash
pnpm trader:live:request -- --org-id=<ORG0> --actor-id=operator --cap=10
```

**Admin UI:** `/admin/live-enable` → set **Max notional cap** → **Request**.

**System behavior:**

- State transitions to **REQUESTED**.
- `stateVersion` increments (expect **1** on first request).
- Audit action emitted: **`trader.org_live_enable.requested`**

**Operator confirms and records:**

| Field | Value |
|-------|-------|
| `max_notional_cap` (USDT) | Number only (e.g. `10`) |
| `stateVersion` after request | Integer |
| Request timestamp | ISO-8601 |
| Audit action observed | `trader.org_live_enable.requested` |

---

## Step 3 — Confirm with explicit ack (REQUESTED → COOLING_OFF)

**Purpose:** ADR-0011 explicit confirmation — deliberate multi-step ack, not a single click.

**Required ack phrase (exact; fail-closed on mismatch):** `ENABLE ORG-0 LIVE TRADING`

**CLI:**

```bash
pnpm trader:live:confirm -- --org-id=<ORG0> --actor-id=operator --expected-state-version=1 --ack="ENABLE ORG-0 LIVE TRADING"
```

Use the **actual** `stateVersion` from Step 2 if not `1`.

**Admin UI:** `/admin/live-enable` → **Confirm** (ack phrase must match exactly).

**System behavior:**

- State transitions to **COOLING_OFF**.
- `coolingOffEndsAt` set (default **15 minutes** — `TRADER_ORG_LIVE_ENABLE_COOLING_OFF_MS` override only in test).
- Audit action emitted: **`trader.org_live_enable.confirmed`**

**Operator confirms and records (confirmation evidence):**

| Field | Value |
|-------|-------|
| Ack phrase used | `ENABLE ORG-0 LIVE TRADING` (exact match confirmed) |
| `coolingOffEndsAt` | ISO-8601 from CLI output or admin JSON |
| `stateVersion` after confirm | Integer |
| Confirm timestamp | ISO-8601 |
| Audit action observed | `trader.org_live_enable.confirmed` |

**Hard rule:** Wrong ack phrase → rejected fail-closed. Do not retry with a variant phrase.

---

## Step 4 — Wait for cooling-off (COOLING_OFF)

1. Note `coolingOffEndsAt` from Step 3.
2. Wait until current time is **strictly after** `coolingOffEndsAt`.
3. Do **not** run mark-enabled / **Enable** before cooling-off elapses (`OrgLiveEnableCoolingOffNotElapsedError` fail-closed).

**Operator records (cooling-off evidence):**

| Field | Value |
|-------|-------|
| `coolingOffEndsAt` | ISO-8601 (from Step 3) |
| Actual wait-end timestamp | ISO-8601 (when operator verified elapsed) |

---

## Step 5 — Mark enabled (COOLING_OFF → ENABLED)

**CLI (`trader:live:enable` maps to `mark-enabled` subcommand):**

```bash
pnpm trader:live:enable -- --org-id=<ORG0> --actor-id=operator --expected-state-version=2
```

Use the **actual** `stateVersion` from Step 3 if not `2`.

**Admin UI:** `/admin/live-enable` → **Mark enabled**.

**System behavior:**

- State transitions to **ENABLED**.
- `enabledAt` recorded.
- Audit action emitted: **`trader.org_live_enable.enabled`**

**Operator confirms and records:**

| Field | Value |
|-------|-------|
| Final org live-enable state | **ENABLED** |
| `enabledAt` | ISO-8601 from CLI output or admin JSON |
| `stateVersion` after enable | Integer |
| Enable timestamp | ISO-8601 |
| Audit action observed | `trader.org_live_enable.enabled` |

---

## Step 6 — Post-enable verification (status + optional fail-closed probes)

**Required:** Re-read status only.

```bash
pnpm trader:live:status -- --org-id=<ORG0>
```

Confirm: `state=ENABLED`, `enableEligible=false` (already enabled), cap matches Step 2.

**Optional fail-closed probes (document PASS/FAIL; do not place orders):**

| Probe | Expected | Operator result |
|-------|----------|-----------------|
| Wrong ack phrase on confirm (validation) | Rejected fail-closed if retested in staging — document N/A if not re-run | |
| Early mark-enabled before cooling-off | `OrgLiveEnableCoolingOffNotElapsedError` — already validated by Step 4 wait | PASS if Step 4 wait observed |
| Host `/health` down during gate probe | `ExecutionHostUnavailableError` on live path — host must be **200** at PF-1 | |
| Non-Org-0 org id on CLI | Live path fail-closed | |

**Do not** run any live order command in this step.

---

## Step 7 — Evidence handoff (closure report §4)

Complete [closure report §4](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md):

| Field | Operator supplies |
|-------|-------------------|
| **Status** | **COMPLETE** |
| Final org live-enable state | **ENABLED** |
| `trader_org_live_enable_events` row count | Count only (no row contents) |
| Audit actions emitted | Minimum: `trader.org_live_enable.requested`, `trader.org_live_enable.confirmed`, `trader.org_live_enable.enabled` |
| `max_notional_cap` (USDT) | Number from Step 2 |
| Fail-closed probes | PASS/FAIL per probe in Step 6 |
| Operator attestation | Name/role + date |
| Date | ISO-8601 (HC-4 completion) |

**Evidence capture template (record in closure §4 or hand to Composer):**

```text
Org prefix:               3c50b4e9
Max notional cap (USDT):  <N>
Final state:              ENABLED
State version (final):    <N>
Cooling-off ends at:      <ISO-8601>
Enabled at:               <ISO-8601>
Event row count:          <N>
Audit actions:            trader.org_live_enable.requested,
                          trader.org_live_enable.confirmed,
                          trader.org_live_enable.enabled
PF pass count:            10/10
Fail-closed probes:       <PASS/FAIL summary>
Operator:                 <Operator name/role> — <date>
Live order placed:        NO
```

---

## STOP boundary (before L4)

**STOP after Step 7.**

HC-4 is **COMPLETE** only when:

1. Closure report §4 is populated with the evidence above.
2. Org-0 live-enable state is **ENABLED**.
3. Operator attestation includes **“No live order placed.”**

**Do not** proceed to L4 in the same session unless **both** are explicitly authorized:

- **HC-2 (Architect):** Launch sequencing decision (order-before-promote vs promote-first)
- **HC-5 (Operator + Architect):** Supervised first capped live order

L4 uses runbook §6 — a **separate** operator ceremony. HC-4 success does **not** authorize L4 by itself.

---

## Abort / rollback

| Situation | Action |
|-----------|--------|
| Any PF-1–PF-10 check fails | **STOP** — do not request enable |
| Wrong org selected | Do not confirm; if **REQUESTED**, disable/cancel per [runbook §9](DEE-340-BP10-LAUNCH-RUNBOOK.md) |
| Wrong ack phrase | Abort confirm; remain **REQUESTED** or disable back to **DISABLED** |
| Cooling-off bypass attempted | Wait; do not bypass |
| Enable succeeds but cap wrong | `pnpm trader:live:disable` immediately; document; restart from Step 1 only if Architect re-authorizes |
| Unexpected state mid-FSM | Disable if **ENABLED**; record abort reason in closure §4 notes; escalate |

**Disable command (abort only — not HC-4 success path):**

```bash
pnpm trader:live:disable -- --org-id=<ORG0> --actor-id=operator --expected-state-version=<N> --reason="abort: <short reason>"
```

Audit action: **`trader.org_live_enable.disabled`**

---

## Secret redaction rules

Same discipline as closure report header:

- **Never** record API keys, tokens, ciphertext, wallet balances, or `.env*` values.
- **Permitted:** HTTP status codes, org id **prefix** (first 8 chars), event **counts**, audit **action names**, ISO-8601 timestamps, USDT cap **number**, state enum values, `stateVersion` integers.

---

## Final operator attestation

| Field | Operator supplies |
|-------|-------------------|
| Name / role | |
| Date (ISO-8601) | |
| Org prefix | First 8 chars of Org-0 UUID |
| `max_notional_cap` (USDT) | |
| Final live-enable state | **ENABLED** |
| `trader_org_live_enable_events` row count | |
| Audit actions (list) | `requested`, `confirmed`, `enabled` (minimum) |
| PF pass count | **10/10** |
| Fail-closed probes summary | PASS / FAIL |
| Live order placed | **NO** (required) |
| HC-4 verdict | **COMPLETE** / **ABORTED** |

---

## References

- [ADR-0011 — Single Operator Governance Model](../adr/0011-single-operator-governance-model.md)
- [ADR-0009 — Regulatory posture](../adr/0009-regulatory-posture.md)
- [ADR-0010 — Strategy Validation Gate](../adr/0010-strategy-validation-gate.md)
- [DEE-340-BP10-LAUNCH-RUNBOOK.md](DEE-340-BP10-LAUNCH-RUNBOOK.md) §3, §5, §9
- [DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md](DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md)
- [DEE-340-BP10-L2-HC3-OPERATOR-CHECKLIST.md](DEE-340-BP10-L2-HC3-OPERATOR-CHECKLIST.md) — **COMPLETE** (do not re-run)
- Admin surface: `app/(trader)/admin/live-enable/page.tsx` · CLI: `scripts/trader/live-cli.ts`
- Required ack constant: `ENABLE ORG-0 LIVE TRADING` (`lib/trader/live/config.ts`)
