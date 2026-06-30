# DEE-340 / BP-10 — Org-0 Live Launch Operator Runbook

**Linear:** [DEE-340](https://linear.app/deepsense/issue/DEE-340) · **Pipeline:** P8 / BP-10 · **Milestone:** M10 — MVP Launch  
**Type:** Launch authorization ceremony (no product code)  
**Authority:** [BP-10 Canonical Execution Plan](../../.cursor/plans/bp-10_launch_execution_plan_e2aa412c.plan.md) · [MVP Ratification Charter](../ai-trader/AI-TRADER-MVP-RATIFICATION.md) §6  
**Evidence ledger:** [DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md)

> **This runbook performs no implementation.** It is the ordered ceremony for sealing the architecturally-complete AI-TRADER MVP onto `main` through one governed Org-0 live spot order, a Launch promotion, and mandatory back-sync. ADR-0009 remains `Accepted (Posture)` throughout — launching does **not** unlock external live trading.

---

## 1. Scope and boundaries

| In scope | Out of scope |
|----------|--------------|
| Pre-flight re-confirmation on production | New MVP features or code changes |
| Criterion 10 manual billing gate exercise (L2) | Secret provisioning (closed in BP-9A Phase 2) |
| ADR-0011 governed Org-0 live-enable (L3) | Autonomous or scheduled enablement |
| First capped supervised live spot order (L4) | Multi-org or external client live |
| `dev→main` Launch promotion + `main→dev` back-sync (L5) | Squash merge on promotion/back-sync |
| Close-out and monitoring window (L6) | ADR-0009 clearance |

**Option B invariants (must hold throughout):**

- Worker = Control Plane — **no** Worker-side HTX `placeOrder` for live
- Execution Host = Execution Plane — live dispatch via `pnpm trader:live:cycle` on the isolated host CLI only
- Org-0 only; READ + TRADE credentials; WITHDRAW/TRANSFER forbidden
- Single bounded order per cycle; fail-closed everywhere

**U1 persistence policy (IMP-U1 — fixed):**

- **Production launch** (HC-3.5, HC-4, L4): governed state on **Postgres** — Worker `WAIA_DB_BACKEND=postgres`; execution host CLI `WAIA_DB_BACKEND=postgres` + `DATABASE_URL_POSTGRES`
- **Admin UI** is the sole production **promotion Request** surface (HC-3.5)
- **SQLite** (`DATABASE_URL` file) and `pnpm trader:gate` remain **replay/BP-5 process proof only** — not production launch attestation
- Architect IMP-U1 sign-off **PASS** (2026-06-30 @ `9e0deaaf0c85dd7efc6a2988780e64356c87432b`)

**Related runbooks:** [DEE-212 BP-7 Live Execution](DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md) · [DEE-339 BP-6 Execution Host](DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md) · [DEE-220 Master Key](DEE-220-MASTER-KEY-RUNBOOK.md) · [DEE-223 Alerting](DEE-223-BP9-TELEGRAM-ALERTING-RUNBOOK.md) · [BP-9A Verification Report](DEE-352-BP9A-MVP-VERIFICATION-REPORT.md) · [L2.5 HC-3.5 Checklist](DEE-340-BP10-L2.5-HC3.5-OPERATOR-CHECKLIST.md)

---

## 2. Ceremony overview (L1 → L6)

Execute in strict order. **Stop on any failed verification.** Record evidence in the [closure report](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) (non-secret shapes only).

| Slice | Actor | Purpose | Human checkpoint |
|-------|-------|---------|------------------|
| **L1** | Composer records; Operator/Architect attest | Pre-launch verification on canonical `dev` SHA | After L1 — await Operator L2 |
| **L2** | Operator | Criterion 10 manual billing/HWM gate (ADR-0008) | HC-3 |
| **L2.5** | Operator (ADR-0010) | Production Postgres strategy promotion attestation | HC-3.5 |
| **L3** | Operator (ADR-0011) | Governed Org-0 live-enable FSM | HC-4 |
| **L4** | Operator + Architect | First capped supervised live spot order | HC-2 (sequencing) + HC-5 (supervision) |
| **L5** | Human merge; Composer packages | Launch promotion + back-sync | HC-6 |
| **L6** | Operator/Architect; Composer records | Close-out, monitoring window, DEE-340 Done | HC-7 |

**Recommended sequencing (HC-2):** Execute the L4 live order on the already-live dev-blessed production runtime, then promote `dev→main` as the sealing act, then verify 16/16 green on `main`. Alternative (promote-first) permitted if the Architect prefers `main`-blessed runtime for the order.

---

## 3. Pre-flight checks (before L3 / HC-4)

Re-confirm immediately before HC-4 live-enable (and again before L4 if on a later day). All must pass; **do not proceed** if any fail. **Prerequisite:** HC-3.5 **COMPLETE** — closure report §3.5 sealed; production Postgres EFFECTIVE promotion for drill strategy exists. Full operator table: [L3 HC-4 checklist](DEE-340-BP10-L3-HC4-OPERATOR-CHECKLIST.md) Step 0.

| # | Check | How | Expected evidence shape |
|---|-------|-----|-------------------------|
| PF-1 | Execution host health | `GET /health` on execution host (operator vault URL) | HTTP **200**; `{"status":"ok","service":"ai-trader-execution-host"}` |
| PF-2 | HTX Step-5 sync re-confirm | Trader Workspace `/trader` — balance, position, trade-history sync for Org-0 credential | HTTP **200** on sync; credential count **1**; `withdrawForbidden=true`; `transferForbidden=true` |
| PF-3 | Master-key decrypt probe | Host/CLI path can resolve production Secrets Store / `AI_TRADER_MASTER_KEY` (no secret values logged) | Decrypt succeeds or explicit fail-closed denial with actionable error |
| PF-4 | Kill-switch posture | Admin console — global/org kill switches | All clear (not armed) before enable |
| PF-5 | Criterion 10 gate sealed | Closure report §3 — L2 / HC-3 **COMPLETE**; criterion **10** **PASS** | **Do not re-run billing gate** |
| PF-6 | Production promotion (Postgres) | Admin `/admin/strategy-promotions` or read-only Postgres query on `trader_strategy_promotion_records` | **EFFECTIVE** row for `mean_reversion_v0` @ `0.1.0` on Org-0 — attested in closure §3.5 (**not** DEE-178 SQLite replay alone) |
| PF-7 | Org-0 allowlist | `WAIA_TRADER_ORG0_ORGANIZATION_ID` set on host/CLI env | Live path rejects non-Org-0 fail-closed |
| PF-8 | Telegram alerting | Production drill endpoint or recent alert telemetry | Router configured; non-blocking delivery path live |
| PF-9 | Validation chain (repo) | `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` on canonical `dev` SHA | All green |
| PF-10 | Postgres launch env (execution host) | Host/CLI env for live commands | `WAIA_DB_BACKEND=postgres` + non-empty `DATABASE_URL_POSTGRES`; **not** SQLite `DATABASE_URL` alone for production launch |

**Secret discipline:** No API keys, tokens, ciphertext, or `.env*` values in any artifact. Use counts, HTTP codes, id prefixes, and audit action names only.

---

## 4. L2 — Criterion 10 manual billing gate (Operator, HC-3) — **COMPLETE**

**Prerequisite — Deployment Verification:** **COMPLETE** (PR #331 evidence on `dev`; production Worker `waia-app` @ `a23dca0a` deployed from git `822dfd0`). See [closure report §3 deployment verification](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md).

**Status:** **HC-3 COMPLETE** (2026-06-29). Criterion **10** **PASS**. Production evidence recorded in closure report §3.

**Purpose:** Close the one OPERATOR-REQUIRED MVP checklist item before live capital — **achieved**.

**Operator checklist (executed):** [DEE-340-BP10-L2-HC3-OPERATOR-CHECKLIST.md](DEE-340-BP10-L2-HC3-OPERATOR-CHECKLIST.md)

**Recorded evidence (closure report §3):**

| Field | Value |
|-------|-------|
| Invoice id prefix | `2cedeaa5` |
| Reporting period id prefix | `d926e5ff` |
| Exchange account id | `htx-spot-1` |
| Gate attestation count | **6** |
| Manual sign-off timestamp | `2026-06-29T17:35:34.798Z` |
| Cooling-off until | `2026-06-29T17:50:34.798Z` |
| Issued-at timestamp | `2026-06-29T17:57:37.216Z` |
| HWM bootstrap prefix | `0424c555` @ `0` |
| HWM ratchet prefix | `6a182789` @ `100` |
| Audit actions | `trader.hwm.bootstrapped`, `trader.reporting_period.opened`, `trader.reporting_period.closed`, `trader.invoice.draft_generated`, `trader.invoice.issuance_approved`, `trader.invoice.issued` |
| Criterion 10 status | **PASS** |

**UX backlog (post-MVP, no implementation):** [DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md](DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md)

**STOP:** L2 **COMPLETE**. **HC-3.5 package READY** ([L2.5 HC-3.5 checklist](DEE-340-BP10-L2.5-HC3.5-OPERATOR-CHECKLIST.md)). **HC-3.5 NOT EXECUTED**. **HC-4 NOT EXECUTED**. Do not live-enable until HC-3.5 complete and Architect authorizes HC-4 (checklist P-5).

---

## 4.5. L2.5 — Production strategy promotion (Operator, HC-3.5)

**Status:** **NOT EXECUTED** — operator package **READY** ([L2.5 HC-3.5 checklist](DEE-340-BP10-L2.5-HC3.5-OPERATOR-CHECKLIST.md)).

**Purpose:** Create the production-attested **EFFECTIVE** promotion record on **Postgres** for the BP-10 drill strategy before any live-enable (L3).

**Prerequisites:** IMP-U1d / PROC merged on `dev`; Architect IMP-U1 sign-off PASS; HC-3.5 unlock conditions 1–5 satisfied.

**Drill strategy (fixed):** `mean_reversion_v0` @ `0.1.0` only.

**Governed surface:** Admin UI **`/admin/strategy-promotions`** — sole production **Request** surface. Do **not** use `pnpm trader:gate` for production launch attestation.

**FSM:** Request → confirm → cooling-off → effective (existing validation-gate service).

**Evidence shapes (record in closure report §3.5):**

| Field | Value |
|-------|-------|
| Promotion record id prefix | `<first-8-chars>` |
| Final state | **EFFECTIVE** |
| Strategy / version | `mean_reversion_v0` / `0.1.0` |
| Postgres attestation | Exactly one EFFECTIVE row on Org-0 |
| Criterion 9 production attestation | **PASS** |

**HC-3.5 unlock (all required):** S1–S8 on `dev`; validation green; postgres-integration CI green; Architect sign-off recorded; **PROC PR merged**.

**STOP:** Composer records audit counts only; **do not proceed to L3 / HC-4** until §3.5 sealed.

---

## 5. L3 — Governed Org-0 live-enable (Operator, ADR-0011, HC-4)

**Status:** **NOT EXECUTED** — operator package **READY** ([L3 HC-4 checklist](DEE-340-BP10-L3-HC4-OPERATOR-CHECKLIST.md)).

**Purpose:** Arm the live path under the Single Operator Governance Model.

**FSM:** `DISABLED → REQUESTED → COOLING_OFF → ENABLED → DISABLED`

### Enable sequence

Replace `<ORG0>` with the Org-0 organization UUID. Set minimal notional cap (e.g. **10 USDT**).

```bash
pnpm trader:live:request -- --org-id=<ORG0> --actor-id=operator --cap=10
pnpm trader:live:confirm -- --org-id=<ORG0> --actor-id=operator --expected-state-version=1 --ack="ENABLE ORG-0 LIVE TRADING"
# wait cooling-off (default 15m; override TRADER_ORG_LIVE_ENABLE_COOLING_OFF_MS only in test)
pnpm trader:live:enable -- --org-id=<ORG0> --actor-id=operator --expected-state-version=2
pnpm trader:live:status -- --org-id=<ORG0>
```

**Required ack phrase:** `ENABLE ORG-0 LIVE TRADING` (exact; wrong phrase fail-closed).

**Fail-closed probes (optional but recommended before L4):**

| Probe | Expected |
|-------|----------|
| Wrong ack phrase on confirm | Rejected fail-closed |
| `mark-enabled` before cooling-off elapsed | `OrgLiveEnableCoolingOffNotElapsedError` |
| Host `/health` down during gate probe | `ExecutionHostUnavailableError` |
| Notional > cap in cycle | Risk veto / cap error |

**Evidence shapes (record in closure report § L3):**

| Field | Value |
|-------|-------|
| Final org live-enable state | **ENABLED** |
| `trader_org_live_enable_events` row count | `<N>` (count only) |
| Audit actions emitted | `trader.org_live_enable.*` (list action names) |
| `max_notional_cap` | `<USDT amount>` (number only) |

**STOP:** Composer records audit counts only; await L4.

---

## 6. L4 — First capped supervised live spot order (Operator + Architect, HC-2 + HC-5)

**Purpose:** The launch act — one real bounded Org-0 live spot order on HTX.

**Supervision:** Architect present; kill-switch reachable; Telegram alerting observed.

### Bounded live cycle (single order, terminates)

Run on the **isolated execution host** (Option B). Replace placeholders; **do not log secrets**.

**Production launch env (required):** `WAIA_DB_BACKEND=postgres` and `DATABASE_URL_POSTGRES` pointing at production Supabase pooler. SQLite `DATABASE_URL` alone is for **local BP-7 drills only** — not production launch.

```bash
pnpm trader:live:cycle -- \
  --org-id=<ORG0> \
  --account-key=htx-spot-1 \
  --exchange-account-id=htx-spot-1 \
  --strategy=mean_reversion_v0 \
  --version=0.1.0 \
  --credential-id=<CREDENTIAL_UUID> \
  --fixture-path=tests/fixtures/trader/btcusdt-1m-mean-reversion.json \
  --quantity=0.001 \
  --notional-cap=<MINIMAL_CAP_USDT>
```

Use a **minimal** `--notional-cap` (placeholder: **5 USDT** or lower per Architect approval). Collect stdout JSON evidence bundle; store **off-repo**.

### Seven-stage evidence (from cycle output)

| Stage | Evidence field | Expected |
|-------|----------------|----------|
| Strategy | `strategySignalId` | Present |
| Risk | `riskDecisionId` | APPROVE |
| Execution | `orderId` | Present; state → **FILLED** |
| HTX / Fill | `exchangeOrderId` | Present |
| Reconciliation | reconciliation outcomes | **clean** |
| Reporting | `reportingPeriodId`, `periodRealizedStrategyProfit` | Present |

### Disable immediately after successful cycle

```bash
pnpm trader:live:disable -- --org-id=<ORG0> --actor-id=operator --expected-state-version=<N>
pnpm trader:live:status -- --org-id=<ORG0>
```

**Evidence shapes (record in closure report § L4):**

| Field | Value |
|-------|-------|
| `orderId` prefix | `<first-8-chars>` |
| `exchangeOrderId` prefix | `<first-8-chars>` |
| Order state | **FILLED** |
| Reconciliation verdict | **clean** |
| `reportingPeriodId` prefix | `<first-8-chars>` |
| Post-drill live-enable state | **DISABLED** |

**STOP:** Composer transcribes non-secret evidence; await Architect launch decision for L5 sequencing.

---

## 7. L5 — Launch promotion + back-sync (Human merge, HC-6)

**Purpose:** Seal the full MVP onto `main`.

### 7.1 Launch promotion (`dev → main`)

| Rule | Value |
|------|-------|
| Merge method | **Create a merge commit** — never squash |
| PR base | `main` |
| PR head | `dev` |
| Governance preflight | `./scripts/linear/preflight-pr-governance.sh` on rendered PR body |
| Merge authority | **Human only** — agents never merge |

**Post-merge:**

1. Deploy production from `main`.
2. Verify all **16 MVP checklist criteria** green on `main` (re-run applicable production probes).
3. Confirm CI green on `main`.

### 7.2 Mandatory back-sync (`main → dev`)

Open **immediately** after Launch promotion merge:

| Rule | Value |
|------|-------|
| Merge method | **Create a merge commit** — never squash |
| PR base | `dev` |
| PR head | `main` |
| Purpose | Preserve ancestry; prevent drift |

**Evidence shapes (record in closure report § L5):**

| Field | Value |
|-------|-------|
| Launch promotion PR URL | `<URL>` |
| Launch merge commit SHA on `main` | `<SHA>` |
| Back-sync PR URL | `<URL>` |
| Back-sync merge commit SHA | `<SHA>` |
| 16/16 green on `main` attestation | **PASS** / date |

---

## 8. L6 — Close-out (Operator/Architect, HC-7)

**Purpose:** Declare BP-10 COMPLETE.

1. **Supervised monitoring window** — observe Telegram alerts + reconciliation telemetry for the agreed watch period (Architect sets duration).
2. **Finalize closure report** — all L2–L6 evidence slots signed; no secret values.
3. **Linear** — DEE-340 → **Done** (auto via `linear-done.yml` on merge if configured; else manual); milestone **M10** closed.
4. **Agent completion report** — per [POST-MERGE-PROTOCOL](../waia-governance/POST-MERGE-PROTOCOL.md).

**Exit criteria (all must be true):**

1. 16-criterion MVP checklist **green on `main`**
2. First capped live order placed, filled, reconciled, reported; live-enable **DISABLED** after
3. Launch promotion merged as merge commit; CI green on `main`
4. Back-sync merged as merge commit
5. DEE-340 Done; M10 closed
6. Closure report signed; monitoring window clean
7. ADR-0009 still `Accepted (Posture)`; no MVP scope added

---

## 9. Abort and rollback

**When to abort:** Any pre-flight failure; gate reject; partial fill with reconciliation mismatch; unexpected HTX error; cooling-off violation; secret exposure risk; scope creep detected.

### Immediate actions

1. **Disable live-enable** (if ENABLED):

   ```bash
   pnpm trader:live:disable -- --org-id=<ORG0> --actor-id=operator --expected-state-version=<N>
   ```

2. **Arm kill-switch** via admin console if unsafe state persists.

3. **Do not place additional live orders** until Architect re-authorizes.

4. **Record abort reason** in closure report (no secrets).

### Rollback paths

| Situation | Action |
|-----------|--------|
| Live order failed before fill | Disable live-enable; document gate/output; no promotion |
| Live order filled but reconciliation dirty | Disable; arm kill-switch; Architect review before any retry |
| Promotion merged but production deploy fails | Do not declare COMPLETE; remediate deploy; do not squash-fix ancestry |
| Back-sync not yet merged | Complete back-sync before any further `dev` work |
| Wrong ack phrase / skipped cooling-off | Abort enable sequence; return to DISABLED; restart L3 from `request` |

**Do not** use squash merge to "fix" a promotion or back-sync — this drops the second parent and recreates ancestry drift per [AGENTS.md](../../AGENTS.md).

---

## 10. Human checkpoints summary

| ID | Role | Gate |
|----|------|------|
| HC-1 | Architect | Approve L0 Launch Operations Package before production touch |
| HC-2 | Architect | Approve order-vs-promote sequencing before L4/L5 |
| HC-3 | Operator | Criterion 10 manual billing gate (L2) |
| HC-3.5 | Operator | Production Postgres strategy promotion (L2.5) |
| HC-4 | Operator | Governed live-enable (L3) |
| HC-5 | Operator + Architect | Supervise first capped live order (L4) |
| HC-6 | Human merge | Launch promotion + back-sync (L5) |
| HC-7 | Architect | Sign closure; declare COMPLETE (L6) |

**Agents guide, humans act.** Composer records evidence and packages PR bodies; humans provision secrets, enable live, execute the live order, and merge.

---

## 11. References

| Document | Role |
|----------|------|
| [BP-10 Canonical Execution Plan](../../.cursor/plans/bp-10_launch_execution_plan_e2aa412c.plan.md) | Authoritative ceremony sequence |
| [DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) | Evidence ledger |
| [DEE-340-BP10-L2-HC3-OPERATOR-CHECKLIST.md](DEE-340-BP10-L2-HC3-OPERATOR-CHECKLIST.md) | HC-3 operator steps (**COMPLETE**) |
| [DEE-340-BP10-L2.5-HC3.5-OPERATOR-CHECKLIST.md](DEE-340-BP10-L2.5-HC3.5-OPERATOR-CHECKLIST.md) | HC-3.5 operator steps (**READY — NOT EXECUTED**) |
| [DEE-340-BP10-L3-HC4-OPERATOR-CHECKLIST.md](DEE-340-BP10-L3-HC4-OPERATOR-CHECKLIST.md) | HC-4 operator steps (**READY — NOT EXECUTED**) |
| [DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md](DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md) | Post-MVP Operator Console UX backlog (HC-3 observations) |
| [DEE-352-BP9A-MVP-VERIFICATION-REPORT.md](DEE-352-BP9A-MVP-VERIFICATION-REPORT.md) | Baseline 16-criterion inventory |
| [DEE-352-LAUNCH-READINESS-REVIEW.md](DEE-352-LAUNCH-READINESS-REVIEW.md) | Launch readiness gate |
| [AI-TRADER-MVP-RATIFICATION.md](../ai-trader/AI-TRADER-MVP-RATIFICATION.md) | Scope freeze + BP-10 definition |
| [ADR-0011](../adr/0011-single-operator-governance-model.md) | Governed live-enable |
| [ADR-0008](../adr/0008-manual-billing-gate.md) | Manual billing gate |
| [ADR-0009](../adr/0009-regulatory-posture.md) | External live blocked |

**STOP:** L0 **COMPLETE** (PR #322). HC-1 **APPROVED** (2026-06-29). L1 **COMPLETE**. L2 **COMPLETE**. **HC-3 COMPLETE** (2026-06-29). Criterion **10** **PASS**. **IMP-U1 Engineering COMPLETE**. **Architect IMP-U1 Sign-off PASS** (2026-06-30). **HC-3.5 package READY** ([L2.5 HC-3.5 checklist](DEE-340-BP10-L2.5-HC3.5-OPERATOR-CHECKLIST.md)). **HC-3.5 NOT EXECUTED**. **HC-4 NOT EXECUTED**. **STOP before L3 execution** until HC-3.5 complete and Architect authorizes HC-4 (P-5).
