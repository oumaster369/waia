# ADR-0015 — Tron Settlement, Finality, and RPC Trust Doctrine

Status: Proposed (pending ratification)
Date: 2026-06-25
Baseline: AT-E12 S3 (inbound payment observation)

## Context

[ADR-0014](0014-payment-watcher-execution-model-read-only-observer.md) selects a read-only inbound Payment Watcher. Before it can be built safely, the chain-trust parameters must be fixed as doctrine: which token counts, how deep is "confirmed," how reorgs are bounded, which RPC providers are trusted, and what the canonical network identifier is. [AI-TRADER Reality Doctrine](../ai-trader/AI-TRADER-REALITY-DOCTRINE.md) §11 reserved on-chain finality semantics for a future "Finality / Settlement doctrine"; for payments, this ADR is that doctrine.

This ADR fixes parameters only; it implements nothing.

## Decision

### 1. Token pin — only the canonical USDT TRC-20 contract counts

The watcher attributes a transfer only if it is emitted by the canonical Tron mainnet USDT (Tether) TRC-20 contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` with 6 decimals, and the recipient is a registered, attribution-eligible address. Transfers from any other contract, or native TRX transfers, are ignored for invoice attribution.

**Why:** "Shared-address + exact-amount matching is banned" (AI-TRADER Security §8); attribution must be by destination address plus verified token identity. Pinning the contract and decimals defeats fake-token / wrong-decimals spoofing.

### 2. Confirmation depth default = 20 (configurable)

`confirmations_required` defaults to **20** and is configurable via environment. `detectPayment` is called at first sighting (depth ≥ 1); `confirmPayment` is called only at depth ≥ `confirmations_required`.

**Why:** Tron DPoS irreversibility is reached at ~19 SR confirmations (~57s at ~3s blocks); 20 is the common exchange convention and matches the existing test fixture (`confirmationsRequired: 20`). Splitting detect (early) from confirm (final) gives early UX signal without premature settlement.

### 3. Reorg safety — bounded re-scan window; confirm only at finality depth

Each cycle re-scans a sliding window of the most recent `rescan_window` blocks (default ≥ `confirmations_required`) to catch pre-finality reorgs of already-detected transfers. The watcher never writes `CONFIRMED` before finality depth, so a `CONFIRMED` payment is never rolled back. A detected-but-not-yet-confirmed transfer that disappears in a reorg ages out and may be `failPayment(reason="reorg_dropped")`.

**Why:** Confirming only at finality depth makes post-finality rollback effectively impossible on Tron; the re-scan window makes pre-finality reorgs self-healing without manual intervention. A reorg deeper than finality is treated as a manual incident under [ADR-0008](0008-manual-billing-gate.md).

### 4. RPC providers — TronGrid primary, independent secondary

TronGrid (with API key + backoff) is the primary provider. A second, independent provider (managed alternate API or self-hosted full node) is configured for failover and for confirm-time cross-checking. On provider error (429/5xx), the cycle no-ops and does not advance the finality cursor.

**Why:** A single provider is both a rate-limit ceiling and a single point of trust/availability failure. Redundancy is the mitigation for "malicious RPC" and for outages.

### 5. Confirm-time quorum policy

MVP minimum: confirm on TronGrid primary at finality depth, with [ADR-0008](0008-manual-billing-gate.md) manual billing gate as the human backstop. Hardened (recommended before any non-Org-0 tenant): require ≥2 independent providers to agree on transfer existence and depth before writing `CONFIRMED`.

**Why:** Quorum closes the malicious/compromised-RPC and forged-confirmation gaps. Staging it (manual gate now, quorum before external tenants) matches the regulatory posture (ADR-0009) and avoids over-building for the single-tenant MVP.

### 6. Canonical network identifier = `TRC-20`

The canonical network ID is **`TRC-20`** (matching `KNOWN_PAYMENT_ADDRESS_NETWORKS` in the registry). All settlement evidence written by the watcher must use `settlementNetwork = "TRC-20"`. A normalization helper maps observed aliases (`TRC20`, `tron-trc20`, etc.) to the canonical value. Existing test fixtures that use `"TRC20"` for settlement are updated to `"TRC-20"` when the watcher is built.

**Why:** The registry already uses `"TRC-20"` while a payment test fixture uses `"TRC20"`; an unnormalized mismatch would silently break attribution and the settlement-uniqueness index. Choosing the registry's existing value avoids touching registry data. A single canonical-ID source of truth is the seam for future multi-chain identifiers.

## Consequences

+ Chain-trust parameters are fixed and reviewable before any code is written.
+ Token pin + address attribution + confirmation depth together defeat the documented spoofing vectors.
+ Network-ID normalization removes a latent attribution bug before production data exists.
+ Quorum staging keeps MVP lean while defining the hardening bar for external tenants.
− Secondary provider adds an integration and a config/secret to manage.
− Confirmation depth (~60s+) means settlement is not instant; acceptable for billing.
Neutral: per-chain finality parameters for future networks (Ethereum/BSC/Solana) will extend this doctrine, not replace it.

## Links

- [ADR-0014 — Payment Watcher execution model](0014-payment-watcher-execution-model-read-only-observer.md)
- [ADR-0008 — Manual billing gate](0008-manual-billing-gate.md)
- [ADR-0009 — Regulatory posture](0009-regulatory-posture.md)
- [AI-TRADER Security](../ai-trader/AI-TRADER-SECURITY.md) §8
- [AI-TRADER Billing & HWM](../ai-trader/AI-TRADER-BILLING-HWM.md) §8
- [AI-TRADER Reality Doctrine](../ai-trader/AI-TRADER-REALITY-DOCTRINE.md) §11
- [DEE-319 — AT-E12 S3-DOC Payment Watcher architecture ratification docs slice](https://linear.app/deepsense/issue/DEE-319)
