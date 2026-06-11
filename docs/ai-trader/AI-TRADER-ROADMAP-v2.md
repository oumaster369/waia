# AI-TRADER Roadmap v2

Status: Baseline v1.2 (governing sequence)
Date: 2026-06-11

This roadmap supersedes `AI_TRADER EXECUTION ROADMAP v1.0`. It reflects the real WAIA codebase (single Next.js app, Drizzle, Supabase Auth, Cloudflare Workers via OpenNext), the accepted constraints, and the final architectural decisions in Baseline v1.2.

Two corrections drive this version:
1. The original roadmap assumed WAIA Core identity/tenancy already existed. It does not — so a Core uplift phase precedes all trader feature work.
2. The original roadmap sequenced the Risk Engine and Execution late. The **safety spine is pulled forward** so paper trading runs end-to-end against simple signals while intelligence matures.

The platform must never start with live trading.

---

## Phase 0 — Architecture approval

**Objective:** lock the architectural truth.

- Approve Architecture Baseline v1.2 and this documentation set.
- Ratify the seven ADRs: SaaS-as-Superset, Repository Strategy, Targeted RLS, Manual Billing Gate, Regulatory Posture, Strategy Validation Gate (ADR-0010), Single Operator Governance Model (ADR-0011).
- Confirm reconciled MVP scope and that the user journey is spot-only.
- Decide the managed secret-storage target (it is a prerequisite before any real exchange credentials are stored — see Phase 2).

**Exit:** baseline approved; no restructuring performed; planning may begin.

---

## Phase 1 — WAIA Core uplift (live-platform migration — not greenfield, not a trader feature phase)

**Objective:** introduce the identity/tenancy layer the trader depends on **into a live, running platform** that is already serving AI-TWIN.

> **This phase is a shared-platform prerequisite, not AI-TRADER feature work**, and it is a **live migration, not greenfield**. It delivers no trader functionality. **AI-TRADER development (Phase 2 onward) does not begin until Phase 1 is complete.** Treat any attempt to start trader domain tables, routes, or services before Phase 1 completion as out of sequence.

**Treat Phase 1 as a platform-migration program** governed by the additive-migration discipline in [ADR-0002](../adr/0002-staged-postgres-runtime-rollout-discipline.md) and `db/AGENTS.md`:

- **Migration planning required** — staged, additive migrations for `profiles`, `organizations`, `organization_members`, roles, permissions, subscriptions, entitlements; existing `users` backfilled into the org model.
- **Rollback required** — every migration has a documented rollback; no destructive change without a tested reversal path.
- **AI-TWIN continuity required** — existing AI-TWIN users get a personal organization via backfill with zero behavioral change; AI-TWIN flows must keep working throughout.
- **Backward compatibility required** — preserve `public.users.id == auth.users.id`; do not break existing queries; additive-only on tables AI-TWIN already reads.
- Mandatory org-scoped query helper; targeted RLS on credentials/payments/audit (defense-in-depth).
- Platform audit stream (`audit_logs`, append-only, tamper-evident).

**Exit:** every existing and new user has an organization and entitlements; **AI-TWIN verified unaffected (continuity + rollback tested)**. **Gate: Phase 2 may not start until this exit is met.**

---

## Phase 2 — Trader shell + HTX connect (read)

**Objective:** reach the trader experience and connect HTX safely (read path).

- `app/(trader)` route group; `trader.waia.life` host-based rewrite; `trader` entitlement gate.
- Exchange connector interface + HTX read implementation + mock connector.
- **Managed key infrastructure (KMS / managed secret store) is a prerequisite of this phase and must be in place before any real exchange credential is stored.** Envelope encryption is wrapped by a master key resident in the managed store — never an env-baked or image-baked key. Until the managed store is live, only the mock connector and read-only flows may be exercised.
- Credential encryption (envelope), masking, service-role-only access.
- Balance / position / trade-history sync and snapshots.

**Exit:** managed key infrastructure is live; a user connects an HTX spot account (credentials wrapped by the managed master key) and sees synced balances.

---

## Phase 3 — Safety spine v0

**Objective:** stand up protection **against the mock connector** before any real market intelligence or live path exists.

> **Sequencing clarification (read carefully).** "Safety spine v0" means the safety control plane is built and proven against the **mock connector and synthetic/replayed inputs** in Phase 3 — it does **not** require real market data, which arrives in Phase 4. The intent is that the Risk Engine, kill switches, order state machine, and reconciliation skeleton exist and are drill-tested *before* real market intelligence (Phase 4) and *long* before any live capital (Phase 8). The spine is then exercised with real signals in Phase 6 (paper) and hardened for live in Phase 8. Phases 3 and 4 have no hard ordering dependency on each other except that **both must precede Phase 6 (paper end-to-end)**; Phase 3 is listed first to make the safety-first posture unambiguous.

- Risk Engine: position/loss/drawdown limits + security controls (symbol allowlist, notional caps, order-rate, price collars).
- Kill switches at all levels (global/user/account/strategy/instrument), fail-closed.
- Order state machine, idempotency keys, reconciliation skeleton, mock connector wiring.

**Exit:** no signal can reach execution without risk approval; kill switches drill-tested against the mock connector.

---

## Phase 4 — Market data + minimal MSV

**Objective:** give the system market understanding.

- WebSocket ingestion for BTC/ETH spot; bars + derived features.
- Fear & Greed + news sentiment ingestion.
- Cold-storage strategy: raw tick/L2 to R2; only derived features + bars + MSV in Postgres.
- Market State Vector with regime, trading permission, and `data_quality_score` gate.

**Exit:** MSVs are produced and stored; low data quality forces PAPER_ONLY.

---

## Phase 5 — Chief Decision Engine + strategy framework

**Objective:** decide whether to trade and emit signals.

- Chief Decision Engine: regime classification → trading permission → allowed strategy set.
- Strategy registry/versions/assignments; the two whitelisted strategies emit structured signals.

**Exit:** strategies produce signals; nothing executes.

---

## Phase 6 — Paper trading end-to-end (MVP heartbeat)

**Objective:** run the full loop without touching client funds.

> **Observability prerequisite (sequencing).** Minimum observability must exist **before** paper-trading validation begins, so the paper run is actually measurable: structured logging, the critical-alert set (failed reconciliation, duplicate-order risk, data-quality below threshold, payment-watcher offline, live-vs-paper divergence), reconciliation-mismatch surfacing, and the decision/reason-code and signal counters. This does not redesign the roadmap — it states that the observability baseline (Master Spec §20) is a gate into Phase 6, not a later add-on. Full observability automation remains post-MVP; only the minimum measurable baseline is required here.

- Signal → trivial allocation → Risk Engine → mock execution → reconciliation → paper reporting.
- Introduce a `services/` directory + lightweight pnpm workspaces **only here**, if a persistent loop/WebSocket session requires it (see ADR-0006).

**Exit:** the system operates end-to-end in paper for ≥48 hours with clean reconciliation **and the minimum observability baseline is live** (the paper run is fully measurable). This 48-hour exit proves *plumbing stability only* — it is **not** authorization to go live; live promotion requires the Strategy Validation Gate below.

---

## Phase 7 — Reporting / HWM / billing on paper PnL

**Objective:** validate the business model before real money.

- Monthly reporting periods, per-account HWM, deposit/withdrawal adjustment, fee math.
- Invoice lifecycle, USDT TRC-20 unique addresses, payment watcher, suspension lifecycle.
- **Manual reconciliation gate** operational: drafts computed, human approves issuance.

**Exit:** fees compute correctly on paper PnL; invoice/payment/suspension flows proven.

---

## Strategy Validation Gate (between paper and live — mandatory)

**Objective:** ensure a strategy has demonstrated *edge*, not just stable plumbing, before any live capital — including Org 0.

> A flawless platform with no strategy edge still fails. The Phase 6 48-hour stability check proves the loop works; it does **not** prove an edge exists. **No strategy may be promoted to live (Phase 8), even for Org 0, until it passes this gate.** Governance structure only — no quantitative thresholds are fixed here. See [ADR-0010](../adr/0010-strategy-validation-gate.md).

- **Minimum validation evidence:** a promotion record (strategy version + commit, hypothesis + intended regime, paper evidence, cost model, observed reason-code distribution, known failure modes).
- **Paper-trading evidence:** a window meaningful for the strategy's horizon (beyond the 48-hour plumbing check), across more than one regime where observable, with clean reconciliation and acceptable data quality throughout.
- **Acceptable confidence criteria:** the operator records an explicit written judgment that edge exists net of modeled costs, that live is expected to track paper, and that downside is Risk-Engine-bounded. Absence of evidence = failure.
- **Governance approval:** promotion is a logged action under the Single Operator Governance Model ([ADR-0011](../adr/0011-single-operator-governance-model.md)) — immutable audit, cooling-off period, explicit confirmation, reversible (demotion to paper) at any time.

**Exit:** a signed promotion record exists for each strategy intended to go live; without it, Phase 8 may not enable that strategy.

---

## Phase 8 — Limited live spot (Org 0 only)

**Objective:** controlled production test with **in-house capital only**.

- **Live trading in MVP is restricted to Org 0 (the in-house fund).** External client live trading is **prohibited by policy** until ADR-0009 transitions from `Accepted (Posture)` to `Accepted (Cleared)`. No entitlement, flag, or workflow may enable external live trading before that transition.
- **Each strategy enabled here must have passed the Strategy Validation Gate** (signed promotion record per ADR-0010). Plumbing stability alone does not authorize live.
- Admin-flagged enablement under the Single Operator Governance Model (immutable audit, cooling-off, explicit confirmation — ADR-0011); strict notional caps; single supervised account (Org 0).
- Hardened, isolated execution host; managed master key; live reconciliation; startup state rebuild.

**Exit:** real spot trades execute on Org 0 under strict controls with full audit; no external tenant trades live.

---

## MVP Launch gate

All must hold:

- Paper loop stable ≥48h end-to-end with reconciliation, **with the minimum observability baseline live** (the run is measurable).
- Every live-enabled strategy has passed the **Strategy Validation Gate** (signed promotion record, ADR-0010).
- All kill switches drill-tested and fail-closed.
- Deposit/withdrawal attribution solved, **or** billing hard-gated to manual reconciliation.
- Managed key infrastructure (KMS / managed secret store) in place **before any real credential is stored**; execution host hardened and isolated.
- Live trading limited to Org 0 (in-house capital). External live trading remains prohibited by policy until ADR-0009 is `Accepted (Cleared)`; MVP launch does **not** require that transition.
- Live-enable, strategy promotion, and invoice waiver governed by the **Single Operator Governance Model** (immutable audit, cooling-off, explicit confirmation, reversible where possible — ADR-0011).

---

## Post-MVP (future phases)

- Research automation (backtesting, walk-forward, experiment tracking).
- Strategy Health automation.
- Multi-exchange connectors.
- Portfolio / fund structures and advanced allocation.
- Institutional reporting and partner channels at scale.

---

## Related documents

- [AI-TRADER MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md)
- [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)
- [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)
