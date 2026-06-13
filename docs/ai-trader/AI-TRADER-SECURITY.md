# AI-TRADER Security

Status: Baseline v1.2
Date: 2026-06-11

This document defines the security model for AI-TRADER: credential storage, encryption, key management, admin controls, kill switches, payment security, and audit requirements. It is binding and aligns with WAIA secrets governance (`.cursor/rules/40-secrets.mdc`) and [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md).

---

## 1. Threat framing

The highest-value assets are **trade-capable exchange API keys** and the **master encryption key**. A core correction to earlier thinking: **"non-custodial" does not mean "safe."** Trade-only keys (no withdraw/transfer) can still destroy capital via self-/wash-trading into attacker liquidity or dumping into illiquid books. Security controls must treat trade access as dangerous.

Primary attack surfaces:
1. The long-running execution host holding decrypted trade keys.
2. The master encryption key.
3. Admin/service-role credentials reachable from a web path.
4. The payment webhook ingress.
5. HTX permission spoofing where metadata is absent.

---

## 2. Credential storage

- API key, secret, and passphrase are **never stored in plaintext**.
- Only encrypted material and encryption metadata are persisted; a masked key fragment may be stored for display.
- Credentials are written/read by backend services only (service role). They are **never** returned by user-facing APIs and **never** sent to the browser.
- Credentials are never logged. Logs and UI always mask keys.
- Key rotation is supported; rotation events are audited.

---

## 3. Encryption

- Use **envelope encryption** (or secure equivalent): a per-record data key encrypts the credential; the data key is wrapped by a master key.
- Consider per-organization data keys to limit blast radius.
- Encryption key version is stored alongside ciphertext to support rotation and re-encryption.

---

## 4. Key management

- **Managed key infrastructure is a prerequisite before any real exchange credential is stored — not merely before live trading.** The master key must live in a **managed secret store / KMS**, not baked into an image or a plain environment variable, *before* the first real (non-mock) credential is persisted. This is a roadmap sequencing rule (Roadmap Phase 2): until the managed store is live, only the mock connector and read-only flows may be exercised, and no real API key/secret/passphrase may be written.
- The master key is never committed, never logged, and never present in the web/Cloudflare runtime.
- On the execution host, key residency in memory is minimized (decrypt per batch, zeroize after use) and egress is restricted to exchange endpoints.

> **Sequencing clarification (Red Team remediation).** This does **not** redesign the security architecture (envelope encryption, service-role-only access, masking are unchanged). It clarifies *when*: real credentials must never spend any time under the weakest key model. Managed key infrastructure precedes credential storage.

---

## 5. API permissions

- Allowed: **READ**, **TRADE** (plus read-only position/margin scopes for futures only if/when enabled — out of MVP).
- Forbidden: **WITHDRAW**, **TRANSFER**, subaccount/API-key/KYC management.
- Reject forbidden permissions where HTX metadata exposes them; behave safely (do not assume safety) when metadata is unavailable.
- The Risk Engine enforces **trade-abuse controls as security controls**: symbol allowlist, max notional, max order rate, and price-collar checks; abnormal counter-liquidity triggers alerts.

---

## 6. Admin controls

- Admin actions are governed by the WAIA Core `admin` role.
- **Single Operator Governance Model required** for sensitive actions — enabling live trading, strategy promotion (ADR-0010), and waiving/cancelling invoices. (This **replaces dual-control**, which is unrealistic for a one-founder organization.) Each such action requires: an **immutable audit-trail** entry; a **cooling-off period** before it takes effect (during which it is visible and cancellable); an **explicit multi-step confirmation workflow** (never a single click); **mandatory logging** of confirmation and effective moment; and **reversibility where possible**. See [ADR-0011](../adr/0011-single-operator-governance-model.md).
- Every admin action writes to the shared append-only (tamper-evident) audit stream with an audit reason.
- Service-role access is confined to trusted backend runtime and is never reachable from the browser.

---

## 7. Kill switches

- Implement kill switches at every level: **global, per-user, per-account, per-strategy, per-instrument**.
- Automatic kill switches trigger on: API errors, reconciliation mismatch, abnormal slippage, unknown positions, or suspicious execution behavior.
- Kill switches are enforced **inside the execution service** (tight poll/subscribe), not merely as a database flag a loop might not re-read.
- **Fail-closed:** loss of control-plane connectivity or data-quality failure forces stop / PAPER_ONLY.

---

## 8. Payment security

- USDT TRC-20 with **unique deposit address per account**.
- Verify token, network, amount, and required confirmations; store the transaction hash.
- **Shared-address + exact-amount matching is banned in production** (spoofable).
- Payment webhook ingress must verify provider signatures and be idempotent; ingress only writes/enqueues — it never executes trades.

---

## 9. Tenant isolation

- Application-layer scoping by `organization_id` is primary; a mandatory shared query helper prevents unscoped queries.
- Targeted RLS is applied as defense-in-depth on `exchange_credentials` (service-role only; deny `authenticated`), `payments`/`payment_addresses`, and `audit_logs` (insert-only services, select-only admins). See [ADR-0007](../adr/0007-targeted-rls-strategy.md).

### Tenant-isolation test gate (mandatory)

Because tenant isolation is primarily enforced in application code, it must be continuously proven by tests:

- **Every organization-scoped API, query path, service endpoint, admin operation, and dashboard view must have tenant-isolation tests** confirming that one organization cannot read or mutate another's data, and that no user can reach any encrypted secret.
- **Cross-organization access failures are release blockers** — they block merge and release until resolved, with no waiver.
- An organization-scoped surface is not "done" without its isolation tests.

---

## 10. Audit requirements

- One platform append-only audit stream (Core-owned).
- Audit at minimum: credential create/rotate/delete, trading enable/disable, kill-switch activation, admin overrides, invoice issuance/waiver, manual billing sign-off, and live-trading enablement.
- Audit rows must be sufficient to reconstruct who did what, to which entity, in which organization, and why.

---

## 11. Recovery & resilience

- The execution service rebuilds in-memory state from the exchange and Supabase on startup **before** resuming any trading.
- Reconciliation mismatches are never ignored; they raise risk events and can auto-trip kill switches.

---

## 12. Non-negotiable security rules

1. Never request or hold WITHDRAW/TRANSFER permission.
2. Never store secrets in plaintext; never expose them to the browser or logs.
3. Managed key infrastructure in place **before any real credential is stored**; master key never env-baked for production.
4. No order without Risk Engine approval; trade-abuse controls are security controls.
5. Kill switches enforced in the execution service and fail closed.
6. Admin live-enable, strategy promotion, and invoice waiver run under the Single Operator Governance Model (immutable audit, cooling-off, explicit confirmation, reversible where possible) — not dual-control.
7. Payment attribution uses unique addresses; shared-address matching is banned.
8. Every sensitive action is auditable and reconstructable.

---

## Related documents

- [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)
- [AI-TRADER Billing & HWM](AI-TRADER-BILLING-HWM.md)
- [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)
