# ADR-0013 — Payment Address Registry: Wallet-Anchored, Event-Sourced, Soft-Bound Architecture

Status: Accepted
Date: 2026-06-25
Baseline: AT-E12 S2 (reviewed and approved 2026-06-25)

## Context

AT-E12 S1 ([DEE-312](https://linear.app/deepsense/issue/DEE-312)) delivered the append-only `payment_events` ledger and the `payments` rebuildable projection as WAIA Core shared infrastructure. The table `payment_events.payment_address_id` is a nullable soft reference whose FK target does not yet exist. AT-E12 S2 ([DEE-313](https://linear.app/deepsense/issue/DEE-313)) fills that seat with a **Payment Address Registry**.

Before S2 implementation begins, five structural decisions about the registry's architecture require an explicit WHY record. These decisions shape schema, module boundaries, and multi-year recovery and multisig extensibility. They are recorded here because they encode precedent that must survive code churn and future agent/human readers.

S2 does **not** implement custody, key management, signing, or chain-watching. Those belong to later slices (S7/S8 and beyond).

## Decision

### 1. Addresses belong to wallets — not to accounts or modules

A new `payment_wallets` table is the stable **control-domain anchor**. Every address is issued under a wallet; no bare addresses exist in the registry.

**Why:** Future `signers`, `keys`, `threshold_policy`, and `recovery_policy` tables all attach to the wallet, not to the address. This means addresses survive signer rotation without re-issuance — the wallet absorbs the organizational churn while the address exposed to payers remains stable. Flattening addresses without a wallet anchor would force address recycling every time recovery or multisig topology changes, which is both operationally disruptive and an attribution risk.

### 2. All module bindings are soft references

`payment_addresses` owns `owner_organization_id` as a hard FK (Core-to-Core). The fields `subject_module`, `subject_ref`, and `binding_ref` that bind an address to a paying entity (e.g., an invoice, account, or subscription) are **soft value columns** — no FK from a Core table into a module table.

**Why:** WAIA Core Architecture §3 prohibits Core tables from holding FKs into module tables. A hard FK would create a circular dependency that makes Core undeployable independently and breaks module isolation. Soft references allow Core to remain a clean platform layer while modules resolve the reference at the application layer. The trade-off (no DB-enforced referential integrity toward modules) is accepted: the application layer enforces binding validity, and the event chain provides auditability.

### 3. `(network, address)` is globally unique and permanently owner-bound

A composite unique constraint on `(network, address)` is enforced at the database level across the entire registry. Once an address is issued to an organization it is **permanently bound** to that owner. Cross-owner reuse is forbidden. Same-owner re-activation is permitted.

**Why:** Crypto payment attribution depends on address uniqueness. If the same on-chain address were ever issued to two organizations — even sequentially — incoming funds could be misattributed. This constraint is a financial-correctness invariant, not a convenience rule. It must be DB-enforced, not application-layer-only. Permanent owner-binding also simplifies forensic auditing: every historical on-chain transaction to an address can be attributed to exactly one organization without time-window lookups.

### 4. Reject 2-of-2 as the default recovery posture

2-of-2 multisig (requiring both signers to act) is explicitly **rejected** as the default recovery policy.

**Why:** 2-of-2 has no fault tolerance. Loss of either key (hardware failure, loss, compromise, or death) results in permanent loss of funds with no recovery path. For a single-founder organization under the [Single Operator Governance Model (ADR-0011)](0011-single-operator-governance-model.md), 2-of-2 is especially dangerous: the operational key and the backup key are likely both under a single person's control, making any key-loss event catastrophic. 2-of-2 provides the appearance of security (two keys required) while removing the most important safety property (recovery when one key is lost).

### 5. Default recovery posture is 2-of-3; hardened configuration is 2-of-4

The **default** recovery threshold is **2-of-3** (any 2 of 3 signers sufficient). The **hardened** configuration is **2-of-4** (any 2 of 4 signers, providing a second redundant backup path).

**Why:**
- **2-of-3** provides fault tolerance: one key can be lost or rotated without fund loss. It is the minimum viable recovery posture for any production custody setup.
- **2-of-4** provides a second independent backup channel — useful when operational geography, hardware diversity, or co-founder introduction makes a fourth signer natural. It increases resilience against simultaneous loss of two backup keys, which is a realistic scenario for long-lived wallets.
- These thresholds are architectural targets for S7/S8. S2 does not implement signers or threshold policy tables; it stores `control_model` as an opaque text field on `payment_wallets` to record intent without enforcing it prematurely.

### 6. S2 scope boundary: no keys, seeds, xpubs, signers, signing, or transaction broadcasting

AT-E12 S2 is explicitly scoped to **public address metadata** and the address lifecycle event chain. S2 stores: the address string (public, safe to persist), opaque derivation/provider references, and wallet metadata. S2 does **not** store or process:

- Private keys, seeds, or mnemonics
- Extended public keys (xpubs) that would allow address enumeration
- Signer identity, threshold configuration, or recovery policies
- Signing requests or signatures
- Transaction broadcasting or chain-watching

**Why:** Mixing address-lifecycle concerns with key management and signing would couple two very different risk surfaces. Address lifecycle is relatively low-risk (public data, event-sourced, auditable). Key management, multisig signing, and broadcasting are the highest-risk operations in the system (see [AI-TRADER Security](../ai-trader/AI-TRADER-SECURITY.md) §4 and §1). Separating them ensures S2 can be delivered, reviewed, and deployed without triggering the key-management security requirements that belong to AT-E14 and S7/S8. It also prevents accidental persistence of key material alongside address records.

## Consequences

+ Clear wallet-first data model that accommodates future multisig, signer rotation, and recovery policy without schema migration to the address layer.
+ Module bindings remain decoupled from Core — Core deployable and testable in isolation.
+ DB-enforced global address uniqueness eliminates a class of payment-attribution bugs.
+ 2-of-3 / 2-of-4 recovery posture is documented before any signer tables are built, preventing a future default-to-2-of-2 regression.
+ S2 is safely scoped: no key material risk surface in this slice.
− Soft module bindings require application-layer validation; DB cannot enforce cross-module referential integrity.
− `control_model` is stored as opaque text in S2; threshold policy is not machine-readable until S7/S8 introduces structured signer/threshold tables.
Neutral: recovery architecture (S7/S8) will need to reference and conform to decisions 4 and 5; this ADR is the binding upstream constraint.

## Links

- [DEE-318 — ADR-0013 docs slice (this issue)](https://linear.app/deepsense/issue/DEE-318)
- [DEE-313 — AT-E12 S2 Payment Address Registry](https://linear.app/deepsense/issue/DEE-313)
- [DEE-315 — AT-E12 S2-A Payment Address Schema & Migrations](https://linear.app/deepsense/issue/DEE-315) — first implementing slice; blocked by this ADR
- [ADR-0007 — Targeted RLS strategy](0007-targeted-rls-strategy.md)
- [ADR-0011 — Single Operator Governance Model](0011-single-operator-governance-model.md)
- [AI-TRADER Security](../ai-trader/AI-TRADER-SECURITY.md) §8 (Payment security), §4 (Key management)
- [AI-TRADER Implementation Program](../ai-trader/AI-TRADER-IMPLEMENTATION-PROGRAM.md) — AT-E12 epic entry
- [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md) §3 (module boundary rules)
