---
name: AI-TRADER Master Execution Plan
overview: Reorganized, Composer-ready execution roadmap for the remaining ~40% of AI-TRADER MVP, broken into small single-Build packages with mandatory STOP checkpoints. Architecture is frozen; this plan only reorders/closes execution and reconciles the obsolete 48h-soak validation model to Accelerated Historical Replay Validation.
todos:
  - id: bp0
    content: "BP-0: Reconcile obsolete 48h-soak references to Accelerated Historical Replay Validation (ADR-0010 body + ops runbooks) and clean up Linear epic statuses (close DEE-161/164/165/166/167; mark P8 foundations done). Docs/Linear only. Completed via DEE-347 (PR #305, merge 3f63e0e)."
    status: completed
  - id: bp1
    content: "BP-1: Run Accelerated Historical Replay Validation for both strategies and write the DEE-337 closure report. Completed via PR #304 (merge b92fe72); DEE-337 Done."
    status: completed
  - id: bp2
    content: "BP-2: RC promotion dev->main (MVP-Paper), merge-commit + back-sync (DEE-338). Completed via PR #306 (release merge bf047c4) + PR #307 (back-sync 8a18625)."
    status: completed
  - id: bp2a
    content: "BP-2A: HTX MVP Integration Audit & Validation — completed; backend PASS, MVP user E2E FAIL; gaps filed (see Linear audit issue)."
    status: completed
  - id: bp2b
    content: "BP-2B: MVP Functional Gap Audit — completed; MVP user journey FAIL (Steps 3–8 product surfaces missing; backend-heavy). Confirms BP-2C as next implementation package."
    status: completed
  - id: bp2c
    content: "BP-2C: Trader User UI — Exchange Connect + Account Status — completed via PR #308 (merge 66ebeea); DEE-349 + DEE-350 Done."
    status: completed
  - id: bp3
    content: "BP-3: Account Status SUSPENDED writer + overdue->suspend->reactivate lifecycle — completed via PR #309 (merge 9431126); DEE-217 Done."
    status: completed
  - id: bp4
    content: "BP-4: Billing Governance — dispute/overcharge/refund append-only + HWM rollback — completed via PR #310 (merge 6c199ef); DEE-215 Done."
    status: completed
  - id: bp5
    content: "BP-5: Strategy Validation Gate — completed via PR #312 (merge 55598f9); DEE-178 Done; two EFFECTIVE promotion records signed for mean_reversion_v0 and liquidity_sweep_reversal_v0."
    status: completed
  - id: bp6
    content: "BP-6 (NEXT): Isolated execution host + production Secrets Store binding (DEE-339). STOP."
    status: pending
  - id: bp7
    content: "BP-7: Runtime hardening + wire HTX live execution path with org-level live-enable (DEE-212 + new sub-issue). STOP."
    status: pending
  - id: bp8
    content: "BP-8: Admin Console + Controls (DEE-218, DEE-219). STOP."
    status: pending
  - id: bp9
    content: "BP-9: Alerting — route critical alerts to external channel (DEE-223). STOP."
    status: pending
  - id: bp9a
    content: "BP-9A: Full MVP Verification — final full-system verification before launch (user journey, HTX, paper, billing, security invariants, ADR gates, admin, alerting, Org-0 live restriction). STOP."
    status: pending
  - id: bp10
    content: "BP-10: Org-0 launch gate + capped supervised live + Launch promotion (DEE-340, human-owned). STOP — MVP COMPLETE."
    status: pending
isProject: false
---

# AI-TRADER MASTER EXECUTION PLAN

Single execution roadmap for the remaining AI-TRADER MVP. Architecture is frozen ([Master Spec v2](docs/ai-trader/AI-TRADER-MASTER-SPEC-v2.md)); execution truth is [MVP Execution Program v2](docs/ai-trader/AI-TRADER-MVP-EXECUTION-PROGRAM-v2.md). This plan consolidates it. No new features, no MVP expansion, no redesign — only execution order.

Models: **Opus 4.8** = architecture/correctness-critical; **Composer 2.5** = implementation; **Sonnet 4.6** = audits/docs.

Each package is sized for one Build session. A `STOP` is a mandatory checkpoint: PR -> CI green -> Review -> Merge -> Post-Merge Audit. Composer must not cross a STOP.

---

## BP-0 — Reconciliation & Linear hygiene (docs only) **(completed — PR #305 / DEE-347 Done)**
- **Objective:** remove obsolete 48h-soak references and align Linear to reality.
- **Scope:** edit ADR-0010 body (lines 11/20/24) to Accelerated Historical Replay Validation; update DEE-178 runbook, DEE-170 hygiene review, DEE-266 grep, Grandmaster framework refs; rename DEE-337 ops doc filenames; mark DEE-170 48h report "superseded". Linear: close epics DEE-161/164/165/166/167 (children Done); mark P8 foundations DEE-211/221/346 Done in program text; back-annotate NEW->DEE mapping; re-label DEE-179 gate.
- **Linear:** new housekeeping issue (or fold into DEE-92 migration log).
- **Dependencies:** none.
- **Deliverables:** consistent docs; accurate Linear board.
- **Acceptance:** zero "48-hour soak" references outside historical evidence files; no merged-code epic in Backlog.
- **Complexity:** S. **Model:** Sonnet 4.6.
- **STOP**

## BP-1 — P5: Accelerated Historical Replay Validation closure **(completed — PR #304 / DEE-337 Done)**
- **Objective:** prove the paper loop end-to-end over historical replay for both strategies and produce the closure report.
- **Scope:** run `pnpm trader:paper:loop` / soak analyze per [DEE-337 AHR runbook](docs/ops/DEE-337-P5-TWO-STRATEGY-AHR-RUNBOOK.md); critical=0, >=1 closed trade/strategy; min observability live; write DEE-337 closure report.
- **Linear:** DEE-337 (In Progress) -> Done.
- **Dependencies:** BP-0 optional; code already merged (DEE-334/335/336).
- **Deliverables:** AHR closure report + evidence artifacts.
- **Acceptance:** MVP-Paper checklist criteria 1-8 green.
- **Complexity:** M. **Model:** Composer 2.5 (run) + Sonnet 4.6 (report).
- **STOP**

## BP-2 — P5: RC promotion dev->main (MVP-Paper) **(completed — PR #306 / PR #307 / DEE-338 Done)**
- **Objective:** promote Paper-Complete to main.
- **Scope:** merge-commit dev->main + mandatory back-sync; targeted Postgres apply.
- **Linear:** DEE-338 Done. Release merge `bf047c4`; back-sync `8a18625`.
- **Dependencies:** BP-1.
- **Acceptance:** MVP-Paper checklist green on main; back-sync merged.
- **Complexity:** S (human-gated). **Model:** Sonnet 4.6.
- **STOP**

## BP-2A — HTX MVP Integration Audit & Validation **(completed)**
- **Objective:** verify the HTX user-connection + connector subsystem end-to-end as one integrated unit.
- **Verdict:** Backend integration **PASS** (security boundaries intact). MVP user E2E **FAIL** (no connect UI; Step 4 sync partial).
- **Linear:** DEE-348 (Done, under DEE-163); DEE-349 (Done, under DEE-162); DEE-350 (Done, under DEE-163).
- **Dependencies:** BP-2.
- **Deliverables:** coverage matrix; gap list.
- **Complexity:** S. **Model:** Sonnet 4.6.
- **STOP**

## BP-2B — MVP Functional Gap Audit **(completed)**
- **Objective:** answer "If a real user opens WAIA today, what MVP functions are broken or missing?"
- **Verdict:** MVP user journey **FAIL** — backend/CLI/Worker strong; product UI absent for Steps 3–8. Steps 1–2 partial; Steps 9–12 lib-only; Steps 7/admin/alerts correctly deferred to P8.
- **Scope (no code, no PR):** walked [User Journey v2](docs/ai-trader/AI-TRADER-USER-JOURNEY-v2.md) Steps 1-12 against live routes/UI; classified Working/Partial/Missing; confirmed BP-2C sizing; did not expand DEE-349 scope.
- **Linear:** existing issues referenced (DEE-349, DEE-350, DEE-217, DEE-215, DEE-218, DEE-223, DEE-340); one post-BP-2C capability proposed (monitoring UI — not created).
- **Dependencies:** BP-2A.
- **Deliverables:** journey gap report (audit-only).
- **Acceptance:** all 12 steps classified with file evidence; BP-2C confirmed as next package.
- **Complexity:** S. **Model:** Sonnet 4.6.
- **STOP**

## BP-2C — Trader User UI: Exchange Connect + Account Status **(completed — PR #308 / merge 66ebeea / DEE-349 + DEE-350 Done)**
- **Objective:** deliver the user-facing HTX connection + connected-account view (User Journey Steps 3-4, 8 read surfaces) over the existing backend.
- **Verdict:** **PASS** — HTX connect UI, account status, balance/position/trade sync panels delivered; secret-redaction boundary reviewed (Opus PASS); tenant-isolation tests green.
- **Scope:** replace placeholder `app/(trader)/trader/page.tsx`; HTX selection + API key/secret form (no passphrase — HTX spot uses key+secret; correctly N/A); required/forbidden-permission explainer; submit to existing connect API; render detected permissions + warnings; connected-account status; read-only balances/positions/recent-trade-history view via sync/list APIs. **No secret ever rendered/returned; redaction preserved.** Tenant-isolation tests on org-scoped APIs (ADR-0007, release-blocking). No live controls, no futures/portfolio/research UI.
- **Linear:** **DEE-349** (frontend, DEE-162) + **DEE-350** (position/trade sync APIs, DEE-163) — both Done.
- **Dependencies:** BP-2B (confirms scope/sizing); DEE-350 before position/trade UI panels.
- **Deliverables:** user-facing exchange-connect + account-status UI; position/trade sync APIs + migrations.
- **Acceptance:** entitled user connects HTX, sees permissions/warnings, sees synced balances/positions/status; Playwright e2e passes; no secret in network/UI/logs; isolation tests green.
- **Complexity:** M. **Model:** Composer 2.5 (build) + Opus 4.8 review of secret-redaction boundary.
- **STOP**

## BP-3 — P6: Account Status & Suspension lifecycle **(completed — PR #309 / merge 9431126 / DEE-217 Done)**
- **Objective:** implement the missing SUSPENDED writer + overdue->suspend->reactivate.
- **Verdict:** **PASS** — SUSPENDED event type + transition rules; overdue ISSUED-invoice detection (7-day default grace); `appendAccountSuspensionIfNeeded` + `runOverdueSuspensionCycle`; reactivation on confirmed settlement unchanged; full lifecycle + tenant-isolation tests green.
- **Scope:** add SUSPENDED transition in `lib/trader/settlement/account-status.transitions.ts`; overdue detection; reactivation on confirmed settlement (exists). Tenant-isolation tests.
- **Linear:** DEE-217 (Done).
- **Dependencies:** BP-2.
- **Deliverables:** Postgres migration `0059` (SUSPENDED event type); overdue reader + suspension cycle; audit action `accountSuspended`.
- **Acceptance:** unpaid->suspended->paid->reactivated proven in tests.
- **Complexity:** M. **Model:** Composer 2.5.
- **STOP**

## BP-4 — P6: Billing Governance **(completed — PR #310 / merge 6c199ef / DEE-215 Done)**
- **Objective:** dispute/overcharge/refund as append-only corrections + HWM rollback.
- **Verdict:** **PASS** — append-only dispute events + correction ledger; dispute freeze integrated with BP-3 overdue suspension cycle; HWM rollback on overcharge correction; tenant-isolation + lifecycle tests green.
- **Scope:** implement Billing Governance per ADR-0008 + Billing&HWM; no destructive edits.
- **Linear:** DEE-215 (Done).
- **Dependencies:** BP-3.
- **Deliverables:** SQLite `0035` + Postgres `0060`/`0061` migrations; `lib/trader/billing/governance/` service + repositories; overdue reader dispute-freeze filter.
- **Acceptance:** dispute freeze + append-only correction + HWM rollback tested.
- **Complexity:** M. **Model:** Opus 4.8 (math/governance) + Composer 2.5.
- **STOP**

## BP-5 — P7: Strategy Validation Gate (sign 2 promotion records) **(completed — PR #312 / merge 55598f9 / DEE-178 Done)**
- **Objective:** governance gate per ADR-0010/0011 for both strategies.
- **Scope:** operator assembles promotion records via `pnpm trader:gate` from AHR + paper evidence; per-strategy confidence sign-off; cooling-off; immutable audit.
- **Linear:** DEE-178.
- **Dependencies:** BP-2 (paper evidence). Parallel with P6.
- **Acceptance:** 2 signed promotion records; gate PASSED.
- **Complexity:** S (human-gated). **Model:** Opus 4.8 (criteria) + operator.
- **STOP**

## BP-6 — P8: Isolated execution host infrastructure **(NEXT)**
- **Objective:** stand up the off-Cloudflare hardened execution host.
- **Scope:** provision isolated host; managed master key residency; Secrets Store production binding (uncomment/repair `wrangler.jsonc secrets_store_secrets`).
- **Linear:** DEE-339.
- **Dependencies:** BP-5. Parallel-capable with P6/P7.
- **Acceptance:** host reachable, key resident, secrets bound; no key in env/image.
- **Complexity:** M-L. **Model:** Composer 2.5 + ops.
- **STOP**

## BP-7 — P8: Runtime Hardening + live-execution wiring (full execution path)
- **Objective:** wire and validate the **entire** live path end-to-end (not just dispatch): hardened, admin-gated, org-level live-enable.
- **Scope:** replace `LiveExecutionNotSupportedError` with gated live dispatch; implement **org-level live-enable** (currently only strategy promotion is checked in `assert-strategy-live-authorized.ts`); explicitly cover and validate the full chain **Strategy -> Risk -> Execution -> HTX -> Fill -> Reconciliation -> Reporting** against live HTX (Org-0), including live reconciliation feeding HWM/reporting; notional caps; Single Operator Governance; fail-closed at each hop.
- **Linear:** DEE-212 (+ new live-enable sub-issue).
- **Dependencies:** BP-5, BP-6.
- **Acceptance:** a capped Org-0 live order traverses all seven stages (Strategy -> Risk -> Execution -> HTX -> Fill -> Reconciliation -> Reporting) with a reconciled fill landing in reporting; live path reachable only when promoted + org-enabled + within caps; kill-switch/fail-closed verified at every hop.
- **Complexity:** L. **Model:** Opus 4.8 (design) + Composer 2.5.
- **STOP**

## BP-8 — P8: Admin Console + Controls
- **Objective:** admin surface for kill switches, live-enable, invoice sign-off, account status, audit.
- **Scope:** `app/(trader)/admin/**` + audited admin APIs over existing services.
- **Linear:** DEE-218, DEE-219.
- **Dependencies:** BP-7. Parallel with BP-9.
- **Acceptance:** all sensitive actions audited under ADR-0011; tenant-isolation tests.
- **Complexity:** M. **Model:** Composer 2.5.
- **STOP**

## BP-9 — P8: Alerting
- **Objective:** route the critical-alert set to an external channel.
- **Scope:** wire `severity:"critical"` telemetry to alert sink; runbooks.
- **Linear:** DEE-223.
- **Dependencies:** BP-2. Parallel with BP-8.
- **Acceptance:** critical alerts fire to channel in a drill.
- **Complexity:** S-M. **Model:** Composer 2.5.
- **STOP**

## BP-9A — Full MVP Verification
- **Objective:** final full-system verification before launch.
- **Scope (verification, no feature work):** validate the user journey (HTX connect -> sync -> strategy -> paper), HTX subsystem, paper/AHR evidence, billing + HWM + manual gate, security invariants (no secret leak, isolation gate, kill-switch fail-closed), ADR gates (0008/0009/0010/0011), admin controls, alerting, and the Org-0-only live restriction.
- **Linear:** new verification issue (pre-gate to DEE-340).
- **Dependencies:** BP-8, BP-9.
- **Deliverables:** signed full-system verification report.
- **Acceptance:** full MVP checklist (16 criteria) demonstrably green; sign-off recorded.
- **Complexity:** M (verification). **Model:** Opus 4.8.
- **STOP**

## BP-10 — P8: Org-0 launch gate + capped supervised live (MVP-Live)
- **Objective:** execute the supervised capped live order and Launch promotion.
- **Scope:** full MVP checklist (16 criteria); capped supervised Org-0 live trade; Launch dev->main merge-commit + back-sync. ADR-0009 stays Posture (external blocked).
- **Linear:** DEE-340. **Human-owned.**
- **Dependencies:** BP-4, BP-7, BP-8, BP-9, BP-9A.
- **Acceptance:** the **full MVP user journey** completes — HTX connection -> account sync -> paper operation -> admin-gated, validation-gated Org-0 live order — AND the full MVP checklist (16 criteria) is green on `main`; external live remains provably blocked (ADR-0009 Posture) -> MVP COMPLETE.
- **Complexity:** L (human-gated). **Model:** Opus 4.8 review + operator.
- **STOP — MVP COMPLETE**

---

## Critical path
BP-0 -> BP-1 -> BP-2 -> BP-2A -> BP-2B -> BP-2C -> (BP-3 -> BP-4 | BP-5) ; BP-6 -> BP-7 ; (BP-8 | BP-9) -> BP-9A -> BP-10.
(Parallelizable: BP-5 with BP-3/BP-4; BP-6 with P6/P7; BP-8 with BP-9.)

## Single source of execution truth
This plan + [MVP Execution Program v2](docs/ai-trader/AI-TRADER-MVP-EXECUTION-PROGRAM-v2.md). Architecture: [Master Spec v2](docs/ai-trader/AI-TRADER-MASTER-SPEC-v2.md). Validation model: Accelerated Historical Replay Validation (supersedes 48h Operator Soak everywhere).