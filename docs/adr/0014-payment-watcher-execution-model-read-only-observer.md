# ADR-0014 — Payment Watcher: Read-Only Inbound Observer on Cloudflare Worker + Cron

Status: Accepted
Date: 2026-06-25
Baseline: AT-E12 S3 (inbound payment observation)

## Context

AT-E12 S1 ([DEE-312](https://linear.app/deepsense/issue/DEE-312)) delivered the append-only `payment_events` ledger and the `payments` projection. AT-E12 S2 ([DEE-313](https://linear.app/deepsense/issue/DEE-313), ADR-0013) delivered the Payment Address Registry with DB-enforced `(network, address)` global uniqueness, a lifecycle FSM, and (DEE-317) confirm-time org-ownership and attribution-eligibility validation. The seam a watcher must write into — `PaymentService.detectPayment` / `confirmPayment` — therefore already enforces idempotency, settlement-attribution uniqueness `(settlement_network, settlement_tx_hash, transfer_index)`, and tenant isolation.

The next candidate is the Payment Watcher: the component that observes USDT TRC-20 deposits to registered addresses and drives detect → confirm. Before implementation, two assumptions in the existing canon must be resolved:

1. ADR-0013 lists "chain-watching" alongside custody/signing/broadcasting as deferred to "S7/S8 and beyond." That grouping conflates the **inbound, read-only** observer with the **outbound** custody/signing machinery.
2. [AI-TRADER Master Spec v2](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md) §4 and §6 place the Payment Watcher inside "long-running services off-Cloudflare," governed by the hard rule "Cloudflare must not host the execution engine, persistent exchange sessions, or the fast order path." The §6 diagram also carries an anomalous `PW --> HTX` edge; the payment rail is Tron TRC-20, not HTX.

This ADR records the WHY for reclassifying the watcher and selecting its MVP execution model. It does not implement the watcher.

## Decision

### 1. The Payment Watcher is a read-only inbound chain observer

The watcher only **observes** the chain and **writes** payment events into WAIA Core. It holds no private keys, performs no signing, manages no custody, and broadcasts no transactions.

**Why:** The risk surface that motivated deferring "chain-watching" to S7/S8 is key material and signing (AI-TRADER Security §4). An inbound observer touches none of it; it reads public ledger data and public deposit addresses. Coupling it to the custody slices would needlessly block delivery of MVP success criterion #9 ("USDT TRC-20 payments are detected and attributed").

### 2. The watcher is decoupled from AT-E12 S7/S8 (custody / signing / disbursement)

Inbound observation (this slice) and outbound custody/signing/disbursement (S7/S8) are separate problems with separate risk surfaces and may be sequenced independently. The inbound watcher does not depend on any S7/S8 deliverable.

**Why:** Separation keeps the high-risk key-management work isolated (per ADR-0013 §6) while allowing the low-risk observer to ship on the existing ledger seam. It also prevents a false dependency that would push payment attribution behind custody on the critical path.

### 3. MVP execution model is a Cloudflare Worker driven by a Cron Trigger

The MVP watcher runs as a scheduled Worker (Cron Trigger, ~30–60s cadence) that scans for new USDT TRC-20 transfers to registered addresses, calls `detectPayment` at first sighting and `confirmPayment` at finality depth, using plain `fetch` against the RPC provider (no `tronweb` in workerd).

**Why:** The watcher is slow-state, not fast-execution: USDT-TRC20 finality is ~60s, so a per-minute cron is sufficient and the "off-Cloudflare hard rule" (which protects the latency-sensitive trading path and persistent exchange sessions) does not apply. The repository already proves every primitive: per-request `postgres.js` from Workers via the Supabase pooler (`db/postgres-client.ts`), `nodejs_compat`, and the ledger as a pure library. No VPS exists yet; standing one up to host a 60s poller contradicts ADR-0006 ("extract a services/ daemon only when a persistent execution loop is unavoidable").

### 4. Watcher logic lives in a host-agnostic core; the Worker handler is a thin adapter

All ingestion logic is a pure module (proposed `lib/waia-core/payment-watcher/**`) exposing a single entrypoint, e.g. `runWatcherCycle(deps): Promise<CycleReport>`. The Cron handler builds dependencies and calls it. A `ChainAdapter` interface abstracts the chain (`TronAdapter` first).

**Why:** This makes the host a deployment detail rather than an architecture commitment. The same `runWatcherCycle` can later run inside an off-Cloudflare daemon `setInterval` loop or a Queue consumer with zero core rewrite — de-risking a decision that currently diverges from the Master Spec, and giving a clean multi-chain extension point (one adapter per chain).

### 5. The external off-Cloudflare daemon is the documented graduation target, not the MVP

When the execution-engine VPS exists (Roadmap Phase 6+), or when sub-minute latency, high address volume, or multi-chain fan-out demand it, the watcher graduates to the off-Cloudflare daemon by re-hosting the same `runWatcherCycle` core. Triggers for graduation are recorded here.

**Why:** Pre-building the daemon is premature for a single-tenant (Org 0), single-chain MVP. Recording the graduation triggers prevents both premature infrastructure and silent drift away from the documented topology.

### 6. The watcher's sole new persistent state is a Postgres checkpoint table

The only new persistent state is `payment_watcher_checkpoints` (per-network cursor). Idempotency, deduplication, and tenant isolation are inherited from the ledger and registry, not re-implemented. KV / Durable Object / queue-metadata state is rejected for MVP.

**Why:** Postgres is the WAIA Core source of truth and is transactionally consistent with the ledger writes. A single checkpoint row is the minimum durable cursor needed for restart/recovery. **This decision authorizes the future Build slice to add exactly one additive migration (`payment_watcher_checkpoints`) in both backends; no migration is created by the ratification slice.**

### 7. Amend the Master Spec topology

[AI-TRADER Master Spec v2](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md) §4 and §6 are amended so the Payment Watcher is shown as a slow-state Core writer (Cloudflare Worker + Cron in MVP, daemon as graduation target), and the anomalous `PW --> HTX` edge is removed and replaced with `PW --> TRON` (Tron RPC) and `PW --> PG`.

**Why:** Keeps the governing technical spec internally consistent with this decision and removes a diagram error that misrepresents the payment rail.

## Consequences

+ The inbound watcher can ship on the existing, fully-tested ledger seam without custody/signing work.
+ Lowest operational footprint: reuses existing Worker deploy, secrets, Postgres path, and stdout observability.
+ Host-agnostic core keeps relocation to a daemon or Queue consumer a deployment change, not a rewrite.
+ Multi-chain extension is an adapter addition plus a network-ID entry; no schema change.
− Diverges from the current Master Spec placement until §4/§6 are amended (done in the docs slice).
− One additive migration (`payment_watcher_checkpoints`) is required by the future Build slice.
Neutral: graduation to the off-Cloudflare daemon remains available and is governed by the triggers in decision 5.

## Links

- [ADR-0006 — AI-TRADER repository strategy](0006-ai-trader-repository-strategy.md)
- [ADR-0008 — Manual billing gate](0008-manual-billing-gate.md)
- [ADR-0013 — Payment Address Registry](0013-payment-address-registry-wallet-anchored-event-sourced-soft-bound.md)
- [ADR-0015 — Tron settlement / finality / RPC trust doctrine](0015-tron-settlement-finality-rpc-trust-doctrine.md)
- [AI-TRADER Master Spec v2](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md) §4, §6
- [AI-TRADER Billing & HWM](../ai-trader/AI-TRADER-BILLING-HWM.md) §8–9
- [AI-TRADER Security](../ai-trader/AI-TRADER-SECURITY.md) §8
- [DEE-319 — AT-E12 S3-DOC Payment Watcher architecture ratification docs slice](https://linear.app/deepsense/issue/DEE-319)
