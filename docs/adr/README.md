# Architecture Decision Records (ADR)

Incremental reasoning log.**Authoritative trackers** (`DEE-64`, `DEE-95*`) retain operational migration sequencing—ADRs complement with concise WHY snapshots.

**Sparse and selective:** Few ADRs beat a thick archive. **Missing an ADR** does **not** imply “no architectural intent”—many decisions stay clear enough in **product specs**, **governance docs**, **PR bodies**, and **Linear** without a numbered record.

See policy: [`../waia-governance/ADR-POLICY.md`](../waia-governance/ADR-POLICY.md)

| ID | Title | Status | Related |
|----|-------|--------|---------|
| [0001](0001-linear-aligned-branch-names-dee-prefix.md) | Linear-aligned branch naming (`dee-<NN>-<slug>`) | Accepted | DEE tooling hygiene |
| [0002](0002-staged-postgres-runtime-rollout-discipline.md) | Staged Postgres / split-runtime discipline | Accepted | `DEE-64`, `DEE-72`, `DEE-95*` |
| [0003](0003-stdout-runtime-route-telemetry.md) | Stdout-first runtime route telemetry | Accepted | `DEE-95f`, `DEE-95g` |
| [0004](0004-additive-governance-evolution.md) | Additive DEV OS governance evolution | Accepted | Governance wave PR |
| [0005](0005-saas-as-superset-strategy.md) | SaaS-as-Superset strategy (fund as first tenant) | Accepted | AI-TRADER Baseline v1.2 |
| [0006](0006-ai-trader-repository-strategy.md) | AI-TRADER repository strategy (single repo, minimum evolution) | Accepted | AI-TRADER Baseline v1.2 |
| [0007](0007-targeted-rls-strategy.md) | Targeted RLS strategy (app-enforced primary) | Accepted | AI-TRADER Baseline v1.2 |
| [0008](0008-manual-billing-gate.md) | Manual billing gate for performance fees | Accepted | AI-TRADER Baseline v1.2 |
| [0009](0009-regulatory-posture.md) | Regulatory posture for managed trading + performance fees | Accepted (Posture) — gates external live trading | AI-TRADER Baseline v1.2 |
| [0010](0010-strategy-validation-gate.md) | Strategy Validation Gate (paper → live) | Accepted | AI-TRADER Baseline v1.2 |
| [0011](0011-single-operator-governance-model.md) | Single Operator Governance Model (replaces dual-control) | Accepted | AI-TRADER Baseline v1.2 |
| [0012](0012-governance-integration-founders-council-and-english-canon.md) | Governance Integration: Founders Council apex authority and English canon | Accepted | Phase 0 Governance Integration; Acceptance v2.0 |
| [0013](0013-payment-address-registry-wallet-anchored-event-sourced-soft-bound.md) | Payment Address Registry: Wallet-Anchored, Event-Sourced, Soft-Bound Architecture | Accepted | AT-E12 S2; `DEE-313`, `DEE-315` |
| [0014](0014-payment-watcher-execution-model-read-only-observer.md) | Payment Watcher: Read-Only Inbound Observer on Cloudflare Worker + Cron | Accepted | AT-E12 S3; `DEE-319` |
| [0015](0015-tron-settlement-finality-rpc-trust-doctrine.md) | Tron Settlement, Finality, and RPC Trust Doctrine | Accepted | AT-E12 S3; `DEE-319` |
| [0016](0016-settlement-exception-reconciliation.md) | Settlement Exception Reconciliation (immutable EXCEPTION row, separate reconciliation aggregate, derived effective outcome) | Accepted | AT-E12 S3-C; `DEE-216`, `DEE-323` |
| [0017](0017-postgres-only-trader-mvp.md) | Postgres-only for new AI-TRADER MVP code (Execution Freeze) | Accepted | P1 NEW-2 / `DEE-328`; ADR-0002 partial supersession |
| [0018](0018-research-intelligence-market-knowledge-base.md) | Research Intelligence Layer & Market Knowledge Base | Accepted | RI program M11; ADR-0010 amendment |
| [0019](0019-ai-operator-intelligence-authority.md) | AI Operator Intelligence authority boundaries (recommend-only) | Accepted | RI-P5; ADR-0011 |
| [0020](0020-m8-discovery-architecture-no-reinforcement.md) | M8 Discovery Architecture & No-Reinforcement Boundaries | Accepted | DEE-383; M8 program |
| [0021](0021-deterministic-research-replay-clock-and-state-isolation.md) | Deterministic Research Replay Clock & State Isolation | Accepted | DEE-397; Pre-Repeat-M9 Remediation PR1 |
| [0022](0022-content-bound-operator-authorization-and-idempotent-dataset-lifecycle.md) | Content-Bound Operator Authorization & Idempotent Research Dataset Lifecycle | Accepted | DEE-398; Pre-Repeat-M9 Remediation PR2 |
| [0023](0023-execution-server-ai-trader-only-execution-plane.md) | Execution Server as AI-TRADER-only execution plane | Accepted | DEE-406; vNext Slice D1 |
| [0025](0025-fhv-bounded-hot-state-and-streaming-economic-ledger.md) | FHV bounded hot state, streaming economic ledger, and the CI/Execution Server full-corpus boundary | Accepted | DEE-436 / DEE-416; PR #452; AD-6c DEE-536 |
| [0029](0029-compact-forecast-v2-seal-and-bytea-artifacts.md) | Compact Forecast V2 seal and bytea replica artifacts (no per-sample rows) | Accepted | DEE-518 / DEE-527 |
| [0030](0030-quantize-scale8-half-up-v1.md) | `quantizeScale8HalfUp/v1` — Forecast-only canonical quantizer | Accepted | DEE-518 / DEE-527 |
| [0031](0031-waia-cbrng-sha256-ctr-v1.md) | `WAIA_RANDOM_BLOCK_V1` / `waia-cbrng/sha256-ctr/v1` deterministic RNG | Accepted | DEE-518 / DEE-527, DEE-531 |

Add rows as new decisions land.**Superseded** decisions keep file for history — index notes replacement.

**Proposed (not yet authored):** **ADR-0024** — Roadmap autopilot activation (read-only selector + reconciliation proposer; human merge gate retained). Preparation contract: [`../waia-governance/ROADMAP-AUTOPILOT.md`](../waia-governance/ROADMAP-AUTOPILOT.md) (DEE-410; vNext Slice H). Author ADR only when an activation slice is Architect-approved — not in Slice H.
