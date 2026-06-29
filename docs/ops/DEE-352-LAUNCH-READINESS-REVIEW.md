# DEE-352 — Launch Readiness Review

**Linear:** [DEE-352](https://linear.app/deepsense/issue/DEE-352/bp-9a-full-mvp-verification-production-configuration-inventory) — **Done** (Step 10 complete)  
**Branch:** merged via [PR #318](https://github.com/oumaster369/waia/pull/318) + [PR #319](https://github.com/oumaster369/waia/pull/319) + [PR #320](https://github.com/oumaster369/waia/pull/320)  
**Canonical `dev` SHA:** `16117d01745d2552bc6275120bf799c082d20d30` (2026-06-29)  
**Baseline (Phase 1 start):** `dev` @ `0149267` (BP-9 merged, PR #317)  
**Review date:** 2026-06-28 · **Step 10:** 2026-06-29  
**Authority:** Architect review gate immediately before production provisioning

---

## 1. Scope

This review answers one question only:

**Is WAIA AI-TRADER allowed to begin production provisioning?**

This review does **not** verify implementation. Implementation is complete through **BP-9** (merged on `dev`).

This review verifies **launch readiness** only: architecture frozen, build packages closed, verification inventory complete, residual risks classified, and governance gates defined before any operator touches production secrets or infrastructure.

Production provisioning is **not** part of BP-9A Phase 1 verification. It begins only after this review is **accepted** (see §8).

---

## 2. Architecture summary (post BP-9)

After BP-9, the AI-TRADER MVP architecture is frozen as follows:

| Principle | State |
|-----------|--------|
| **Worker = Control Plane** | Cloudflare Worker hosts OpenNext app, cron, health probes, admin API, paper/market orchestration, billing watcher triggers — no live order placement on Worker |
| **Execution Host = Execution Plane** | Isolated off-Cloudflare host for bounded live CLI cycle (Option B); separate secret injection path |
| **Option B preserved** | Live spot execution bounded to execution host + Org-0 CLI; Worker does not call exchange `placeOrder` for live |
| **Fail-closed** | Missing config, bad data, kill switches, tenant isolation, org allowlist, and master-key readiness deny unsafe paths |
| **Single source of truth** | Master Execution Plan + MVP Execution Program v2 + Master Spec v2; BP-9A Step 10 + §12 **satisfied** 2026-06-29 — DEE-340 (BP-10) **authorized**, not started |
| **No duplicated runtime** | No second scheduler, daemon, websocket loop, or parallel execution FSM beyond approved cron + host |
| **No unauthorized execution path** | ADR-0009 external live blocked; Org-0 only; admin-gated live-enable; validation-gate promotion required |
| **Governed promotion** | ADR-0010/0011 — strategy validation gate, cooling-off, CLI-only promotion request |
| **Governed billing** | ADR-0008 manual invoice attestation; HWM + 30% fee; payment watcher attribution |
| **Governed alerting** | BP-9 inline Alert Router on existing telemetry only; dedicated `TELEGRAM_ALERTS_*` secrets; non-blocking delivery |

Alerting, admin console, HTX connect/sync UI, paper/AHR evidence, and tenant-isolation CI are **implemented** — production **configuration and runtime proof** **complete** (Phase 2 — **11/11 PASS**, Step 10 complete 2026-06-29; see §4).

---

## 3. Completed build packages (BP-0 → BP-9)

| BP | Status | Purpose | Evidence |
|----|--------|---------|----------|
| BP-0 | Complete | Docs / Linear hygiene | PR #305 |
| BP-1 | Complete | AHR validation closure | PR #304 · [DEE-337](DEE-337-P5-TWO-STRATEGY-AHR-CLOSURE-REPORT.md) |
| BP-2 | Complete | RC dev→main + back-sync | PR #306 · PR #307 |
| BP-2A | Complete | HTX backend audit baseline | [DEE-348](https://linear.app/deepsense/issue/DEE-348) |
| BP-2B | Complete | HTX integration hardening | Master plan closure |
| BP-2C | Complete | Trader workspace (connect + sync UI) | PR #308 · [DEE-350](https://linear.app/deepsense/issue/DEE-350) |
| BP-3 | Complete | Billing suspension lifecycle | PR #309 |
| BP-4 | Complete | Reporting + HWM + manual invoice gate | PR #310 |
| BP-5 | Complete | Strategy validation gate | PR #311 · PR #312 · DEE-178 |
| BP-6 | Complete | Execution host scaffold | PR #314 · [DEE-339](DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md) |
| BP-7 | Complete | Org-0 live CLI path (bounded) | PR #315 · [DEE-212](DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md) |
| BP-8 | Complete | Admin console + controls | PR #316 · DEE-218 · DEE-219 |
| BP-9 | Complete | Telegram inline Alert Router | PR #317 · [DEE-223](DEE-223-BP9-TELEGRAM-ALERTING-RUNBOOK.md) |

**BP-9A Phase 1** (inventory verification, no provisioning): complete — see [DEE-352-BP9A-MVP-VERIFICATION-REPORT.md](DEE-352-BP9A-MVP-VERIFICATION-REPORT.md).

---

## 4. Outstanding production work (Phase 2 summary)

Full step order and evidence slots live in the BP-9A report §10. This section lists **categories only**:

| Category | Phase 2 scope (operator) |
|----------|--------------------------|
| **Secrets** | Postgres URI, Secrets Store master key, Telegram alerts, TronGrid/RPC, OAuth if used, host-injected secrets |
| **DNS** | `trader.waia.life` custom domain + Supabase redirect URLs |
| **HTX** | Org-0 Read+Trade credentials, connect, permission proof, balance/position/history sync |
| **Telegram** | Dedicated Alerts Bot, forum **Alerts** topic, `--send` drill, delivery telemetry |
| **Execution Host** | Step 8: isolated host, `/health` 200, `WAIA_TRADER_EXECUTION_HOST_URL` (operator env) — **not** BP-7 live bundle |
| **Payment Watcher** | Step 6 **PASS** — scan cycle; TronGrid/RPC; health probe; **runtime recovery PASS** 2026-06-29 (§10.1 in BP-9A report) |
| **Payment address registry** | Step 9A: `payment_wallets`, `payment_addresses`, watcher resolution, attribution readiness — **not** settlement wallet ceremony |
| **Cron workers** | Step 9: runtime compatibility gate, then `MARKET_BRAIN_*` / `PAPER_LOOP_*` |
| **Runtime verification** | Production `/api/health/*`, cron telemetry, admin walkthrough, MVP checklist criteria 3–5, 10–12, 15–16 |

**Reference:** [DEE-352-BP9A-MVP-VERIFICATION-REPORT.md](DEE-352-BP9A-MVP-VERIFICATION-REPORT.md) §2 inventory, §4 checklist, §10 playbook.

---

## 5. Residual risks

### Blocking (must resolve in Phase 2 before BP-10)

| Risk | Notes |
|------|-------|
| Production secrets unprovisioned | **Resolved** — Steps 2, 6, 7, 9, 9A **PASS**; Step 10 governance waivers remain |
| No production runtime evidence | **Resolved** — registry, watcher (recovery **PASS**), Telegram, cron MB/paper **PASS**; canonical deploy **`86bde72b…`** from `dev` @ `2071130` |
| Execution host not deployed | **Resolved** — Step 8 **PASS** (2026-06-28); BP-6 `/health` only; not BP-7 live orders |
| Org-0 HTX not connected in production | **Resolved** — Step 5 **PASS** (2026-06-28) |
| Phase 2 evidence incomplete | **RESOLVED** — **11/11 PASS**; Step 10 complete 2026-06-29 |

### Accepted (documented; do not alone block BP-10)

| Risk | Notes |
|------|-------|
| User journey Steps 5–6 UI gaps | Strategy/paper UI absent; **INFORMATIONAL GAP** — AHR satisfies criterion 8 for Org-0 MVP |
| Dual auth path (Supabase vs legacy) | Production path to be confirmed during Phase 2 |
| MVP checklist 14+2 numbering | Reconciled in BP-9A report as 14 program + 2 BP-9A extensions |

### Deferred (post-MVP / follow-up)

| Risk | Notes |
|------|-------|
| Credential-failure alert emitters | BP-9 router ready; emitters deferred per BP-9 plan |
| Hyperdrive / full RBAC / key rotation | Post-MVP frozen |
| `WAIA_CORE_ENFORCEMENT` default off | **Resolved (Step 10)** — **OFF** on production; post-MVP enable via ADR |

---

## 6. Launch Decision Matrix

| Outcome | Meaning | Who decides | Next action |
|---------|---------|-------------|-------------|
| **READY FOR PRODUCTION PROVISIONING** | Architecture frozen; Phase 1 complete; no blocking risks; operator may begin Phase 2 §10 Step 1 | Architect + Operator | Start Phase 2 in strict order |
| **READY WITH CONDITIONS** | Architecture acceptable; provisioning allowed only after named conditions met | Architect | Operator executes conditions; re-review if conditions fail |
| **BLOCKED** | Named blocking risk cannot proceed safely | Architect | Remediate blocker; do not provision |
| **NOT READY** | Implementation or verification incomplete | Architect | Complete BP-9A Phase 1 or close build gaps |

---

## 7. Current decision

**Decision:** **READY WITH CONDITIONS** — **ACCEPTED**

**Conditions (active for Phase 2 execution):**

1. Phase 2 must execute steps **1 → 7 → 8 → 9 → 9A → 10** strictly in order (Step 9A **not** between 7 and 8)
2. **Reality Preconditions** block required before Steps 8–10 (see BP-9A report §10.0)
3. Step 9: Worker runtime compatibility gate **before** enabling `MARKET_BRAIN_*` / `PAPER_LOOP_*`
4. Step 6 PASS = watcher scan cycle only; payment attribution = Step 9A
5. OpenAI secrets for AI-TRADER: **N/A for BP-9A** (Twin-only `WAIA_AI_*`)
6. Settlement wallet ceremony (ADR-0013) **outside BP-9A**; Step 9A = payment address registry only
7. No secret values may be recorded in any artifact
8. Composer may **guide and record evidence only** — no autonomous provisioning
9. Every failed verification **stops** the sequence
10. **BP-10 may begin** after DEE-352 Step 10 + §12 complete — **satisfied** 2026-06-29

**BP-9A complete.** DEE-352 **Done** (Step 10, 2026-06-29). **BP-10 (DEE-340) may begin** — launch authorization gate; not started. No live order; no `dev→main` promotion yet.

### Architect sign-off

| Field | Value |
|-------|-------|
| Decision | **READY WITH CONDITIONS** |
| Signed by | Adamar / Architect-Operator |
| Date | 2026-06-28 |

### Operator acknowledgment

| Field | Value |
|-------|-------|
| Acknowledged | Adamar / Architect-Operator |
| Date | 2026-06-28 |

---

## 8. Governance

| Rule | Enforcement |
|------|-------------|
| Production provisioning is **not** part of BP-9A Phase 1 verification | Phase 1 = repo/docs inventory only |
| Production provisioning begins **only after** this Launch Readiness Review is **accepted** | Gate between Phase 1 and Phase 2 |
| Phase 2 is **operator-led**; Composer records evidence, does not autonomously provision secrets | BP-9A report §10 protocol |
| BP-10 (DEE-340) starts after DEE-352 Step 10 + §12 | **Satisfied** 2026-06-29 — DEE-352 **Done** |
| MVP Scope Freeze active | No new MVP features before BP-10 — see BP-9A report |

**Execution order:**

```
Phase 1 (complete) → Launch Readiness Review (this document) → Phase 2 (Steps 1→7→8→9→9A→10) → BP-10
```

**Plan revision (2026-06-28):** Reality Preconditions Audit integrated — see BP-9A report §10.0 and plan §2A.

---

## 9. References

| Document | Role |
|----------|------|
| [DEE-352-BP9A-MVP-VERIFICATION-REPORT.md](DEE-352-BP9A-MVP-VERIFICATION-REPORT.md) | Phase 1 inventory, Phase 2 playbook, MVP checklist |
| [AI-TRADER MVP Ratification](../ai-trader/AI-TRADER-MVP-RATIFICATION.md) | Step 10 closure seal — **RATIFIED** 2026-06-29 |
| [DEE-340 (BP-10)](https://linear.app/deepsense/issue/DEE-340) / `.cursor/plans/bp-9a_verification_readiness_903a27e2.plan.md` (closed) | BP-9A **COMPLETE**; next executable package **BP-10** |
| [DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md](DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md) | Org-0 live CLI path |
| [DEE-223-BP9-TELEGRAM-ALERTING-RUNBOOK.md](DEE-223-BP9-TELEGRAM-ALERTING-RUNBOOK.md) | Alerting provisioning |
| [DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md](DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md) | Execution host |
| [ADR-0007](../adr/0007-targeted-rls-strategy.md) | Tenant isolation / RLS |
| [ADR-0008](../adr/0008-manual-billing-gate.md) | Manual invoice gate |
| [ADR-0009](../adr/0009-regulatory-posture.md) | External live blocked |
| [ADR-0010](../adr/0010-strategy-validation-gate.md) | Validation gate |
| [ADR-0011](../adr/0011-single-operator-governance-model.md) | Governed actions |

---

**STOP:** BP-9A **COMPLETE**. **Begin BP-10 (DEE-340)** when ready. MVP not launched on `main`.
