Snapshot copied before M0 Phase 1 implementation for PR traceability.

---
name: AI-Trader Completion Plan
overview: Complete WAIA AI-TRADER as a governed autonomous market researcher and trader by first repairing the broken closed-trade attribution/exit pipeline under an explicit semantics version (M0), auditing dataset/regime coverage separately (M0.5), then layering trade-lifecycle, deposit/risk, position-guardian, exit-intelligence, pattern memory, and autonomous strategy discovery onto the existing MI/RI substrate — keeping promotion and live execution human-gated. Hardened for execution by Composer 2.5.
todos:
  - id: m0p1
    content: "M0 Phase 1: forensics + reproducing test + FINDINGS.md. Trace one order signal->submit->fill->position->[no close]->closedTradeCount citing file:line. Add deterministic test asserting CURRENT (wrong) behavior. NO code repair. NO strategy change. Stop for human review."
    status: completed
  - id: m0p2
    content: "M0 Phase 2: semantics-versioned repair + tests. Introduce CLOSED_TRADE_SEMANTICS_VERSION + TRADE_LIFECYCLE_SEMANTICS_VERSION, bump RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION to 2.0.0, implement forced-flat mark-to-close via applyCostToFill(side=sell), replace tradeCount with explicit metric taxonomy on aggregate AND byRegime. Never mutate sealed artifacts. Stop for human review."
    status: completed
  - id: m0p3
    content: "M0 Phase 3: post-repair validation report. Run a fixture (non-sealed) backtest; produce VALIDATION.md proving closedTrades+markToCloseTrades>0, aggregate==sum(byRegime) per metric, realizedPnl==markedPnl reconciliation, and semantics version stamped. NO blind consumption, NO Execution Server campaign."
    status: completed
  - id: m05
    content: "M0.5: Dataset/regime coverage audit (SEPARATE from M0). Classify regime distribution of sealed + candidate datasets; confirm CDE never emits STRESS; determine whether lifecycle-correct M0 still fails MULTI_REGIME_COVERAGE_INSUFFICIENT and why. Output audit report only; NO strategy tuning, NO gate weakening."
    status: completed
  - id: m1
    content: "M1: Trade lifecycle model — explicit open/close/round-trip entities + persisted order-lifecycle trace + multi-position support (semantics-versioned)."
    status: pending
  - id: m2
    content: "M2: Deposit/portfolio/risk sizing model (USDT, spot-only) — account-state + stop-based position sizing + portfolio-risk budget; integrate into backtest/research/paper."
    status: pending
  - id: m3
    content: "M3: Position Guardian — per-bar open-position monitor emitting exit intents + auditable reason records."
    status: pending
  - id: m4
    content: "M4: Dynamic SL/TP engine — ATR/volatility SL/TP + trailing stops wired into Guardian."
    status: pending
  - id: m5
    content: "M5: Exit intelligence — time/regime/reversal/risk-off exits, partial close/reduce, full reason-record persistence."
    status: pending
  - id: m6
    content: "M6: Activate market pattern catalog — pattern scoring, confidence, aging, price-move explanation records over lib/trader/mi + trader_knowledge_edges."
    status: pending
  - id: m7
    content: "M7: News/event attribution memory — event ingestion, classification, event->price attribution into catalog."
    status: pending
  - id: m8
    content: "M8: Autonomous strategy generation + evolution — pattern-discovery -> hypothesis -> strategy generator + mutation + comparison -> candidate registry (recommend-only, human gate preserved)."
    status: pending
  - id: m9
    content: "M9: Full Execution Server research campaign with deposit-aware PnL and closed trades; trustworthy evidence bundle (operator-authorized only)."
    status: pending
  - id: m10
    content: "M10: Paper trading soak with multiple positions + dynamic exits (operator-run, no new blind consumption)."
    status: pending
  - id: m11
    content: "M11: Capped supervised live launch readiness — ADR-0010 evidence + operator attestation + ADR-0011 FSM prep; human-gated, no autonomous live."
    status: pending
isProject: false
---

# WAIA AI-TRADER — Final Completion Architecture & Roadmap (Composer 2.5 Hardened)

## Verdict

WAIA has a strong epistemic + governance substrate (Postgres RI pipeline, MI registry, evolution/AI-assist, ADR-0010/0011/0018/0019 gates) and a **broken trade-lifecycle core**. The binding blocker is that the research pipeline **never closes a position**, so `closedTradeCount = 0` everywhere and every campaign is unfalsifiable. Do not rewrite; complete the lifecycle core and close the learning loop.

## Confirmed root cause (M0)

- `extractInWindowClosedTrades` in [lib/trader/paper/derive-paper-pnl.ts](lib/trader/paper/derive-paper-pnl.ts) L226-284 records a closed trade ONLY on an in-window SELL fill.
- No exit engine (no SL/TP: zero refs in `lib/trader/`), no forced end-of-window flat, no open->close pairing.
- Metric semantic mismatch: aggregate `tradeCount = closedTradeCount` ([lib/trader/research/research-backtest-runner.ts](lib/trader/research/research-backtest-runner.ts) L160) vs `byRegime[].tradeCount += submitted.length` (L111); gate reads submitted-order slices ([lib/trader/research/regime-coverage.ts](lib/trader/research/regime-coverage.ts) L36-38).
- `trend_momentum_v0` buys in TREND_BULL (zscore>=2) and never emits sell -> 18 submits, 0 closes. `mean_reversion_v0` excluded by CDE in TREND_BULL ([lib/trader/intelligence/cde-v0.ts](lib/trader/intelligence/cde-v0.ts) L72-83) -> 0 submits. `STRESS` regime is canonical in RI but never emitted by CDE.

---

## Additional Hardening Checks (mandatory pre-implementation findings)

These checks were performed against the codebase and are now binding constraints on implementation.

### H1. Sealed evidence / semantics versioning (BINDING)

Repairing closed-trade semantics or adding forced-flat mark-to-close **changes the meaning of every metric** downstream of the backtest. Existing sealed artifacts that embed the old meaning MUST NOT be re-interpreted or mutated:

- `ResearchValidationMetrics` today carries `schemaVersion: "1.0.0"` and a single `tradeCount` ([lib/trader/research/strategy-candidate.types.ts](lib/trader/research/strategy-candidate.types.ts) L40-55).
- Blind results are single-use and digest-sealed: `BlindValidationResult { evidenceDigest, ... }` + candidate `blindUsed` flag (same file L93-112); ADR-0010 §3 "immutable result; re-runs rejected".
- Cost model is already versioned: `COST_MODEL_VERSION_V1 = "waia.trader.cost-model.v1"` ([lib/trader/execution/cost-model.ts](lib/trader/execution/cost-model.ts) L8).
- Re-derivation path exists: [lib/trader/research/rederive-validation-metrics-from-sealed-dataset.ts](lib/trader/research/rederive-validation-metrics-from-sealed-dataset.ts) — must be gated by semantics version.

**Rule (MUST):**
1. Introduce two constants: `TRADE_LIFECYCLE_SEMANTICS_VERSION = "waia.trader.trade-lifecycle.v1"` and `CLOSED_TRADE_SEMANTICS_VERSION = "waia.trader.closed-trade.v2"` (v2 because v1 == today's sell-fill-only behavior, retained as a documented legacy label).
2. Bump `RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION` `"1.0.0" -> "2.0.0"`. The v2 metrics object embeds `closedTradeSemanticsVersion` and `costModelVersion`.
3. **Never** UPDATE/DELETE any existing `trader_backtest_results`, `trader_blind_validation_results`, `trader_walk_forward_windows`, PKA files, rejection records, or `replay-runs/**` artifacts. Repaired semantics produce **new rows / new candidate versions / new vault paths** only.
4. Any consumer reading metrics must branch on `schemaVersion`; a v1 artifact is read-only legacy and never compared numerically against a v2 artifact.
5. No blind holdout may be re-run to "re-baseline" under new semantics unless the operator explicitly authorizes a new candidate version (ADR-0019 forbids blind mutation).

### H2. Forced-flat mark-to-close cost model (BINDING, no vague "close at end")

Forced-flat closes any position still open at the evaluation window boundary so the round-trip is accountable. It is **synthetic-close evidence**, explicitly distinct from a true exchange SELL fill.

- **Price source:** the `close` of the **last in-window bar** (the boundary bar already used by `HistoricalBarReplaySource`). No look-ahead beyond the window; no external quote.
- **Timestamp:** the `timestamp` of that last in-window bar (deterministic; equals window end).
- **Fee model:** reuse `applyCostToFill(price, quantity, "sell", costModel)` with `COST_MODEL_VERSION_V1` — identical fee bps as real sells; fee recorded in quote currency (USDT).
- **Slippage model:** the same versioned slippage from `applyCostToFill` (sell side receives lower adjusted price). No separate/ad-hoc slippage.
- **Classification:** result is a `markToCloseTrade` with `syntheticClose: true`, contributing to `markedPnl`, NOT to `realizedPnl` and NOT to `closedTrades`. It has **no** exchange fill id and **no** order id (or a clearly tagged synthetic id prefixed `synthetic-flat:`).
- **Difference from a true SELL fill:** a true close is a strategy/guardian-emitted sell order that goes through risk -> submit -> mock fill and produces a real `FillRow` + `closedTrade` + `realizedPnl`. A forced-flat close is a valuation event applied only at window boundary to prevent dangling open inventory from silently zeroing trade counts.

**Acceptance / test expectations:**
- A fixture with one buy and no strategy sell before window end yields exactly one `markToCloseTrade` (`syntheticClose: true`), `closedTrades = 0`, `markToCloseTrades = 1`, and `markedPnl == (boundaryClose - avgCost) * qty - sellFee` computed via `applyCostToFill`.
- A fixture with a real strategy sell before window end yields `closedTrades = 1`, `markToCloseTrades = 0`, and no synthetic record.
- Determinism test: same fixture -> byte-identical metrics (including timestamps) across runs.

### H3. Metric taxonomy (BINDING — replaces ambiguous `tradeCount`)

Define one canonical metric object used identically at aggregate and per-regime level. **Aggregate MUST equal element-wise sum over `byRegime`** for every countable/summable field (enforced by assertion + test). Fields:

- `submittedOrders` — orders dispatched to the connector.
- `acceptedOrders` — orders that passed risk (not `risk_rejected`).
- `filledOrders` — orders reaching `FILLED`.
- `openPositions` — positions with qty > 0 at window boundary (before forced-flat).
- `closedTrades` — round-trips closed by a real SELL fill in-window.
- `markToCloseTrades` — round-trips closed synthetically at window boundary.
- `realizedPnl` — quote-currency PnL from real closes only.
- `markedPnl` — quote-currency PnL including forced-flat mark-to-close.
- `rejectedSignals` — signals blocked by risk/guards (maps to `execution.risk_rejected` + guard skips).
- `skippedSignals` — signals not actionable (NO_SIGNAL / strategy-not-allowed).
- `byRegime[]` — one metric object per regime label, same fields.

**Rules (MUST):**
1. Delete the semantic overload where aggregate `tradeCount` counts closes but `byRegime[].tradeCount` counts submissions. Both levels use the taxonomy above; regime attribution is derived from the SAME trade/order records, not two different sources.
2. `regime-coverage` gate MUST read an explicitly named field (decide in M0.5 whether coverage counts `closedTrades + markToCloseTrades` or `filledOrders`) — never an ambiguous `tradeCount`.
3. Provide a v1->v2 field mapping note in FINDINGS.md so legacy artifacts remain interpretable without mutation.

### H4. Dataset / regime coverage risk (SEPARATED from M0)

Lifecycle correctness (M0) and regime-coverage sufficiency are **different problems**. Even a perfectly repaired M0 can still fail `MULTI_REGIME_COVERAGE_INSUFFICIENT` if the sealed BTC 1m window is TREND_BULL-dominated and CDE never emits `STRESS`. The four concerns are explicitly decoupled:

- **Execution lifecycle correctness** (M0): does open->close->PnL->attribution accounting work at all?
- **Strategy falsifiability** (later): can a strategy produce closable, evaluable trades?
- **Regime coverage sufficiency** (M0.5 audit -> future dataset milestone): does the dataset actually contain non-trending + down + stress regimes with attributed trades?
- **Dataset construction requirements** (M0.5 output): what dataset/regime-classifier changes are needed, tracked as separate work.

**Rule:** M0.5 is an **audit report only**. It MUST NOT tune strategies, weaken the gate, mutate datasets, or consume blind. It informs a later dataset-construction milestone.

### H5. Strategy vs lifecycle boundary (BINDING)

- M0 proves **lifecycle accounting and attribution only**. It MUST NOT redesign strategies, add exits, add SL/TP, change CDE regime gating, or add discovery.
- New exits, Position Guardian, SL/TP, and autonomous discovery belong to M3/M4/M5/M8.
- If M0 forensics reveal a strategy never sells, that is **documented as a finding**, not fixed in M0.

### H6. Risk controls preserved (BINDING across all milestones)

No live trading. No scheduler/daemon execution. No autonomous promotion. No mutation of sealed evidence. No blind reruns unless the operator explicitly authorizes a new candidate. No external-client live. Human gate remains for promotion and live-enable (ADR-0010/0011/0019, DEE-212/DEE-340, SEE, KTA §6.5).

---

## Composer 2.5 Implementation Contract

Every milestone below is expressed as a task contract Composer 2.5 can execute without architectural invention. Global rules:

- **Branch:** `dee-<NN>-<slug>` off `dev`. One milestone = one branch = one PR to `dev` (squash). Never push to `main`/`dev` directly.
- **Validation (run before PR readiness, every milestone):** `pnpm lint` && `pnpm typecheck` && `pnpm test --run` && `pnpm build`. Add `pnpm test:e2e` only if UI changes.
- **Do NOT (global):** run live, run an Execution Server campaign, consume blind evidence, mutate sealed artifacts/digests, weaken any gate, change governance ADRs, or auto-promote. Do not open a PR unless explicitly asked.
- **Stop condition (global):** at each milestone/phase end, stop and produce the named artifact for human review; do not auto-advance across a milestone boundary.
- **Semantics rule:** any change touching metrics/PnL/close logic MUST stamp `closedTradeSemanticsVersion`, `tradeLifecycleSemanticsVersion`, and `costModelVersion`, and MUST write new rows/files rather than mutating existing ones.
- **Task-contract shape (each milestone provides):** Objective; Files/file-families; Do; Do NOT; New files; DB migration (Postgres-only per ADR-0017, else "none"); CLI; Tests; Acceptance criteria; Expected artifacts; Validation commands; Stop condition; Blocks-next (yes/no); Suggested Linear issue.

---

## M0 — Closed-trade attribution pipeline repair (BLOCKER)

M0 is split into three phases with a human-review stop between each. M0 does lifecycle accounting only (H5).

### M0 Phase 1 — Forensics + reproducing test + FINDINGS.md

- **Objective:** Prove the exact break with a deterministic test; document the v1->v2 semantics gap. No repair.
- **Files (read):** `lib/trader/paper/derive-paper-pnl.ts`, `lib/trader/paper/derive-paper-strategy-eval.ts`, `lib/trader/research/research-backtest-runner.ts`, `lib/trader/research/regime-coverage.ts`, `lib/trader/research/strategy-candidate.types.ts`, `lib/trader/backtest/backtest-runner.ts`.
- **Do:** Add a deterministic test under `tests/unit/` (fixture bars) that runs a minimal backtest where a position opens and is never closed by a sell, and ASSERTS the current wrong behavior (`closedTradeCount = 0` while an open position and submitted orders exist). Write `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/FINDINGS.md` tracing one order end-to-end with file:line, stating the aggregate-vs-byRegime metric mismatch, and including a v1->v2 metric-mapping table.
- **Do NOT:** modify any production `lib/` logic; change strategies; touch sealed artifacts.
- **New files:** the test + `FINDINGS.md`.
- **DB migration:** none.
- **Tests:** new forensic test passes by asserting current (buggy) behavior.
- **Acceptance:** FINDINGS.md exists with end-to-end trace + mismatch statement + v1->v2 mapping; test green.
- **Validation:** `pnpm lint && pnpm typecheck && pnpm test --run`.
- **Stop:** human review before Phase 2. **Blocks-next:** yes.
- **Linear:** "DEE-NN M0.1 closed-trade attribution forensics".

### M0 Phase 2 — Semantics-versioned repair + tests

- **Objective:** Implement round-trip accounting + forced-flat mark-to-close + explicit metric taxonomy under new semantics versions, without mutating sealed data.
- **Files (edit):** `lib/trader/paper/derive-paper-pnl.ts` (add forced-flat + markToClose records), `lib/trader/paper/derive-paper-strategy-eval.ts` (emit taxonomy), `lib/trader/research/research-backtest-runner.ts` (aggregate == sum(byRegime) from one source), `lib/trader/research/strategy-candidate.types.ts` (v2 metrics type + schema bump), `lib/trader/research/regime-coverage.ts` (read explicit named field).
- **Do:** Add `CLOSED_TRADE_SEMANTICS_VERSION`, `TRADE_LIFECYCLE_SEMANTICS_VERSION`; bump `RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION` to `"2.0.0"`; implement forced-flat exactly per H2 (boundary-bar close, boundary timestamp, `applyCostToFill` sell side, `syntheticClose: true`, `markedPnl` not `realizedPnl`); implement metric taxonomy per H3 with aggregate == sum(byRegime) assertion.
- **Do NOT:** redesign strategies; change CDE; consume blind; UPDATE/DELETE existing rows or `replay-runs/**`; add SL/TP or Guardian.
- **New files:** semantics-version constants module (e.g. `lib/trader/paper/trade-lifecycle-semantics.ts`); taxonomy type module if needed.
- **DB migration:** Postgres-only IF a new column/table is required to store v2 metrics alongside legacy (do not alter legacy columns' meaning). Prefer storing v2 in a new `metrics_v2_json`/new row rather than overwriting.
- **Tests:** unit tests for forced-flat math (H2 acceptance), taxonomy invariants (aggregate == sum(byRegime) per field), determinism, and v1 legacy read-path unchanged.
- **Acceptance:** repaired fixture backtest yields `closedTrades + markToCloseTrades > 0`; every taxonomy field aggregate equals byRegime sum; metrics stamped with both semantics versions + cost model version; no legacy artifact modified (verify via git status: only new files/rows).
- **Validation:** full chain incl. `pnpm build`.
- **Stop:** human review before Phase 3. **Blocks-next:** yes.
- **Linear:** "DEE-NN M0.2 closed-trade semantics repair (v2)".

### M0 Phase 3 — Post-repair validation report

- **Objective:** Prove the repair on a NON-sealed fixture/sample and document reconciliation. No blind, no campaign.
- **Files (read/run):** fixture backtest harness; new taxonomy outputs.
- **Do:** Run the fixture backtest; write `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/VALIDATION.md` proving: (a) `closedTrades + markToCloseTrades > 0`; (b) aggregate == sum(byRegime) per metric; (c) `markedPnl` reconciles to `realizedPnl + sum(forced-flat markToClose PnL)`; (d) semantics + cost-model versions stamped; (e) legacy v1 artifacts untouched.
- **Do NOT:** run Execution Server; consume blind; promote; tune strategies.
- **New files:** `VALIDATION.md`.
- **DB migration:** none.
- **Tests:** none new required (Phase 2 tests cover it) — report references them.
- **Acceptance:** VALIDATION.md present with all five proofs; `git status` shows no sealed-artifact mutation.
- **Validation:** `pnpm test --run` (regression) + report.
- **Stop:** human review before M0.5/M1. **Blocks-next:** yes.
- **Linear:** "DEE-NN M0.3 closed-trade repair validation report".

---

## M0.5 — Dataset / regime coverage audit (SEPARATE, audit-only)

- **Objective:** Determine whether lifecycle-correct M0 still fails `MULTI_REGIME_COVERAGE_INSUFFICIENT` and why — a dataset/classifier question, not a lifecycle one (H4).
- **Files (read):** `lib/trader/intelligence/cde-v0.ts`, `lib/trader/research/regime-taxonomy.ts`, `lib/trader/research/regime-coverage.ts`, `lib/trader/market-data/research-dataset.ts`, sealed dataset metadata.
- **Do:** Classify regime distribution of the sealed BTC 1m window and any candidate datasets; confirm CDE never emits `STRESS`; quantify how many bars fall in non-trending/down/stress; state whether the gate can be satisfied with current data + classifier, and what dataset construction or classifier changes would be needed. Output `replay-runs/RI-P7/dataset-regime-coverage-audit-org0/AUDIT.md`.
- **Do NOT:** tune strategies; weaken/relax the coverage gate; mutate datasets; consume blind; classify STRESS by editing CDE (recommend only).
- **New files:** `AUDIT.md` (+ optional read-only analysis script under `scripts/trader/` that does not write DB).
- **DB migration:** none.
- **Tests:** none (audit) — or a read-only assertion test on regime distribution if cheap.
- **Acceptance:** AUDIT.md quantifies regime distribution + gate-satisfiability verdict + recommended follow-up dataset milestone.
- **Stop:** human review. **Blocks-next:** no (M1 may proceed in parallel).
- **Linear:** "DEE-NN M0.5 dataset/regime coverage audit".

---

## M1 — Trade lifecycle model

- **Objective:** First-class open/close/round-trip entities + persisted order-lifecycle trace; multi-position support; all semantics-versioned.
- **Files:** `lib/trader/paper/*`, `lib/trader/execution/*`; new `lib/trader/lifecycle/*`.
- **Do:** Model a Trade (open fill(s) -> close fill(s) or forced-flat) with lineage to orders/fills; persist an order-lifecycle trace (signal->accepted->submitted->filled->closed) reusing M0 taxonomy.
- **Do NOT:** add exits/SL-TP (M3/M4); change strategies.
- **DB migration:** Postgres-only for trade/lifecycle tables if needed.
- **Acceptance:** multi-position fixture produces correct per-trade lineage + taxonomy; aggregate == sum(byRegime). **Blocks-next:** yes.
- **Linear:** "DEE-NN M1 trade lifecycle model".

## M2 — Deposit / portfolio / risk sizing (USDT, spot-only)

- **Objective:** Account-state + stop-based position sizing integrated into backtest/research/paper.
- **Fields:** `startingBalanceUsdt`, `availableBalanceUsdt`, `reservedMarginUsdt` (0 spot), `realizedPnlUsdt`, `markedPnlUsdt`, `feesPaidUsdt`, `maxRiskPerTradePct`, `maxPortfolioRiskPct`, `maxConcurrentPositions`.
- **Sizing:** `qty = (equity * maxRiskPerTradePct) / stopDistance`, capped by available balance + portfolio-risk budget. No leverage, no liquidation.
- **Files:** `lib/trader/risk/*` (extend `capital-limits-evaluator.ts`); new `lib/trader/portfolio/*`.
- **Do NOT:** enable live; add leverage; touch billing/HWM.
- **DB migration:** Postgres-only for account-state if persisted.
- **Acceptance:** sizing deterministic + bounded by balance/risk; integrates without breaking M0/M1 metrics. **Blocks-next:** yes.
- **Linear:** "DEE-NN M2 deposit/portfolio/risk sizing".

## M3 — Position Guardian

- **Objective:** Per-bar monitor over open positions emitting exit intents + auditable reason records.
- **Files:** new `lib/trader/guardian/*`; wire into `paper-cycle-runner.ts`.
- **Do NOT:** place live orders; auto-promote; add SL/TP math yet (M4 supplies rules).
- **Acceptance:** guardian emits reason records for each open position each bar; exits flow through existing order path. **Blocks-next:** yes.
- **Linear:** "DEE-NN M3 position guardian".

## M4 — Dynamic SL/TP engine

- **Objective:** ATR/volatility SL/TP + trailing stops consumed by Guardian.
- **Files:** new `lib/trader/exits/*`; `lib/trader/guardian/*`.
- **Acceptance:** SL/TP + trailing tested on fixtures; emits closes producing real `closedTrades` (reduces reliance on forced-flat). **Blocks-next:** yes.
- **Linear:** "DEE-NN M4 dynamic SL/TP".

## M5 — Exit intelligence

- **Objective:** Time/regime/reversal/risk-off exits, partial close/reduce; full reason-record persistence per the reason-record spec.
- **Reason record:** `{decision, timestamp, symbol, side, pattern/signal refs, confidence, invalidation, sizingBasis, riskBasis, slTpLevels, regime, rMultiple}`.
- **Files:** `lib/trader/exits/*`, `lib/trader/guardian/*`; new `lib/trader/reason-records/*`.
- **Acceptance:** every entry/hold/exit persists an auditable reason record; partial closes reconcile in taxonomy. **Blocks-next:** yes.
- **Linear:** "DEE-NN M5 exit intelligence".

## M6 — Market pattern catalog activation

- **Objective:** Pattern scoring, confidence, aging, price-move explanation records over existing (inert) `lib/trader/mi/*` + `trader_knowledge_edges`.
- **Files:** `lib/trader/mi/*`, `lib/trader/knowledge/*`.
- **Do NOT:** auto-register hypotheses to promotion; bypass human gate.
- **DB migration:** Postgres-only if catalog scoring persisted.
- **Acceptance:** patterns carry scores/confidence/aging; explanations linked to price moves; edges written for closes AND rejections. **Blocks-next:** no.
- **Linear:** "DEE-NN M6 pattern catalog activation".

## M7 — News/event attribution memory

- **Objective:** Event ingestion + classification + event->price attribution into catalog.
- **Files:** new `lib/trader/events/*`; `lib/trader/knowledge/*`.
- **Do NOT:** trade on events; call live APIs without operator config.
- **Acceptance:** events classified + linked to price moves with uncertainty score. **Blocks-next:** no.
- **Linear:** "DEE-NN M7 news/event attribution".

## M8 — Autonomous strategy generation + evolution

- **Objective:** Pattern-discovery -> hypothesis -> parametric strategy generator + mutation + comparison -> candidate registry. Recommend-only into the human promotion gate.
- **Files:** new `lib/trader/discovery/*`, `lib/trader/generator/*`; existing candidate/RI pipeline.
- **Do NOT:** auto-promote; auto-schedule campaigns; consume blind without operator authorization; use RL/GA as a promotion path.
- **Acceptance:** generated candidates register via existing pipeline and pass through blind discipline; humans still promote. **Blocks-next:** no.
- **Linear:** "DEE-NN M8 autonomous strategy discovery".

## M9 — Full Execution Server research campaign (operator-authorized)

- **Objective:** End-to-end campaign with deposit-aware PnL + real/forced-flat closed trades; trustworthy v2 evidence bundle.
- **Do NOT:** run without explicit operator go/no-go; consume blind without authorization; promote.
- **Acceptance:** campaign produces v2 metrics with non-zero closed trades and reconciled PnL; evidence bundle validates. **Blocks-next:** yes for M10.
- **Linear:** "DEE-NN M9 v2 research campaign".

## M10 — Paper trading soak (multi-position, dynamic exits)

- **Objective:** Operator-run paper soak with multiple positions + dynamic exits; no new blind consumption.
- **Acceptance:** soak evidence shows lifecycle-correct multi-position management with reason records. **Blocks-next:** yes for M11.
- **Linear:** "DEE-NN M10 paper soak".

## M11 — Capped supervised live launch readiness

- **Objective:** Assemble ADR-0010 evidence + operator attestation + ADR-0011 FSM prep. Human-gated; no autonomous live.
- **Do NOT:** enable live autonomously; schedule; bypass cooling-off/attestation.
- **Acceptance:** readiness package assembled for human promotion decision only. **Blocks-next:** terminal.
- **Linear:** "DEE-NN M11 capped supervised live readiness".

---

## Immediate next task

Run **M0 Phase 1** (`closed-trade-attribution-pipeline-forensics-org0`): forensics + reproducing test + FINDINGS.md with v1->v2 metric mapping. NO strategy redesign, NO repair, NO live, NO campaign, NO blind. Stop for human review before M0 Phase 2.

## Independent research position

WAIA's "governed autonomous researcher" shape (append-only knowledge + deterministic validation + recommend-only AI + human capital gate) is close to optimal for auditability and stronger than a pure end-to-end RL trader for a regulated single-operator context. Adopt selectively WITHOUT rewrite: ATR/volatility exits + trailing stops (M4), Bayesian prior-updating confidence on patterns (M6), regime-conditioned calibration (future), causal/knowledge-graph edges (extend `trader_knowledge_edges`). Defer RL-for-exits and GA-as-promotion (governance-forbidden as promotion paths; only usable as recommend-only candidate generators feeding the human gate).

## Risks (residual)

- Semantics versioning must be enforced by review: any accidental UPDATE to `trader_backtest_results`/`trader_blind_validation_results`/PKA/`replay-runs/**` breaks ADR-0010 immutability — mitigated by "new rows/files only" rule + git-status check in M0 Phase 3.
- Forced-flat mark-to-close is synthetic; over-reliance could flatter results — mitigated by separating `markedPnl` from `realizedPnl` and by M4 producing real exits.
- M0 repair alone may not satisfy regime coverage (M0.5 audit) — decoupled by design.
- Autonomous discovery (M8) risks overfitting — mitigated by mandatory single-use blind discipline and human promotion gate.

---

## Historical execution annotation (2026-07-06 — do not edit body above)

**Document class:** Frozen snapshot copied before M0 Phase 1. Todo statuses above reflect copy-time state only.

| Milestone | Actual outcome | Concluding reference |
|-----------|----------------|----------------------|
| M0–M0.5 | Complete | DEE-372 forensics |
| M1–M8 | Complete | DEE-376–383 / PRs #365–370 |
| **M9** | **Closed — `M9_BLOCKED_BY_ACCOUNTING_DEFECT`** | DEE-384–386 / PRs #371–373 |
| M10+ | Not started | Blocked per canonical roadmap |

**Active roadmap (post-M9):** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md`  
**Canonical recovery entry point:** `AI-TRADER-ENGINEERING-STATUS.md`

Implementation continues only through the approved Intelligence Evolution roadmap. Next: **PR1 — Canonical Position Ledger**.
