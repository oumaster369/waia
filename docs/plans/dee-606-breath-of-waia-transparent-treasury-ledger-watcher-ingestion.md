---
integrationIssue: DEE-606
integrationTitle: "Breath of WAIA — transparent treasury ledger, watcher ingestion and evidence model"
branch: dee-606-breath-of-waia-transparent-treasury-ledger-watcher-ingestion
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, unit-targeted, postgres-isolation-r5-safe]
approvalGates:
  - plan-approved
  - architect-review
  - human-architecture-approval
  - integration-ready
  - human-merge
includedIssues: []
deferredIssues: [DEE-607, DEE-611, DEE-612, DEE-613]
blockedByActiveWork:
  - id: DEE-518
    reason: "Unmerged Postgres migration reservation 0110–0147 (0146/0147 uncommitted in DEE-518 worktree). DEE-606 must not allocate migration identities until implementation preflight, and must not Human-merge migration-bearing PRs that assume unmerged DEE-518 journal predecessors."
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: draft
  currentWorkPackage: null
  completedWorkPackages: []
  remainingWorkPackages: [WP-0, WP-1, WP-2, WP-3, WP-4, WP-5, WP-6, WP-7, WP-8, WP-9]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Independent Architect corrections are complete. Revised draft awaits Human review/CONFIRM. Do not implement production schema/code until Human architecture approval. Migration identity remains deferred; migration-bearing merge blocked while DEE-518 journal predecessors remain unmerged."
  migrationIdentity:
    disposition: DEFERRED_TO_IMPLEMENTATION_PREFLIGHT
    frozenTag: null
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
    note: "Cannot safely freeze 0110+ while DEE-518 reserves 0110–0147. Filename collision avoidance alone is insufficient — see §13 merge-order gate."
  correctionPass:
    afterSha: a95b9c1c27b9d98df66cfb944c292dd1967e5f5e
    reason: "Independent Architect review corrections (T3, accounting vs detail publication, cash equation, commitments, runway as-of, reconciliation, fund-bucket deferral)."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-606 — Breath of WAIA transparent treasury (canonical implementation plan)

## Authority

- Live Linear **[DEE-606](https://linear.app/deepsense/issue/DEE-606/breath-of-waia-transparent-treasury-ledger-watcher-ingestion-and)** is the executable task contract.
- Public homepage Breath contract authored under DEE-605: `lib/landing/breath-public.ts` — **do not redesign** homepage visuals in DEE-606.
- **DEE-607** owns Admin Finance Console UX (blocked by this issue).
- **DEE-611** owns later public “Every contribution is remembered” copy (blocked by this issue + DEE-612 doctrine).
- **DEE-612 / DEE-613** are doctrine/product-governance inputs — future compatibility constraints only; not permission to invent solidarity/access workflows inside DEE-606.
- Core ownership canon: [`docs/waia-core/WAIA-CORE-ARCHITECTURE.md`](../waia-core/WAIA-CORE-ARCHITECTURE.md), ADR-0007, ADR-0014, ADR-0015.
- Risk: **T3** per [`docs/waia-governance/RISK-TIERS.md`](../waia-governance/RISK-TIERS.md) — auth permissions, admin mutation orchestration, Postgres persistence, watcher orchestration, financial state transitions, public financial publication. Requires Architect review + Human architecture approval. **T3/T4: no auto-merge**; Human merge authority is not weakened.
- Physical isolation from active DEE-518 A3-P01-R5 measurement is load-bearing for the entire batch.

## Isolation evidence (plan-time preflight)

| Surface | Value |
|--------|--------|
| DEE-606 worktree | `/Users/legco/Projects/waia-dee-606-breath-treasury` |
| Branch | `dee-606-breath-of-waia-transparent-treasury-ledger-watcher-ingestion` |
| Baseline `origin/main` | `d954bbed4c1a893a1b7120b1c04fa9ca485453ff` |
| Starting HEAD | `d954bbed4c1a893a1b7120b1c04fa9ca485453ff` (= `origin/main`) |
| First plan commit | `a95b9c1c27b9d98df66cfb944c292dd1967e5f5e` |
| DEE-518 worktree | `/Users/legco/Projects/waia` on `dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1` — **NO-TOUCH** |
| R5 screen / lock | `dee518-a3-p01-r5` / `/tmp/dee518-a3-phase.lock` — **NO-TOUCH** |
| R5 Postgres | container `waia-postgres-validate-1`, host port `127.0.0.1:54329` — **NO-TOUCH** |
| Main Postgres migration tip | `0109_trader_knowledge_confidence_update_record_rls` (journal idx 109) |
| DEE-518 reserved migrations | committed on branch through `0145_…`; **uncommitted** `0146_…`, `0147_…` in DEE-518 worktree |

## Goal

Deliver Core-owned treasury/transparency infrastructure that:

1. Observes designated treasury wallet movements (initially USDT TRC-20) as **facts**, not meaning.
2. Holds a human-governed semantic ledger with review → classify → verify lifecycle, orthogonal to detail publication.
3. Maintains a canonical VERIFIED accounting cash balance with commitment facts and on-chain reconciliation control.
4. Supports budgets, funding needs, evidence references, contribution attribution, and audit.
5. Publishes a truthful server-side read model into the existing Breath public contract (aggregates from accounting truth; row details only when DETAIL_PUBLIC).
6. Freezes backend mutation contracts so DEE-607 does not invent finance semantics.
7. Makes DEE-611’s contribution-map claims **true in data** without implementing DEE-611 copy.

---

## 1. Domain ownership decision (FROZEN)

### Decision: **Option A — new Core-owned Treasury / Transparency domain**

Breath/Treasury is a **new Core-owned domain** under `lib/waia-core/treasury/**` with its own tables, services, and observation surface. It **consumes or optionally references** Core identity / tenancy / audit / (rarely) payment observations. It does **not** encode treasury business meaning inside `payment_events` / `payments`.

### Rejected alternatives

| Option | Why rejected |
|--------|--------------|
| **B — additive semantic layer directly over Core `payments`** | Core `payments` are org-scoped **module billing** deposits with required `subjectModule ∈ {trader,twin,marketplace}`. Primary consumer is AI-Trader settlement (`subjectModule=trader`). Lifecycle is DETECTED/CONFIRMED/FAILED — no classification/publication. Outbound treasury spends are out of scope for the current billing watcher. Conflating public treasury with billing deposits violates Core/module ownership and would poison trader settlement filters. |
| **C — other** | No superior option found that preserves Core ownership without inventing a parallel identity/payment stack. |

### Ownership invariants (FROZEN)

| Concern | Owner |
|---------|-------|
| users / profiles / platform roles | Core identity |
| organizations / membership | Core tenancy |
| payer identity + `payments` / `payment_addresses` / payment watcher | Core payments (billing rail) — unchanged |
| `audit_logs` | Core shared audit stream |
| treasury observations, semantic ledger, commitments, budgets, funding needs, evidence refs, contribution attribution, Breath publication | **Core Treasury / Transparency (new)** |
| AI-Trader HWM / invoices / settlements / reporting | AI-Trader — **never reused** |

### Do not

- Duplicate user/payment identity tables.
- Repurpose `trader_*` billing/HWM/invoice/settlement tables.
- Treat detail publication as accounting authority.
- Give the treasury watcher trading/capital/custody authority.

---

## 2. Current Core payment / watcher reuse analysis

### What exists today (facts)

| Component | Behavior |
|-----------|----------|
| `payment_events` / `payments` | Org-scoped append-only billing ledger; money stored as **text**; soft-bound via `subjectModule` |
| Payment watcher | **Inbound-only** USDT TRC-20 Transfer → registered `payment_addresses`; detect → confirm → orphan-fail |
| Checkpoint | Single row PK `network` (`TRC-20`) — one cursor/lease for the billing watcher |
| `WATCHER_ENABLED` | Gates the **entire** Core payment watcher cycle |
| Idempotency | `TRC-20:{txHash}:{transferIndex}` + unique keys |
| `evidenceRef` | `watcher://…` string — **not** document blob storage |
| ADR-0014 | Read-only observer; host-agnostic cycle; no keys/signing |

### Reuse recommendation (FROZEN)

1. **Do not ingest treasury movements into `payment_events` / `payments`.**
2. **Do reuse** observation library patterns: Tron scan adapter shape, confirmation depth doctrine (ADR-0015), lease/checkpoint idea, idempotency key shape, content-digest discipline, Worker cron hosting pattern.
3. **Add a separate treasury observation surface** with its own watched-address registry, checkpoint key (`TRC-20:treasury`), and `TREASURY_WATCHER_ENABLED` (default **false**; ships DARK).
4. Optional soft `related_payment_id` only when an operator later proves coincidence with a Core billing payment.
5. Manual entries are first-class with provenance `MANUAL`.

---

## 3. Three-concept separation (FROZEN)

| Layer | Meaning | Mutability | Public by default |
|-------|---------|------------|-------------------|
| **1. Observation** | What objectively occurred on-chain or was entered as a source fact | Observation facts immutable after write | No |
| **2. Accounting / business meaning** | Classification + VERIFIED accounting membership | Append-only revisions; FSM to VERIFIED | Aggregates may publish without row detail |
| **3. Detail publication** | Whether transaction-level details are disclosed | Orthogonal `detail_publication` state | Only `DETAIL_PUBLIC` rows |

Invariant: **a blockchain transfer is never self-explanatory.** Watcher observation never implies accounting verification or detail publication.

---

## 4. Orthogonal state machines (FROZEN)

### 4.1 Accounting / review status (`treasury_tx_status`)

| State | Meaning |
|-------|---------|
| `DETECTED` | Created by watcher; unpublished; not accounting truth |
| `MANUAL_DRAFT` | Admin draft; not accounting truth |
| `NEEDS_REVIEW` | Queued for human semantic work |
| `CLASSIFIED` | Required semantic fields present; awaiting verification |
| `VERIFIED` | Human-verified accounting fact; **enters canonical accounting** |
| `RECONCILIATION_REQUIRED` | Material ambiguity; blocks silent aggregate use when unresolved set is material |
| `REJECTED` | Terminal; excluded from accounting |
| `DUPLICATE` | Terminal; points at surviving transaction; excluded |

**There is no `PUBLISHED` accounting status.** Detail disclosure is separate (§4.2).

### Allowed accounting transitions

```
DETECTED              → NEEDS_REVIEW | DUPLICATE | RECONCILIATION_REQUIRED | REJECTED
MANUAL_DRAFT          → NEEDS_REVIEW | REJECTED
NEEDS_REVIEW          → CLASSIFIED | REJECTED | DUPLICATE | RECONCILIATION_REQUIRED
CLASSIFIED            → VERIFIED | NEEDS_REVIEW | REJECTED | RECONCILIATION_REQUIRED
VERIFIED              → RECONCILIATION_REQUIRED
RECONCILIATION_REQUIRED → NEEDS_REVIEW | REJECTED | DUPLICATE | VERIFIED
REJECTED              → (terminal)
DUPLICATE             → (terminal)
```

`VERIFIED → RECONCILIATION_REQUIRED` opens correction/reopen path; return to `VERIFIED` only after ambiguity is resolved with audit.

### Authority

| Transition | Authority |
|------------|-----------|
| Watcher create `DETECTED` | `service` + `TREASURY_WATCHER_ENABLED` path |
| Watcher may propose reconciliation / duplicate candidates | service proposes; human confirms |
| Manual draft / classify / reject / confirm duplicate | `admin.treasury.mutate` |
| → `VERIFIED` | `admin.treasury.mutate` **plus** watcher confirmation precondition when `provenance=WATCHER` (§7) |
| Detail publication changes (`PRIVATE` ↔ `DETAIL_PUBLIC`) | `admin.treasury.publish` |
| Enable Breath aggregates (`breath_enabled`) | `admin.treasury.publish` |
| Public read | unauthenticated read of Breath projection only |

### 4.2 Detail publication state (`treasury_detail_publication`)

| State | Meaning |
|-------|---------|
| `PRIVATE` | Default. Row details not listed in public `recentActivity`; identity/counterparty/notes/evidence/tx hash not exposed. **Still participates in aggregates if accounting status = VERIFIED.** |
| `DETAIL_PUBLIC` | Explicitly approved for public row disclosure (label, amount, time, optional provenance URL per policy). |
| `SUPERSEDED` | Prior detail disclosure replaced by a correcting DETAIL_PUBLIC narrative; history retained. |

Detail publication does **not** gate:

- accounting cash balance
- contribution numerator/denominator
- Breath aggregate fields (`entered`, `spent`, `currentFreeFunds`, budget funded/spent, etc.)

Detail publication **does** gate:

- inclusion in `recentActivity`
- public exposure of identity, counterparty, internal notes, evidence, tx hash, explorer URL

### Immutable facts

Watcher-origin immutable after write: network, token/contract, tx hash, transfer ordinal, from/to, native atomic amount + decimals, observed timestamps, block identity, ingestion source, observation idempotency key.

After leaving `MANUAL_DRAFT`: `id`, `created_at`, provenance kind.

### Revisable via append-only revisions (while not under terminal REJECTED/DUPLICATE)

Semantic fields: purpose, category, kind, fund_bucket_code, counterparty display, project/module, milestone/stage, budget_id, funding_need_id, description, internal notes, public description, attribution proposals, nominal USD micros (under policy), detail-publication eligibility flags.

### Correction of verified mistakes (append-only)

1. Do not delete or rewrite immutable facts.
2. Move affected row to `RECONCILIATION_REQUIRED` (audit + reason).
3. Create linked `CORRECTION` / `REFUND` / `BALANCE_ADJUSTMENT` transaction with `corrects_transaction_id`.
4. Correction follows classify → verify path.
5. If original was `DETAIL_PUBLIC`, set it `SUPERSEDED` when a correcting detail row is made `DETAIL_PUBLIC`.
6. Aggregates recompute from VERIFIED set only.

### Fail-closed material reconciliation (FROZEN)

Define `material_unresolved_reconciliation = true` when any `RECONCILIATION_REQUIRED` transaction (or open balance-reconciliation case — §5.15) has non-zero potential cash effect on Breath aggregates.

If `material_unresolved_reconciliation`:

- Breath `status` must be `"pending"` (financial aggregates unavailable)
- do **not** publish knowingly unreliable totals
- contribution share engine may still compute admin-only views, but public Breath remains pending

---

## 5. Exact data model / data dictionary (proposed)

### Conventions

- Prefix: `treasury_*`.
- Tenancy: every row carries `organization_id` → dedicated **WAIA Platform Treasury** Core organization (HD-1).
- Money (FROZEN):
  - Native: `native_amount_atomic BIGINT` + `native_decimals SMALLINT` + `native_asset TEXT` + `native_contract TEXT NULL`
  - Accounting denomination micros: `accounting_amount_micros BIGINT` + `accounting_denomination_policy TEXT` (v1: `USDT_NOMINAL_USD_POLICY_V1`)
  - **Never** float/`real`/JS number as authority
- Digests: sha256 hex of canonical JSON where integrity required.

### 5.1 Enums

| Enum | Values |
|------|--------|
| `treasury_tx_status` | `DETECTED`, `MANUAL_DRAFT`, `NEEDS_REVIEW`, `CLASSIFIED`, `VERIFIED`, `RECONCILIATION_REQUIRED`, `REJECTED`, `DUPLICATE` |
| `treasury_detail_publication` | `PRIVATE`, `DETAIL_PUBLIC`, `SUPERSEDED` |
| `treasury_tx_direction` | `INFLOW`, `OUTFLOW`, `INTERNAL` |
| `treasury_tx_kind` | `OPENING_BALANCE`, `CONTRIBUTION`, `EXPENSE`, `EXTERNAL_INFLOW`, `EXTERNAL_OUTFLOW`, `INTERNAL_TRANSFER`, `REFUND`, `CORRECTION`, `BALANCE_ADJUSTMENT` |
| `treasury_provenance` | `WATCHER`, `MANUAL` |
| `treasury_budget_status` | `DRAFT`, `ACTIVE`, `SUPERSEDED`, `ARCHIVED` |
| `treasury_funding_need_status` | `OPEN`, `PARTIALLY_FUNDED`, `FUNDED`, `CLOSED`, `CANCELLED` |
| `treasury_commitment_status` | `DRAFT`, `APPROVED`, `RELEASED`, `FULFILLED`, `CANCELLED` |
| `treasury_evidence_kind` | `RECEIPT`, `INVOICE`, `CONFIRMATION`, `SCREENSHOT`, `DOCUMENT`, `CHAIN_PROVENANCE` |
| `treasury_evidence_visibility` | `ADMIN_ONLY`, `PUBLIC` |
| `treasury_attribution_status` | `UNMATCHED`, `ATTRIBUTED`, `ANONYMOUS`, `REVOKED` |
| `treasury_address_direction_scope` | `INBOUND`, `OUTBOUND`, `BOTH` |
| `treasury_balance_recon_status` | `MATCHED`, `PENDING_CONFIRMATIONS`, `MISMATCH`, `UNAVAILABLE` |

### 5.1b Fund buckets — extensible registry (FROZEN; no premature DEE-612/613 values)

**Do not** hard-code `SPONSORED_ACCESS` / `SOLIDARITY` enums in DEE-606.

Use table `treasury_fund_buckets`:

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `code` | text PK | NO | stable code |
| `organization_id` | uuid FK | NO | |
| `title` | text | NO | |
| `is_active` | boolean | NO | |
| `created_at` | timestamptz | NO | |

**Seeded v1 rows only:** `OPERATING`, `RESERVE`, `UNASSIGNED`.

Future solidarity/access buckets may be inserted later after DEE-612/613 Human approval — schema remains compatible without canonizing unapproved doctrine now. DEE-606 does **not** implement solidarity workflows.

### 5.2 `treasury_watched_addresses`

| Field | Type | Null | Meaning | Mutability | Public |
|-------|------|------|---------|------------|--------|
| `id` | uuid PK | NO | | immutable | NO |
| `organization_id` | uuid FK | NO | | immutable | NO |
| `network` | text | NO | e.g. `TRC-20` | immutable | NO |
| `address` | text | NO | | immutable | NO |
| `token_contract` | text | NO | | immutable | NO |
| `asset_code` | text | NO | `USDT` | immutable | NO |
| `direction_scope` | enum | NO | | admin-updatable | NO |
| `include_in_balance_recon` | boolean | NO | default true | admin-updatable | NO |
| `label` | text | NO | | admin-updatable | NO |
| `is_active` | boolean | NO | | admin-updatable | NO |
| `created_at` / `updated_at` | timestamptz | NO | | system | NO |

**Constraints:** unique `(network, address, token_contract)`.

### 5.3 `treasury_watcher_checkpoints`

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `checkpoint_key` | text PK | NO | e.g. `TRC-20:treasury` — **not** bare `TRC-20` |
| `last_scanned_block` | text | NO | |
| `last_scanned_at` | timestamptz | NO | |
| `lease_until` | timestamptz | YES | |
| `last_error` / `last_error_at` | text/timestamptz | YES | |
| `cycle_count` | int | NO | default 0 |
| `created_at` / `updated_at` | timestamptz | NO | |

### 5.4 `treasury_chain_observations`

| Field | Type | Null | Meaning | Mutability |
|-------|------|------|---------|------------|
| `id` | uuid PK | NO | | immutable |
| `organization_id` | uuid FK | NO | | immutable |
| `watched_address_id` | uuid FK | NO | | immutable |
| `network` / `token_contract` / `asset_code` | text | NO | | immutable |
| `tx_hash` | text | NO | | immutable |
| `transfer_index` | int | NO | | immutable |
| `from_address` / `to_address` | text | NO | | immutable |
| `direction` | enum | NO | relative to watched address | immutable |
| `native_amount_atomic` / `native_decimals` | bigint/smallint | NO | | immutable |
| `block_height` | text | NO | | immutable |
| `block_timestamp` | timestamptz | YES | | immutable |
| `observed_at` | timestamptz | NO | | immutable |
| `confirmations_observed` | int | NO | | watcher until terminal |
| `confirmations_required` | int | NO | | immutable per policy |
| `observation_status` | text | NO | `OBSERVED` \| `CONFIRMED` \| `DROPPED` | watcher FSM |
| `idempotency_key` | text | NO | | immutable |
| `ingestion_source` | text | NO | | immutable |
| `raw_event_digest` | text | NO | | immutable |
| `related_payment_id` | uuid | YES | | admin later |
| `created_at` | timestamptz | NO | | immutable |

**Constraints:** unique `idempotency_key`; unique `(network, tx_hash, transfer_index, watched_address_id)`.

### 5.5 `treasury_transactions`

| Field | Type | Null | Meaning | Mutability | Public detail |
|-------|------|------|---------|------------|---------------|
| `id` | uuid PK | NO | | immutable | only if DETAIL_PUBLIC |
| `organization_id` | uuid FK | NO | | immutable | NO |
| `status` | `treasury_tx_status` | NO | accounting FSM | FSM | NO |
| `detail_publication` | enum | NO | default `PRIVATE` | publish authority | YES state |
| `provenance` | enum | NO | | immutable | limited |
| `observation_id` | uuid FK | YES | required if WATCHER | immutable | NO |
| `direction` | enum | NO | | immutable after NEEDS_REVIEW | if DETAIL_PUBLIC |
| `kind` | enum | YES | null until classified | revision | if DETAIL_PUBLIC |
| `fund_bucket_code` | text FK→fund_buckets.code | NO | default `UNASSIGNED` | revision | NO unless policy |
| `native_*` | money fields | NO | | immutable after leave draft | amount if DETAIL_PUBLIC |
| `accounting_amount_micros` | bigint | YES | required before VERIFIED | revision until VERIFIED; then correction only | amount if DETAIL_PUBLIC |
| `accounting_denomination_policy` | text | YES | e.g. `USDT_NOMINAL_USD_POLICY_V1` | same | NO |
| `cash_effect_micros` | bigint | YES | signed effect on consolidated treasury cash; set at classify/verify per §9 | system from kind rules | NO |
| `counterparty_is_internal` | boolean | NO | true when other side is managed treasury address | classify | NO |
| `paired_internal_transfer_id` | uuid | YES | links two legs / single INTERNAL_TRANSFER record | classify | NO |
| `occurred_at` | timestamptz | NO | | create; correction via link | if DETAIL_PUBLIC |
| `purpose` / `category` | text | YES | | revision | if DETAIL_PUBLIC |
| `counterparty_display` | text | YES | | revision | only if DETAIL_PUBLIC **and** `publish_counterparty` |
| `publish_counterparty` | boolean | NO | default false | revision | gate |
| `project_module` / `milestone_stage` | text | YES | | revision | if DETAIL_PUBLIC |
| `budget_id` / `funding_need_id` | uuid | YES | | revision | NO |
| `description` / `internal_notes` | text | YES | | revision | NO |
| `public_description` | text | YES | Breath row label | revision | if DETAIL_PUBLIC |
| `tx_hash` | text | YES | denorm | immutable if watcher | only if DETAIL_PUBLIC + policy |
| `corrects_transaction_id` | uuid | YES | | immutable once set | if DETAIL_PUBLIC |
| `duplicate_of_transaction_id` | uuid | YES | | on DUPLICATE | NO |
| `detail_superseded_by_id` | uuid | YES | | detail workflow | NO |
| `verified_at` / `verified_by_user_id` | timestamptz/uuid | YES | | on VERIFIED | NO |
| `detail_published_at` / `detail_published_by_user_id` | timestamptz/uuid | YES | | on DETAIL_PUBLIC | NO |
| `latest_revision_id` | uuid | YES | | system | NO |
| `record_content_digest` | text | NO | | system | NO |
| `created_by_user_id` | uuid | YES | | immutable | NO |
| `created_at` / `updated_at` | timestamptz | NO | | system | NO |

**Indexes:** `(organization_id, status)`; `(organization_id, detail_publication)`; `(organization_id, occurred_at desc)`; `(budget_id)`; `(kind, status)`; unique `(observation_id)` where not null.

### 5.6 `treasury_transaction_revisions`

Append-only semantic history: `id`, `transaction_id`, `organization_id`, `seq`, `patch_json`, `actor_user_id`, `actor_type`, `reason`, digests, `created_at`. Unique `(transaction_id, seq)`; no UPDATE/DELETE.

### 5.7 `treasury_budgets`

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `code` / `title` | text | NO | |
| `period_start` / `period_end` | date | NO | |
| `currency` | text | NO | `USD` for v1 public |
| `planned_amount_micros` | bigint | NO | planned authority |
| `status` | enum | NO | |
| `is_public` | boolean | NO | include in Breath budget block |
| `notes` | text | YES | admin |
| `created_at` / `updated_at` | timestamptz | NO | |

**Derived (not stored authority):** `funded`, `committed`, `spent`, `remaining` from §9. **No admin-maintained aggregate committed scalar.**

### 5.8 `treasury_ideal_annual_budgets`

Unchanged intent: explicit Human/admin versioned object; never inferred from donations. Fields: `id`, `organization_id`, `period_year`, `currency`, `amount_micros`, `effective_from`/`to`, `status` (`DRAFT`/`ACTIVE`/`SUPERSEDED`), `publication_state` (`PRIVATE`/`PUBLIC`), actors, `created_at`. At most one `ACTIVE`+`PUBLIC` per `(organization_id, period_year)`.

### 5.9 `treasury_funding_needs`

As before: required amount + status + public explanation; funded amount **derived** from VERIFIED contributions assigned to the need (not from detail publication).

### 5.10 Evidence objects + links

Reference contract unchanged: storage backend + object key + media type + byte size + sha256 + kind + visibility default `ADMIN_ONLY`. No large binary in financial rows. Breath never lists admin-only evidence.

**HD-3 storage backend:** repository inspection (`wrangler.jsonc`, `.env.example`, Core docs) finds **no approved existing durable object-storage binding** (no R2 bucket binding, no Supabase Storage config). Technical preference if adopting one: **Cloudflare R2** (same Workers/OpenNext production plane). Escalate to Human because adopting a new production storage service is required — not an arbitrary executor menu between equally approved backends.

### 5.11 `treasury_contribution_attributions`

Unchanged structure; share math uses VERIFIED set only (§6), independent of `detail_publication`.

### 5.12 `treasury_publication_settings`

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `organization_id` | uuid PK | NO | |
| `breath_enabled` | boolean | NO | master fail-closed; default false |
| `stage_label` | text | YES | |
| `work_summary` | text | YES | |
| `methodology_note` | text | NO | |
| `recent_activity_limit` | int | NO | default 5 |
| `updated_by_user_id` | uuid | YES | |
| `updated_at` | timestamptz | NO | |

### 5.13 Runway plans + runway snapshots

`treasury_runway_plans`: approved planned daily burn (`APPROVED_PLANNED_BURN`), `daily_burn_micros`, status `DRAFT`/`ACTIVE`/`SUPERSEDED`.

`treasury_runway_snapshots` (deterministic endsAt authority):

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `runway_plan_id` | uuid FK | NO | |
| `runway_as_of` | timestamptz | NO | frozen anchor |
| `free_funds_at_as_of_micros` | bigint | NO | `currentFreeFunds` at as-of |
| `approved_daily_burn_micros` | bigint | NO | copied from plan |
| `ends_at` | timestamptz | NO | computed once at snapshot creation |
| `input_digest` | text | NO | digest of accounting inputs + plan id + burn |
| `created_at` | timestamptz | NO | |

**Rule:** a new snapshot is created only when authoritative inputs change (VERIFIED cash/commitment set, ACTIVE burn plan, or explicit admin refresh under publish authority). Repeated reads return the latest snapshot’s `ends_at` unchanged.

### 5.14 `treasury_commitments` (FROZEN; replaces manual committed scalar)

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `budget_id` | uuid FK | YES | required when budget-scoped |
| `amount_micros` | bigint | NO | |
| `currency` | text | NO | `USD` |
| `purpose` | text | NO | |
| `counterparty_display` | text | YES | |
| `publish_counterparty` | boolean | NO | default false |
| `detail_publication` | enum | NO | default `PRIVATE` |
| `expected_at` | date | YES | |
| `effective_from` | timestamptz | NO | |
| `status` | `treasury_commitment_status` | NO | |
| `evidence_object_id` | uuid | YES | optional |
| `created_by_user_id` | uuid | NO | |
| `approved_by_user_id` / `approved_at` | uuid/timestamptz | YES | |
| `released_by_user_id` / `released_at` | uuid/timestamptz | YES | |
| `fulfilled_by_user_id` / `fulfilled_at` | uuid/timestamptz | YES | |
| `cancelled_by_user_id` / `cancelled_at` | uuid/timestamptz | YES | |
| `fulfilills_transaction_id` | uuid | YES | expense/outflow that fulfills |
| `record_content_digest` | text | NO | |
| `created_at` / `updated_at` | timestamptz | NO | |

#### Commitment lifecycle (FROZEN)

```
DRAFT → APPROVED → RELEASED → FULFILLED
                 ↘ CANCELLED
APPROVED → CANCELLED
RELEASED → CANCELLED   # only with audit reason; rare
```

| Status | Counts toward `activeCommittedFunds`? |
|--------|----------------------------------------|
| `DRAFT` | NO |
| `APPROVED` | YES |
| `RELEASED` | YES (still reserved until fulfilled/cancelled) |
| `FULFILLED` | NO (cash effect already in VERIFIED expenses) |
| `CANCELLED` | NO |

Human/admin may CREATE / APPROVE / RELEASE / FULFILL / CANCEL. **Aggregate `committed` is always derived** — never a manually maintained scalar.

Append-only `treasury_commitment_revisions` mirrors transaction revisions.

### 5.15 `treasury_balance_reconciliations`

Independent control — **not** accounting SoT.

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `as_of_block` | text | NO | chain block height for balance read |
| `as_of_time` | timestamptz | NO | |
| `observed_onchain_balance_atomic` | bigint | NO | sum of USDT balances for `include_in_balance_recon=true` active addresses |
| `accounting_cash_balance_micros` | bigint | NO | derived §9 at as-of |
| `delta_micros` | bigint | NO | observed_nominal_micros − accounting |
| `status` | enum | NO | |
| `tolerance_micros` | bigint | NO | v1: `0` for USDT nominal |
| `evidence_object_id` | uuid | YES | optional screenshot/export |
| `notes` | text | YES | admin |
| `created_by` | text | NO | `service`/`admin` |
| `created_at` | timestamptz | NO | |

**v1 rules:**

- Participating addresses: active watched addresses with `include_in_balance_recon=true`, same network/token.
- Pending/unconfirmed watcher observations (`OBSERVED`, not `CONFIRMED`) are **excluded** from accounting and treated as expected temporary delta under `PENDING_CONFIRMATIONS` if they explain the gap.
- Internal transfers are cash-neutral in accounting and net-zero on consolidated on-chain sum.
- Tolerance: **0 micros** under `USDT_NOMINAL_USD_POLICY_V1`.
- Material unexplained `MISMATCH` ⇒ open material reconciliation ⇒ Breath fail-closed pending.
- No custody/signing authority.

---

## 6. Contribution-attribution / share contract (FROZEN)

### Qualifying set `Q`

All must hold:

1. `kind = CONTRIBUTION`
2. `direction = INFLOW`
3. `status = VERIFIED` (not detail publication)
4. not REJECTED/DUPLICATE; not under material exclusion via open reconciliation that invalidates the row
5. asset in approved set (v1: USDT TRC-20)
6. `accounting_amount_micros IS NOT NULL`
7. `accounting_denomination_policy = USDT_NOMINAL_USD_POLICY_V1`

Refunds/corrections linked via `corrects_transaction_id`, themselves `VERIFIED`, adjust net micros.

### Share

```
numerator(user) = Σ net_micros(c) for c in Q with open ATTRIBUTED attribution to user
denominator     = Σ net_micros(c) for all c in Q   # includes UNMATCHED + ANONYMOUS
share(user)     = numerator / denominator if denominator > 0 else 0
```

Expenses / ordinary outflows / commitments **never** dilute historical share.

### Denomination policy (not market valuation)

`USDT_NOMINAL_USD_POLICY_V1`: for USDT with 6 decimals, `accounting_amount_micros = native_amount_atomic` (nominal 1 USDT ↔ 1 accounting USD unit).

This is a **nominal accounting convention for v1**, **not** a real-time market-price assertion. Future non-USDT assets require an approved valuation policy before entering `Q`.

### Privacy (HD-2 default)

Public surface: aggregate-only; no public identity list; optional authenticated self-only share. Opt-in public identities schema-ready but not published until later Human decision.

---

## 7. Watcher contract + VERIFIED precondition (FROZEN)

### Scope v1

USDT TRC-20; inbound and outbound vs active watched addresses; `TREASURY_WATCHER_ENABLED` default **false** (DARK).

### Idempotency

```
idempotency_key = `${network}:${txHash}:${transferIndex}:${watchedAddressId}`
```

### Observation FSM

1. confirmations ≥ 1 → observation `OBSERVED`; transaction `DETECTED` → `NEEDS_REVIEW`
2. confirmations ≥ required (default 20) → observation `CONFIRMED`
3. disappeared after age-out → `DROPPED` + transaction `RECONCILIATION_REQUIRED`

### Binding VERIFIED precondition (WATCHER)

For `provenance = WATCHER`, transition to `VERIFIED` is **rejected** unless:

```
observation_status = CONFIRMED
AND confirmations_observed >= confirmations_required
```

Human may **classify** an `OBSERVED` transaction before final confirmation, but must **not** VERIFY it.

Until VERIFIED:

- excluded from accounting cash
- excluded from contribution numerator/denominator
- excluded from public financial aggregates

### Required tests

- classify-before-confirm allowed; verify-before-confirm rejected
- after CONFIRMED, verify allowed
- OBSERVED amounts absent from aggregates and contribution share
- idempotent replay; DROPPED opens reconciliation

Watcher never publishes details, never sets kind/budget/attribution, never signs/broadcasts.

---

## 8. Evidence contract (FROZEN)

Reference + metadata + sha256 only. Default `ADMIN_ONLY`. `PUBLIC` evidence requires explicit set **and** does not imply DETAIL_PUBLIC transaction disclosure unless separately approved. Every upload/link/unlink audits.

---

## 9. Canonical accounting + Breath formulas (FROZEN)

### 9.1 Signed cash-effect semantics (per VERIFIED row)

Let `A = accounting_amount_micros` (always ≥ 0 magnitude).

| Kind | Direction / flags | `cash_effect_micros` |
|------|-------------------|----------------------|
| `OPENING_BALANCE` | — | `+A` (exactly one active opening per org+asset set; evidence required) |
| `CONTRIBUTION` | INFLOW | `+A` |
| `EXTERNAL_INFLOW` | INFLOW | `+A` |
| `EXPENSE` | OUTFLOW | `−A` |
| `EXTERNAL_OUTFLOW` | OUTFLOW | `−A` |
| `REFUND` | INFLOW (refund received) | `+A` |
| `REFUND` | OUTFLOW (refund paid) | `−A` |
| `CORRECTION` / `BALANCE_ADJUSTMENT` | signed explicitly at classify | admin-set signed micros; evidence required; audits |
| `INTERNAL_TRANSFER` | between managed treasury addresses | `0` consolidated |

No hidden mutable scalar balance. `OPENING_BALANCE` and `BALANCE_ADJUSTMENT` are first-class auditable ledger rows.

### 9.2 Derived balances

```
V = { transactions | status = VERIFIED }

accountingCashBalance_micros =
  Σ cash_effect_micros(t) for t in V

activeCommittedFunds_micros =
  Σ amount_micros(c) for commitments c
    where status ∈ {APPROVED, RELEASED}

currentFreeFunds_micros =
  max(0, accountingCashBalance_micros − activeCommittedFunds_micros)
```

`currentFreeFunds` is **not** derived from DETAIL_PUBLIC rows only.

### 9.3 Breath field formulas

Breath publishes only when:

- `breath_enabled = true`
- ideal annual budget ACTIVE+PUBLIC present
- **no** material unresolved reconciliation (§4 fail-closed)
- latest balance reconciliation is not unexplained `MISMATCH`

Else `status = "pending"` and numeric fields null/empty.

| Field | Rule |
|-------|------|
| `status` | `"published"` iff gates above hold; else `"pending"` |
| `lastUpdatedAt` | max verified_at / commitment updates / settings.updated_at when published |
| `stageLabel` | settings |
| `idealAnnualBudget` | ACTIVE+PUBLIC ideal |
| `resources.entered` | Σ A for VERIFIED `CONTRIBUTION` (+ inbound REFUND to contributions policy: count under contribution net, not double-count cash) — **operational display:** sum of VERIFIED contribution inflows’ accounting micros |
| `resources.spent` | Σ A for VERIFIED `EXPENSE` |
| `resources.allocated` | `activeCommittedFunds` (derived) |
| `resources.remaining` | `accountingCashBalance` (accounting cash, not free) |
| `resources.neededNext` | primary public funding need: required − derived funded; else null |
| `currentFreeFunds` | from §9.2 |
| `budget.planned` | active public budget planned |
| `budget.funded` | Σ VERIFIED contributions with `budget_id = active_budget` |
| `budget.committed` | Σ active commitments for that budget (`APPROVED`+`RELEASED`) |
| `budget.spent` | Σ VERIFIED expenses with that `budget_id` |
| `budget.remaining` | `planned − spent` (signed exact) |
| `budget.fillRatio` | `clamp(funded/planned,0,1)` if planned>0 else null |
| `runway.*` | from latest `treasury_runway_snapshots` if ACTIVE plan exists; else pending |
| `recentActivity` | only `detail_publication = DETAIL_PUBLIC` and `status = VERIFIED` (and not SUPERSEDED) |
| `work` / `methodologyNote` | settings |

### 9.4 Non-equivalences

| Concept | Definition |
|---------|------------|
| On-chain wallet balance | RPC sum — reconciliation control only |
| `accountingCashBalance` | Σ VERIFIED cash effects |
| `activeCommittedFunds` | derived from commitment facts |
| `currentFreeFunds` | accounting cash − active commitments |

---

## 10. Ideal annual budget (FROZEN)

Explicit versioned Human/admin object (§5.8). Gauge continues `currentFreeFunds / idealAnnualBudget`. No visual redesign.

---

## 11. Runway / countdown (FROZEN)

Invalid (removed): `endsAt = now + free/burn` (sliding).

**Deterministic snapshot:**

```
endsAt = runwayAsOf + (freeFundsAtAsOf_micros / approvedDailyBurn_micros) * 1 day
```

Stored on `treasury_runway_snapshots` at creation. Repeated reads with unchanged inputs return the same `endsAt`.

New snapshot when: VERIFIED cash set changes, active commitments change, ACTIVE burn plan changes, or explicit authorized refresh.

If no ACTIVE burn plan → runway pending.

### Required unit tests

- repeated reads → identical `endsAt`
- new VERIFIED inflow → new as-of may extend runway
- VERIFIED spend or new APPROVED commitment → may shorten runway
- no ACTIVE burn → pending

---

## 12. Admin mutation / audit contract (FROZEN)

### Permissions

| Permission | Use |
|------------|-----|
| `admin.treasury.read` | admin reads |
| `admin.treasury.mutate` | drafts, classify, verify (with preconditions), evidence, budgets, needs, attributions, commitments lifecycle, runway drafts, opening/adjustment entries |
| `admin.treasury.publish` | detail publication, Breath enable, activate PUBLIC ideal, activate runway plan, snapshot refresh |

Platform `admin` receives all three. Every sensitive mutation writes `audit_logs`.

### Backend contracts for DEE-607 (no UI here)

Transaction FSM; detail publication; commitments CRUD/lifecycle; budgets/needs/ideal/runway; evidence; attribution; balance reconciliation view; Breath preview using §9; correction workflow.

Public: `getBreathPublicSnapshot()` server-backed, fail-closed.

---

## 13. Migration + rollback + merge-order gate (FROZEN)

### Plan-time disposition

```
DEE_606_MIGRATION_IDENTITY_DEFERRED_TO_IMPLEMENTATION_PREFLIGHT
```

### Implementation preflight

1. Fetch `origin/main`; read journal tip.
2. Enumerate reserved tags from open migration-bearing PR branches + read-only awareness of DEE-518 `0110–0147`.
3. Allocate collision-free next identities; hand-author SQL + journal per `db/AGENTS.md`.
4. Prove monotonic journal order.
5. Apply **entire** `main + DEE-606` migration history on empty dedicated Postgres (port ≠ 54329).

### Merge-order gate (binding)

Filename collision avoidance alone is insufficient.

**A migration-bearing DEE-606 PR MUST NOT be Human-merged while its migration predecessor assumptions exist only on an unmerged DEE-518 branch.**

Before PR readiness / merge:

- reconcile actual merged journal on `origin/main`
- reconcile still-open migration-bearing branches
- rebase/renumber DEE-606 migrations if required
- prove empty-DB apply of resulting history

If DEE-518 migrations remain unmerged and DEE-606 would create later-numbered migrations that assume those predecessors:

```
DEE_606_MIGRATION_MERGE_BLOCKED_BY_UNMERGED_DEE_518_JOURNAL
```

Do **not** solve by touching DEE-518. Wait for main journal reality, then renumber.

### Rollback

Additive only; forward-fix; disable `breath_enabled` / keep `TREASURY_WATCHER_ENABLED=false`. No destructive DROP in integration PR.

---

## 14. RLS / security / isolation (FROZEN)

App-layer auth primary; targeted RLS deny `authenticated`/`anon` on all `treasury_*`; append-only triggers on observations/revisions; service role only; no browser secrets; publication fail-closed.

Release-blocking tests: cross-org denial; non-admin denial; public endpoint never returns internal notes/evidence/admin identities; aggregates include PRIVATE VERIFIED without leaking detail fields; material reconciliation forces pending.

---

## 15. R5-safe DB test topology (FROZEN)

Dedicated compose `docker-compose.postgres-treasury-validate.yml`; project `waia-postgres-treasury-validate`; port **54339**; never 54329; never stop `waia-postgres-validate-1`; no global Docker restart. Plan-time: do not run Postgres tests.

---

## 16. Work packages (dependency order)

### WP-0 — Human architecture approval gate (T3)

Human CONFIRM after Architect corrections → `state.status=approved`. No code.

### WP-1 — Migration preflight + schema

§13 allocation; tables/enums including commitments, fund bucket registry, runway snapshots, balance reconciliations; RLS. No watcher enablement.

### WP-2 — Domain services

FSM with orthogonal detail publication; VERIFIED watcher precondition; cash-effect engine; commitment lifecycle; contribution share; audit.

### WP-3 — Treasury watcher (DARK)

Watched addresses; checkpoint; inbound+outbound; idempotency; confirmation; never verify.

### WP-4 — Admin backend HTTP contracts

Permissions + mutation APIs for DEE-607; no UI.

### WP-5 — Evidence storage adapter

Implement only after HD-3 storage path approval; interface ready earlier.

### WP-6 — Breath read model + runway snapshots

§9 formulas; fail-closed reconciliation; as-of runway tests.

### WP-7 — Contribution share engine

VERIFIED-only; unmatched in denominator; expenses do not dilute; nominal policy tests.

### WP-8 — Isolation + R5-safe Postgres tests

Including verify-precondition, aggregate-vs-detail separation, commitment derivation, balance recon mismatch fail-closed.

### WP-9 — PR readiness

lint/typecheck/build; targeted tests; migration merge-order proof; prepare-pr later — not in plan phase.

---

## 17. Validation matrix

| Gate | Check | When |
|------|-------|------|
| Architect review + Human architecture approval | T3 gates | before implement |
| lint / typecheck / build | pnpm | PR readiness |
| Unit: FSM, verify precondition, cash equation, commitments, runway as-of, share, fail-closed recon | targeted | WP-2/6/7/8 |
| Postgres isolation on :54339 | dedicated compose | WP-8 |
| Empty-DB migration apply main+DEE-606 | §13 | PR readiness |
| Merge-order gate vs DEE-518 | §13 | before Human merge |
| E2E | DEE-607 owns admin e2e | — |
| Governance preflight | prepare-pr | later |

---

## 18. Acceptance criteria traceability (Linear DEE-606)

| Linear AC | Coverage |
|-----------|----------|
| Idempotent watcher ingest; unpublished details until approved; evidence; public row only after detail approval | §§4,7,8,9 |
| Manual provenance/audit | §§4,5,12 |
| Budget/funding totals reconcile from ledger + commitment facts | §§5.7,5.14,9 |
| Breath contract without privileged DB access | §9 WP-6 |
| Audit + isolation tests | §§14–15,17 |
| Domain ownership before migration | §1 |
| Schema + state machines | §§4–5 |
| Watcher idempotency + verify precondition | §7 |
| Contribution map data truth | §6 |
| Migration + merge-order safety | §13 |

---

## 19. Out of scope

- DEE-607 UI; DEE-611 copy; DEE-612/613 doctrine publication / solidarity workflows
- AI-TRADER execution/risk/research/capital/billing changes
- Homepage visual redesign
- Invented figures; equity/governance from contribution %
- Custody/signing/disbursement automation
- Multi-chain beyond USDT TRC-20
- Historical-burn runway
- Touching DEE-518 / R5 / 54329 / Execution Server / WF_ECONOMIC / BLIND_HOLDOUT
- Creating migrations or opening/merging PR during plan phase
- Enabling `TREASURY_WATCHER_ENABLED` in production without later Human ops gate

---

## 20. Human decisions (revised)

| ID | Decision | Frozen recommendation / disposition | Blocks |
|----|----------|--------------------------------------|--------|
| **HD-1** | Platform treasury tenant | **Architecture recommendation:** create/use a **dedicated Core organization** for **WAIA Platform Treasury** — do **not** silently reuse AI-Trader Org-0. Exact org creation/ID resolution is an implementation prerequisite unless later canon proves otherwise. | WP-1 seed |
| **HD-2** | Public contribution disclosure | **v1 default:** aggregate-only; no public identity list; authenticated self-only share optional | DEE-611 honesty |
| **HD-3** | Evidence object storage | **No approved existing durable object-storage path found** in repo (`wrangler`/env/Core docs). Technical preference if adopting: **Cloudflare R2**. **Escalate to Human** because a new production storage service must be approved. | WP-5 production uploads |
| **HD-4** | Initial ideal annual budget amount/year | Human data decision | Breath published status |
| **HD-5** | Initial ACTIVE runway daily burn | Default: **runway pending** until Human approves burn | runway fields |
| ~~HD-6~~ | ~~manual committed scalar~~ | **REMOVED.** Commitment facts + derived totals are mandatory. | — |
| **HD-7** | Production watcher enablement | **Architecture ships DARK:** `TREASURY_WATCHER_ENABLED=false`. Production enablement is a **later Human operational gate**, not required to approve this architecture plan. | ops after merge |

---

## Plan answers checklist

1. Domain ownership: **Core Treasury domain (A)** — §1  
2. Payment/watcher reuse: patterns yes; billing tables/checkpoint/flag no — §2  
3. Schema/dictionary: §5 (incl. commitments, snapshots, recon, fund registry)  
4. State machines: accounting FSM + detail publication — §4  
5. Contribution share: VERIFIED + nominal policy — §6  
6. Watcher + VERIFIED precondition — §7  
7. Evidence — §8  
8. Breath + accounting formulas — §9  
9. Ideal annual budget — §10  
10. Runway as-of — §11  
11. Admin/audit — §12  
12. Privacy/publication — §§4.2,6,9  
13. Migration + merge-order — §13  
14. RLS/security — §14  
15. R5-safe DB — §15  
16. Work packages — §16  
17. Validation — §17  
18. AC traceability — §18  
19. Out of scope — §19  
20. Human decisions — §20  

---

**Markers**

- Prior draft commit: `a95b9c1c27b9d98df66cfb944c292dd1967e5f5e`
- `state.status`: **draft** (Architect corrections complete; awaiting Human review)
- `DEE_606_CORRECTED_CANONICAL_PLAN_READY_FOR_SECOND_HUMAN_REVIEW`
