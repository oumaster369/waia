# AI-TRADER MVP — Execution Program v2

**Status:** Governing implementation program (Execution Freeze)  
**Effective:** 2026-06-26  
**Supersedes:** Roadmap sequencing for remaining MVP work; Implementation Program issue order for execution

Architecture is frozen. Only execution proceeds.

---

## Program Health Dashboard

| Metric | Value |
|--------|-------|
| Total Pipelines | 8 (P1–P8) |
| P1 status | **Closed** (PR #287 → `dev` @ `49e6705`, 2026-06-26) |
| P2 status | **Closed** (PR #290 → `dev` @ `bf8c326`, 2026-06-26) |
| P3 status | **Closed** (PR #292 → `dev` @ `934b23b`, 2026-06-26) |
| P4 status | **Closed** (PR #294 → `dev` @ `106d286`, 2026-06-27) |
| P5 status | **Pending** (entry criteria satisfied; not started) |
| Completed | 4 |
| Current | **P5 — Provable Paper Product (MVP-Paper)** (next) |
| Remaining | 4 |
| Pipeline completion | 4 / 8 (50%) |
| Execution Freeze | **Active** |
| MVP baseline merged to `dev` | ~60% |
| Remaining execution | ~40% |
| Critical Path | P1 → P2 → P3 → P4 → P5 (MVP-Paper RC) → P7 → P8 (MVP-Live Launch) |
| Non-critical | P6 (serial; parallel during P5 soak only with Architect authorization) |
| MVP-Paper | End of P5 |
| MVP-Live (full MVP) | End of P8 |

---

## Execution Contract

Immutable until MVP:

1. One active Pipeline at a time. No parallel Pipelines, except P6 during the P5 soak with explicit Architect authorization.
2. No new MVP scope; no product, architecture, or vision redesign.
3. No priority changes and no Critical Path reordering unless a Critical Architecture Review proves the current order is impossible.
4. No reopening Closed Pipelines.
5. Every Pipeline ends with: Architecture Review PASS → Implementation → PR Readiness PASS → Merge → Post-Merge PASS → Pipeline Closed → Next Pipeline Open.
6. A Pipeline may not start until the prior Pipeline has passed all Exit Criteria.
7. Humans own merge; agents never merge. Only two `dev→main` promotions (RC after P5, Launch after P8), each merge-commit + mandatory back-sync.
8. Validation chain (lint, typecheck, Postgres integration, tenant-isolation gate, build; e2e on UI changes) must be green before every merge.
9. Postgres-only for new trader code; SQLite removal is Post-MVP.
10. Anything not in P1–P8 is Post-MVP and must not delay launch.

**Execution Freeze:** This program supersedes all prior planning until AI-TRADER MVP is complete.

---

## Delivery Pipelines

Each Pipeline is atomic. Lifecycle: Architecture Review PASS → Implementation (stacked slices, one base branch) → PR Readiness PASS → Merge → Post-Merge PASS → Pipeline Closed.

### P1 — Frictionless Delivery

**Issues:** NEW-1, DEE-154, NEW-2 · **Risk:** LOW · **Milestone:** infra

| | |
|---|---|
| **Entry** | Program v2 frozen; Linear reconstructed; `dev` green |
| **Definition of Done** | NEW-1, DEE-154, NEW-2 merged; clean-checkout build green; single Linear-Done path; Postgres-only rule active |
| **Exit** | Full validation chain green on `dev`; Post-Merge audit PASS; P1 issues Done |

### P2 — Trustworthy Foundation

**Issues:** NEW-3, NEW-4, DEE-190, DEE-191 · **Risk:** MEDIUM · **Milestone:** M1 — WAIA Core

| | |
|---|---|
| **Entry** | P1 Closed |
| **Definition of Done** | Tenant-isolation gate required in CI and green; Org-0 provisioned at runtime; M1 formally closed |
| **Exit** | Deliberate cross-org leak fails CI; Post-Merge audit PASS |

### P3 — The Market Brain

**Issues:** DEE-197, DEE-198, DEE-199, DEE-200, DEE-201, DEE-202 · **Risk:** HIGH · **Milestone:** M5 — Market Intelligence

| | |
|---|---|
| **Entry** | P2 Closed |
| **Definition of Done** | Deployed ingestion; data-quality fail-closed; MSV + CDE on live BTC/ETH data |
| **Exit** | ≥1h unattended run; bad data halts pipeline; Post-Merge audit PASS |

### P4 — Two Real Strategies

**Issues:** DEE-203, NEW-5, NEW-6 · **Risk:** MEDIUM · **Milestone:** M6 — Strategy Signals

| | |
|---|---|
| **Entry** | P3 Closed |
| **Definition of Done** | Registry + two strategies; CDE-gated round-trip (entry+exit) signals; fixture tests pass |
| **Exit** | Deterministic signal reproduction in CI for both strategies; Post-Merge audit PASS |

### P5 — Provable Paper Product (MVP-Paper)

**Issues:** NEW-7, NEW-8, NEW-9, NEW-10, NEW-11 · **Risk:** MEDIUM (HIGH calendar) · **Milestone:** M7 — Paper Trading

| | |
|---|---|
| **Entry** | P4 Closed AND P2 Closed (isolation gate before `main` promotion) |
| **Definition of Done** | Paper loop deployed; Accelerated Historical Replay Validation (DEE-337 Done); observability live; RC `dev→main` + targeted Postgres apply |
| **Exit** | MVP-Paper checklist (criteria 1–10) green on `main`; Post-Merge audit PASS |

### P6 — Money In, Accountable

**Issues:** DEE-217, DEE-215 · **Risk:** LOW · **Milestone:** M8 — Billing & Payments

| | |
|---|---|
| **Entry** | P5 Closed (serial; parallel during P5 replay validation only with Architect authorization) |
| **Definition of Done** | Suspension lifecycle tested; manual-gate operator runbook complete |
| **Exit** | unpaid→suspended→paid→reactivated proven; Post-Merge audit PASS |

### P7 — Cleared for Capital

**Issues:** DEE-178 · **Risk:** LOW (human-gated) · **Milestone:** M7.5 — Strategy Validation Gate

| | |
|---|---|
| **Entry** | P5 Closed AND P6 Closed |
| **Definition of Done** | Two signed validation-gate promotion records (ADR-0010/0011) |
| **Exit** | Gate PASSED for both strategies; Post-Merge audit PASS |

### P8 — Safe Live Execution (MVP-Live)

**Issues:** DEE-221 (**Done**), NEW-12 → DEE-339, DEE-212, DEE-211 (**Done**), DEE-346 (**Done**), DEE-218, DEE-219, DEE-223, NEW-13 → DEE-340 · **Risk:** HIGH · **Milestone:** M9/M10

> **P8 foundations (merged, 2026-06-27):** DEE-211 (HTX signed transport + live spot connector foundation), DEE-221 (Secrets Store + credential security foundation), DEE-346 (HTX REST transport hardening) — all **Done** on `dev`.

| | |
|---|---|
| **Entry** | P7 Closed; Org-0 HTX live API credentials provisioned; ADR-0009 Posture confirmed |
| **Definition of Done** | Isolated execution host; live spot admin-gated; admin console; alerting; capped live order; Launch promotion |
| **Exit** | Full MVP checklist (16 criteria) green on `main`; Post-Merge audit PASS → **MVP COMPLETE** |

---

## Execution Order (single chain)

```
NEW-1 → DEE-154 → NEW-2
  → NEW-3 → NEW-4 → DEE-190 → DEE-191
  → DEE-197 → DEE-198 → DEE-199 → DEE-200 → DEE-201 → DEE-202
  → DEE-203 → NEW-5 → NEW-6
  → NEW-7 → NEW-8 → NEW-9 → NEW-10 → NEW-11  [RC: dev→main]
  → DEE-217 → DEE-215
  → DEE-178
  → DEE-221 → NEW-12 → DEE-212 → DEE-211 → DEE-218 → DEE-219 → DEE-223 → NEW-13  [Launch: dev→main]
  → MVP
```

---

## Issue Registry (NEW placeholders → Linear IDs)

| ID | Title | Pipeline | Priority | Parent | Linear ID |
|----|-------|----------|----------|--------|-----------|
| NEW-1 | Fix clean-checkout typecheck (OpenNext suppression) | P1 | High | DEE-103 | DEE-329 |
| NEW-2 | Ratify Postgres-only for new trader work | P1 | Normal | DEE-64 | DEE-328 |
| NEW-3 | WAIA Core conformance audit & M1 closure (Org-0) | P2 | High | DEE-161 | DEE-330 |
| NEW-4 | Wire trader runtime provisioning | P2 | High | DEE-162 | DEE-331 |
| NEW-5 | Strategy 1: Liquidity Sweep Reversal | P4 | Critical | DEE-167 | DEE-332 |
| NEW-6 | Strategy 2: Mean Reversion (governed) | P4 | Critical | DEE-167 | DEE-333 |
| NEW-7 | Wire strategies → risk → exec(mock) → paper book | P5 | Critical | DEE-170 | DEE-334 |
| NEW-8 | Deploy paper loop as scheduled service | P5 | Critical | DEE-170 | DEE-335 |
| NEW-9 | Observability baseline at runtime | P5 | Critical | DEE-177 | DEE-336 |
| NEW-10 | Accelerated Historical Replay Validation (2 strategies) closure report | P5 | Critical | DEE-170 | **DEE-337 (Done)** |
| NEW-11 | RC promotion dev→main (Paper-Complete) | P5 | Critical | DEE-149 | **DEE-338 (Todo)** |
| NEW-12 | Isolated execution host infrastructure | P8 | Critical | DEE-171 | **DEE-339 (Todo)** |
| NEW-13 | Org-0 live launch gate + capped supervised live | P8 | Critical | DEE-171 | **DEE-340 (Todo)** |

Existing issues: DEE-154, DEE-190, DEE-191, DEE-197–202, DEE-203, DEE-217, DEE-215, DEE-178, DEE-212, DEE-218, DEE-219, DEE-223 — see Linear for pipeline assignment. **P8 foundations Done:** DEE-211, DEE-221, DEE-346.

---

## MVP Completion Checklist

All true on `main`:

1. WAIA Core auth + org + `trader` entitlement + audit for Org-0; M1 closed.
2. Tenant-isolation gate (DEE-191) green and required in CI (ADR-0007).
3. HTX spot read + KMS-encrypted creds; balance sync verified.
4. Deployed runtime market-data ingestion; data-quality fail-closed.
5. MSV + CDE operational; Future Context stub disabled.
6. Two real strategies registered, versioned, signal-only via CDE.
7. Risk + kill switches inside execution; idempotent orders; startup reconciliation.
8. Paper loop deployed; validated via Accelerated Historical Replay Validation (both strategies, critical=0, ≥1 closed trade/strategy); observability measurable.
9. Signed validation-gate promotion record per live strategy (ADR-0010/0011).
10. Reporting + HWM + 30% fee + manual gate; USDT payments + suspension lifecycle.
11. Org-0 live HTX spot admin-gated, capped, supervised; isolated execution host.
12. Admin console: kill switches, live-enable, invoice sign-off, audit, account status.
13. External live provably blocked (ADR-0009 Posture).
14. CI fully green on `main`.

**MVP-Paper (intermediate):** Criteria 1–10 at end of P5.

---

## POST-MVP (frozen out)

Full RBAC (DEE-158), key rotation (DEE-235), external pilot (DEE-179), MI doctrine engines, Shadow rung + WSR/RD/σ rating, research/health automation, portfolio allocation, SQLite removal (DEE-85), futures/multi-exchange, AI-Twin↔Trader integration, design system, pgvector.

---

## Repository & Merge Strategy

- **Repo:** One base branch per pipeline; stacked slice PRs; single rebase at pipeline end.
- **PRs:** Default one PR per issue; combine only inseparable slices.
- **Merge:** Squash → `dev` per issue; two merge-commit `dev→main` (RC, Launch) + back-sync.
- **Estimates:** ~36 PRs, ~9 architecture reviews, ~10 post-merge audits; MVP-Paper ~3–4 weeks; full MVP ~5–7 weeks.

---

## Linear Application (reference)

**Close (Done):** DEE-156,180,181,157,182,183,159,186,187,160,188,189,278,172,213,214,173,216,313,**161,164,165,166,167,337,211,221,346**.

**Archive (Post-MVP):** DEE-158,184,185,235,179 (+ non-trader scope). **DEE-179** = Regulatory Clearance Gate (ADR-0009); governance gate, not engineering — labeled Post-MVP / Canceled.

**Split:** DEE-204 → NEW-5, NEW-6.

**Create:** NEW-1..NEW-13 with fields above.

**Priorities:** Critical=Urgent(1), High=High(2), Normal=Medium(3), Post-MVP=Low(4).
