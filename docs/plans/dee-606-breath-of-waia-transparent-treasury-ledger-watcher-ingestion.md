---
integrationIssue: DEE-606
integrationTitle: "Breath of WAIA — transparent treasury ledger, watcher ingestion and evidence model"
branch: dee-606-breath-of-waia-transparent-treasury-ledger-watcher-ingestion
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, unit-targeted, postgres-isolation-r5-safe]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
deferredIssues: [DEE-607, DEE-611, DEE-612, DEE-613]
blockedByActiveWork:
  - id: DEE-518
    reason: "Unmerged Postgres migration reservation 0110–0147 (0146/0147 uncommitted in DEE-518 worktree). DEE-606 must not allocate migration identities until implementation preflight."
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
  nextAction: "Human Architect reviews and CONFIRM-approves this draft plan. Do not implement production schema/code until approved. Migration identity remains deferred (not frozen)."
  migrationIdentity:
    disposition: DEFERRED_TO_IMPLEMENTATION_PREFLIGHT
    frozenTag: null
    note: "Cannot safely freeze 0110+ while DEE-518 reserves 0110–0147. See §13."
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
- Physical isolation from active DEE-518 A3-P01-R5 measurement is load-bearing for the entire batch.

## Isolation evidence (plan-time preflight)

| Surface | Value |
|--------|--------|
| DEE-606 worktree | `/Users/legco/Projects/waia-dee-606-breath-treasury` |
| Branch | `dee-606-breath-of-waia-transparent-treasury-ledger-watcher-ingestion` |
| Baseline `origin/main` | `d954bbed4c1a893a1b7120b1c04fa9ca485453ff` |
| Starting HEAD | `d954bbed4c1a893a1b7120b1c04fa9ca485453ff` (= `origin/main`) |
| DEE-518 worktree | `/Users/legco/Projects/waia` on `dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1` — **NO-TOUCH** |
| R5 screen / lock | `dee518-a3-p01-r5` / `/tmp/dee518-a3-phase.lock` — **NO-TOUCH** |
| R5 Postgres | container `waia-postgres-validate-1`, host port `127.0.0.1:54329` — **NO-TOUCH** |
| Main Postgres migration tip | `0109_trader_knowledge_confidence_update_record_rls` (journal idx 109) |
| DEE-518 reserved migrations | committed on branch through `0145_…`; **uncommitted** `0146_…`, `0147_…` in DEE-518 worktree |

## Goal

Deliver Core-owned treasury/transparency infrastructure that:

1. Observes designated treasury wallet movements (initially USDT TRC-20) as **facts**, not meaning.
2. Holds a human-governed semantic ledger with review → classify → verify → publish lifecycle.
3. Supports budgets, funding needs, evidence references, contribution attribution, and audit.
4. Publishes a truthful server-side read model into the existing Breath public contract.
5. Freezes backend mutation contracts so DEE-607 does not invent finance semantics.
6. Makes DEE-611’s contribution-map claims **true in data** without implementing DEE-611 copy.

---

## 1. Domain ownership decision (FROZEN)

### Decision: **Option A — new Core-owned Treasury / Transparency domain**

Breath/Treasury is a **new Core-owned domain** under `lib/waia-core/treasury/**` with its own tables, services, and (where needed) observation surface. It **consumes or optionally references** Core identity / tenancy / audit / (rarely) payment observations. It does **not** encode treasury business meaning inside `payment_events` / `payments`.

### Rejected alternatives

| Option | Why rejected |
|--------|--------------|
| **B — additive semantic layer directly over Core `payments`** | Core `payments` are org-scoped **module billing** deposits with required `subjectModule ∈ {trader,twin,marketplace}`. Primary consumer is AI-Trader settlement (`subjectModule=trader`). Lifecycle is DETECTED/CONFIRMED/FAILED — no classification/publication. Outbound treasury spends are out of scope for the current watcher. Conflating public treasury with billing deposits violates Core/module ownership and would poison trader settlement filters. |
| **C — other** | No superior option found that preserves Core ownership without inventing a parallel identity/payment stack. |

### Ownership invariants (FROZEN)

| Concern | Owner |
|---------|-------|
| users / profiles / platform roles | Core identity |
| organizations / membership | Core tenancy |
| payer identity + `payments` / `payment_addresses` / payment watcher | Core payments (billing rail) — unchanged |
| `audit_logs` | Core shared audit stream |
| treasury observations, semantic ledger, budgets, funding needs, evidence refs, contribution attribution, Breath publication | **Core Treasury / Transparency (new)** |
| AI-Trader HWM / invoices / settlements / reporting | AI-Trader — **never reused** |

### Do not

- Duplicate user/payment identity tables.
- Repurpose `trader_*` billing/HWM/invoice/settlement tables.
- Auto-publish watcher observations.
- Give the treasury watcher trading/capital/custody authority.

---

## 2. Current Core payment / watcher reuse analysis

### What exists today (facts)

| Component | Behavior |
|-----------|----------|
| `payment_events` / `payments` | Org-scoped append-only billing ledger; money stored as **text**; soft-bound via `subjectModule` |
| Payment watcher | **Inbound-only** USDT TRC-20 Transfer → registered `payment_addresses`; detect → confirm → orphan-fail |
| Checkpoint | Single row PK `network` (`TRC-20`) — one cursor/lease for the billing watcher |
| `WATCHER_ENABLED` | Gates the **entire** Core payment watcher cycle (default false locally; `"1"` in wrangler) |
| Idempotency | `TRC-20:{txHash}:{transferIndex}` + unique `(org, idempotency_key)` + settlement attribution unique |
| `evidenceRef` | `watcher://TRC-20/{txHash}/{transferIndex}` string — **not** document blob storage |
| ADR-0014 | Read-only observer; host-agnostic `runWatcherCycle`; no keys/signing |

### Reuse recommendation (FROZEN)

1. **Do not ingest treasury movements into `payment_events` / `payments`.**
2. **Do reuse** observation library patterns: Tron scan adapter shape, confirmation depth doctrine (ADR-0015), lease/checkpoint idea, idempotency key shape, content-digest discipline, Worker cron hosting pattern.
3. **Add a separate treasury observation surface** with:
   - its own watched-address registry (treasury purpose),
   - its own checkpoint identity (must not share `payment_watcher_checkpoints` PK `TRC-20`),
   - its own enable flag `TREASURY_WATCHER_ENABLED` (independent of `WATCHER_ENABLED`),
   - inbound **and** outbound Transfer matching for designated treasury addresses.
4. **Optional soft reference**: a treasury observation may store `related_payment_id` only when an operator later proves coincidence with a Core billing payment; never required for treasury truth.
5. **Manual entries** are first-class with provenance `manual` and do not require chain observation.

### Why a separate watcher surface is required

- Billing watcher is inbound-only and address-bound to module subjects.
- Shared network checkpoint would couple billing scan progress to treasury address sets.
- Single `WATCHER_ENABLED` cannot independently gate domains.
- Treasury requires review/classification/publication states absent from payment FSM.
- Treasury requires document evidence, budgets, contribution attribution, and public Breath formulas.

---

## 3. Three-concept separation (FROZEN)

| Layer | Meaning | Mutability | Public by default |
|-------|---------|------------|-------------------|
| **1. Observation** | What objectively occurred on-chain or was manually entered as a source fact | Observation facts immutable after write | No |
| **2. Treasury / business meaning** | Classification: contribution/expense/transfer/refund/correction; budget; module; purpose; notes | Revised only via append-only revision / correction workflow before/around publication rules below | No (until publish) |
| **3. Publication** | Human-approved subset exposed to Breath | Fail-closed; explicit publish transition | Yes (approved fields only) |

Invariant: **a blockchain transfer is never self-explanatory.** Watcher observation never implies public meaning.

---

## 4. Transaction lifecycle state machine (FROZEN)

### States

| State | Meaning |
|-------|---------|
| `DETECTED` | Created by watcher from a confirmed-enough observation seed; unpublished |
| `MANUAL_DRAFT` | Created by admin manual entry; unpublished |
| `NEEDS_REVIEW` | Queued for human semantic work (auto after detect / after draft submit) |
| `CLASSIFIED` | Required semantic fields present; awaiting verification |
| `VERIFIED` | Human verified facts + classification; still not public |
| `PUBLISHED` | Explicitly approved for Breath public surface |
| `REJECTED` | Terminal rejection (noise, irrelevant, not treasury) |
| `DUPLICATE` | Terminal; points at surviving transaction |
| `RECONCILIATION_REQUIRED` | Exception holding state (reorg conflict, amount mismatch, contradictory evidence) |

### Allowed transitions

```
DETECTED              → NEEDS_REVIEW | DUPLICATE | RECONCILIATION_REQUIRED | REJECTED
MANUAL_DRAFT          → NEEDS_REVIEW | REJECTED
NEEDS_REVIEW          → CLASSIFIED | REJECTED | DUPLICATE | RECONCILIATION_REQUIRED
CLASSIFIED            → VERIFIED | NEEDS_REVIEW | REJECTED | RECONCILIATION_REQUIRED
VERIFIED              → PUBLISHED | CLASSIFIED | RECONCILIATION_REQUIRED
PUBLISHED             → RECONCILIATION_REQUIRED   # only via correction workflow (see below)
RECONCILIATION_REQUIRED → NEEDS_REVIEW | REJECTED | DUPLICATE
REJECTED              → (terminal)
DUPLICATE             → (terminal)
```

No other transitions.

### Authority per transition

| Transition | Authority |
|------------|-----------|
| Watcher create `DETECTED` | `service` actor + `TREASURY_WATCHER_ENABLED` path only |
| Watcher may set `RECONCILIATION_REQUIRED` / propose `DUPLICATE` flag for human confirm | service proposes; human confirms `DUPLICATE` |
| `MANUAL_DRAFT` create / edit draft fields | platform admin with `admin.treasury.mutate` |
| → `NEEDS_REVIEW` / `CLASSIFIED` / `VERIFIED` / `REJECTED` / confirm `DUPLICATE` | `admin.treasury.mutate` |
| → `PUBLISHED` | `admin.treasury.publish` (strict subset; deliberate confirmation required at API) |
| Public read | unauthenticated read of **publication projection only** |

### Immutable facts (never edited in place)

For watcher-origin rows, once written:

- network, token/contract, tx hash, transfer/log ordinal, from/to, native atomic amount + decimals, observed timestamps, block identity, ingestion source, observation idempotency key

For all rows after leaving `MANUAL_DRAFT`:

- `id`, `created_at`, `created_by_actor_*`, initial provenance kind

### Revisable before `PUBLISHED`

Semantic fields via **append-only revision records** (not silent UPDATE of authoritative meaning):

- purpose, category, kind, fund_bucket, counterparty display label, project/module, milestone/stage, budget_id, funding_need_id, description, internal notes, public description, attribution linkage proposals, USD valuation (when allowed), publication eligibility flags

Projection columns on `treasury_transactions` may be updated to the latest revision tip for query convenience; revision history remains authoritative.

### Published mistake correction (append-only)

1. Do **not** delete or rewrite the published row’s immutable facts.
2. Open `RECONCILIATION_REQUIRED` on the published row (audit + reason).
3. Create a linked **correction** transaction (`kind=CORRECTION` or `kind=REFUND`) with `corrects_transaction_id`.
4. Correction follows the same classify → verify → publish path.
5. Public read model includes corrections so aggregates remain reproducible.
6. Optional supersession: mark original `publication_superseded_by_id` when a correcting publication replaces public narrative fields — history retained.

---

## 5. Exact data model / data dictionary (proposed)

### Conventions

- Prefix: `treasury_*` (Core treasury domain).
- Tenancy: every row carries `organization_id` → `organizations.id` for the **WAIA platform treasury org** (see Human Decision HD-1).
- Money storage (FROZEN):
  - Native: `native_amount_atomic BIGINT NOT NULL` + `native_decimals SMALLINT NOT NULL` + `native_asset TEXT NOT NULL` + `native_contract TEXT NULL`.
  - Normalized public USD (optional): `usd_amount_micros BIGINT NULL` (= USD × 10^6) + `usd_valuation_source TEXT NULL` + `usd_valued_at timestamptz NULL`.
  - **Never** `double`/`real`/JS number as authoritative storage.
  - API may expose decimal strings; UI may format numbers from exact integers.
- Digests: `sha256:` hex of canonical JSON where integrity is required.
- English system enums; human-entered text may retain operator language.

### 5.1 Enums (Postgres)

| Enum | Values |
|------|--------|
| `treasury_tx_status` | `DETECTED`, `MANUAL_DRAFT`, `NEEDS_REVIEW`, `CLASSIFIED`, `VERIFIED`, `PUBLISHED`, `REJECTED`, `DUPLICATE`, `RECONCILIATION_REQUIRED` |
| `treasury_tx_direction` | `INFLOW`, `OUTFLOW` |
| `treasury_tx_kind` | `CONTRIBUTION`, `EXPENSE`, `TRANSFER`, `REFUND`, `CORRECTION`, `OTHER` |
| `treasury_fund_bucket` | `OPERATING`, `RESERVE`, `SPONSORED_ACCESS`, `SOLIDARITY`, `UNASSIGNED` |
| `treasury_provenance` | `WATCHER`, `MANUAL` |
| `treasury_budget_status` | `DRAFT`, `ACTIVE`, `SUPERSEDED`, `ARCHIVED` |
| `treasury_funding_need_status` | `OPEN`, `PARTIALLY_FUNDED`, `FUNDED`, `CLOSED`, `CANCELLED` |
| `treasury_evidence_kind` | `RECEIPT`, `INVOICE`, `CONFIRMATION`, `SCREENSHOT`, `DOCUMENT`, `CHAIN_PROVENANCE` |
| `treasury_evidence_visibility` | `ADMIN_ONLY`, `PUBLIC` |
| `treasury_attribution_status` | `UNMATCHED`, `ATTRIBUTED`, `ANONYMOUS`, `REVOKED` |
| `treasury_address_direction_scope` | `INBOUND`, `OUTBOUND`, `BOTH` |

`fund_bucket` values exist for DEE-612/613 future compatibility. DEE-606 does **not** implement solidarity workflows; default classification uses `OPERATING` or `UNASSIGNED` until Human sets policy.

### 5.2 `treasury_watched_addresses`

| Field | Type | Null | Meaning | Owner | Mutability | Public |
|-------|------|------|---------|-------|------------|--------|
| `id` | uuid PK | NO | Address registry id | Core treasury | immutable | NO |
| `organization_id` | uuid FK→organizations | NO | Treasury org | Core | immutable | NO |
| `network` | text | NO | e.g. `TRC-20` | Core | immutable | NO |
| `address` | text | NO | On-chain address | Core | immutable | NO |
| `token_contract` | text | NO | e.g. USDT contract | Core | immutable | NO |
| `asset_code` | text | NO | e.g. `USDT` | Core | immutable | NO |
| `direction_scope` | enum | NO | which transfers to observe | Core | admin-updatable | NO |
| `label` | text | NO | admin label | Core | admin-updatable | NO |
| `is_active` | boolean | NO | observation eligibility | Core | admin-updatable | NO |
| `created_at` / `updated_at` | timestamptz | NO | audit timestamps | Core | system | NO |

**Constraints:** unique `(network, address, token_contract)`; index `(organization_id, is_active)`.

### 5.3 `treasury_watcher_checkpoints`

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `checkpoint_key` | text PK | NO | e.g. `TRC-20:treasury` — **not** bare `TRC-20` |
| `last_scanned_block` | text | NO | cursor |
| `last_scanned_at` | timestamptz | NO | |
| `lease_until` | timestamptz | YES | single-writer lease |
| `last_error` / `last_error_at` | text/timestamptz | YES | |
| `cycle_count` | int | NO | default 0 |
| `created_at` / `updated_at` | timestamptz | NO | |

### 5.4 `treasury_chain_observations` (Layer 1)

Immutable observation facts.

| Field | Type | Null | Meaning | Mutability | Public |
|-------|------|------|---------|------------|--------|
| `id` | uuid PK | NO | Observation id | immutable | NO |
| `organization_id` | uuid FK | NO | Treasury org | immutable | NO |
| `watched_address_id` | uuid FK | NO | Which treasury address matched | immutable | NO |
| `network` | text | NO | | immutable | NO |
| `token_contract` | text | NO | | immutable | NO |
| `asset_code` | text | NO | | immutable | NO |
| `tx_hash` | text | NO | | immutable | NO |
| `transfer_index` | int | NO | log/transfer ordinal | immutable | NO |
| `from_address` | text | NO | | immutable | NO |
| `to_address` | text | NO | | immutable | NO |
| `direction` | enum | NO | relative to watched address | immutable | NO |
| `native_amount_atomic` | bigint | NO | exact on-chain amount | immutable | NO |
| `native_decimals` | smallint | NO | e.g. 6 for USDT | immutable | NO |
| `block_height` | text | NO | | immutable | NO |
| `block_timestamp` | timestamptz | YES | chain time if available | immutable | NO |
| `observed_at` | timestamptz | NO | watcher observe time | immutable | NO |
| `confirmations_observed` | int | NO | | updatable by watcher only until terminal | NO |
| `confirmations_required` | int | NO | | immutable per policy | NO |
| `observation_status` | text | NO | `OBSERVED` \| `CONFIRMED` \| `DROPPED` | watcher FSM | NO |
| `idempotency_key` | text | NO | `TRC-20:{txHash}:{transferIndex}:{watchedAddressId}` | immutable | NO |
| `ingestion_source` | text | NO | e.g. `treasury-watcher@worker` | immutable | NO |
| `raw_event_digest` | text | NO | sha256 of canonical observation payload | immutable | NO |
| `related_payment_id` | uuid | YES | optional FK→payments | admin-set later | NO |
| `created_at` | timestamptz | NO | | immutable | NO |

**Constraints:** unique `idempotency_key`; unique `(network, tx_hash, transfer_index, watched_address_id)`; index `(organization_id, observed_at desc)`.

### 5.5 `treasury_transactions` (Layer 2 projection tip)

| Field | Type | Null | Meaning | Mutability | Public |
|-------|------|------|---------|------------|--------|
| `id` | uuid PK | NO | Semantic ledger id | immutable | id only if published |
| `organization_id` | uuid FK | NO | | immutable | NO |
| `status` | enum | NO | lifecycle | FSM only | derived |
| `provenance` | enum | NO | WATCHER/MANUAL | immutable | limited |
| `observation_id` | uuid FK | YES | required when provenance=WATCHER | immutable | NO |
| `direction` | enum | NO | | immutable after NEEDS_REVIEW | if published |
| `kind` | enum | YES | null until classified | via revision | if published |
| `fund_bucket` | enum | NO | default `UNASSIGNED` | via revision | NO unless published policy allows |
| `native_*` money fields | as above | NO | copied from observation or manual entry | immutable after leave MANUAL_DRAFT | amount if published |
| `usd_amount_micros` | bigint | YES | valuation | via revision until PUBLISHED; after publish only via correction | if published |
| `occurred_at` | timestamptz | NO | business time | set at create; correction via linked tx | if published |
| `purpose` | text | YES | | revision | if published as public_description basis |
| `category` | text | YES | controlled vocabulary string | revision | if published |
| `counterparty_display` | text | YES | | revision | only if publish_counterparty=true |
| `project_module` | text | YES | e.g. `platform`, `ai-twin` | revision | if published |
| `milestone_stage` | text | YES | | revision | if published |
| `budget_id` | uuid FK | YES | | revision | NO |
| `funding_need_id` | uuid FK | YES | | revision | NO |
| `description` | text | YES | internal-facing | revision | NO |
| `internal_notes` | text | YES | admin only | revision | NO |
| `public_description` | text | YES | Breath label | revision | YES when published |
| `publish_counterparty` | boolean | NO | default false | revision | gate |
| `tx_hash` / explorer fields | text | YES | denorm for admin UX | immutable if watcher | provenanceUrl when allowed |
| `corrects_transaction_id` | uuid FK | YES | correction link | immutable once set | if published |
| `duplicate_of_transaction_id` | uuid FK | YES | | set on DUPLICATE | NO |
| `publication_superseded_by_id` | uuid | YES | | correction workflow | NO |
| `published_at` | timestamptz | YES | | on publish | YES |
| `published_by_user_id` | uuid FK→users | YES | | on publish | NO |
| `latest_revision_id` | uuid | YES | tip | system | NO |
| `record_content_digest` | text | NO | tip digest | system | NO |
| `created_by_user_id` | uuid | YES | null for watcher | immutable | NO |
| `created_at` / `updated_at` | timestamptz | NO | | system | NO |

**Indexes:** `(organization_id, status)`; `(organization_id, occurred_at desc)`; `(budget_id)`; `(kind, status)`; unique `(observation_id)` where not null.

### 5.6 `treasury_transaction_revisions` (append-only classification history)

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `transaction_id` | uuid FK | NO | |
| `organization_id` | uuid FK | NO | |
| `seq` | int | NO | per-tx monotonic |
| `patch_json` | jsonb | NO | semantic fields changed |
| `actor_user_id` | uuid | YES | |
| `actor_type` | text | NO | `admin`/`service` |
| `reason` | text | YES | |
| `content_digest` | text | NO | |
| `prev_revision_digest` | text | YES | |
| `created_at` | timestamptz | NO | |

**Constraints:** unique `(transaction_id, seq)`; no UPDATE/DELETE (trigger block).

### 5.7 `treasury_budgets`

| Field | Type | Null | Meaning | Public |
|-------|------|------|---------|--------|
| `id` | uuid PK | NO | | NO |
| `organization_id` | uuid FK | NO | | NO |
| `code` | text | NO | stable key | NO |
| `title` | text | NO | | if published via Breath stage/budget |
| `period_start` / `period_end` | date | NO | | derived |
| `currency` | text | NO | `USD` for v1 public | YES when published |
| `planned_amount_micros` | bigint | NO | planned | via formulas |
| `status` | enum | NO | | NO |
| `is_public` | boolean | NO | include in Breath budget block | gate |
| `notes` | text | YES | admin | NO |
| `created_at` / `updated_at` | timestamptz | NO | | NO |

**Derived (not stored as authority):** funded / committed / spent / remaining from ledger rules in §9.

### 5.8 `treasury_ideal_annual_budgets` (explicit Human/admin object)

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | version id |
| `organization_id` | uuid FK | NO | |
| `period_year` | int | NO | e.g. 2026 |
| `currency` | text | NO | `USD` |
| `amount_micros` | bigint | NO | exact annual ideal |
| `effective_from` | timestamptz | NO | |
| `effective_to` | timestamptz | YES | null = current |
| `status` | text | NO | `DRAFT` \| `ACTIVE` \| `SUPERSEDED` |
| `publication_state` | text | NO | `PRIVATE` \| `PUBLIC` |
| `created_by_user_id` | uuid | NO | |
| `approved_by_user_id` | uuid | YES | required to ACTIVE+PUBLIC |
| `created_at` | timestamptz | NO | |

**Constraint:** at most one `ACTIVE`+`PUBLIC` row per `(organization_id, period_year)`.  
**Invariant:** never inferred from donations.

### 5.9 `treasury_funding_needs`

| Field | Type | Null | Meaning | Public |
|-------|------|------|---------|--------|
| `id` | uuid PK | NO | | |
| `organization_id` | uuid FK | NO | | NO |
| `title` | text | NO | | if public |
| `public_explanation` | text | YES | | if public |
| `target_stage` | text | YES | | if public |
| `required_amount_micros` | bigint | NO | | if public |
| `currency` | text | NO | | if public |
| `status` | enum | NO | | if public |
| `is_public` | boolean | NO | | gate |
| `budget_id` | uuid FK | YES | optional link | NO |
| `created_at` / `updated_at` | timestamptz | NO | | NO |

**Derived funded amount:** sum of published/verified qualifying allocations linked to this need (exact rule in §9).

### 5.10 `treasury_evidence_objects` + `treasury_evidence_links`

**Object (no large binary in DB):**

| Field | Type | Null | Meaning | Public |
|-------|------|------|---------|--------|
| `id` | uuid PK | NO | | NO |
| `organization_id` | uuid FK | NO | | NO |
| `storage_backend` | text | NO | e.g. `r2`, `supabase-storage` | NO |
| `object_key` | text | NO | durable ref | NO |
| `media_type` | text | NO | | NO |
| `byte_size` | bigint | NO | | NO |
| `sha256` | text | NO | hex digest | NO |
| `kind` | enum | NO | | NO |
| `visibility` | enum | NO | default `ADMIN_ONLY` | gate |
| `source` | text | NO | upload/watcher/manual | NO |
| `uploaded_by_user_id` | uuid | YES | | NO |
| `observed_at` | timestamptz | NO | | NO |
| `created_at` | timestamptz | NO | | NO |

**Link:** `treasury_evidence_links(id, organization_id, transaction_id, evidence_object_id, created_at)` unique `(transaction_id, evidence_object_id)`.

Public Breath never exposes admin-only evidence. Chain explorer URLs may be published separately as `provenanceUrl` without exposing stored objects.

### 5.11 `treasury_contribution_attributions`

| Field | Type | Null | Meaning | Public |
|-------|------|------|---------|--------|
| `id` | uuid PK | NO | | NO |
| `organization_id` | uuid FK | NO | | NO |
| `transaction_id` | uuid FK | NO | must be CONTRIBUTION inflow | NO |
| `status` | enum | NO | | NO |
| `contributor_user_id` | uuid FK→users | YES | null if UNMATCHED/ANONYMOUS | NO by default |
| `attribution_method` | text | NO | `manual_admin`, `address_link`, `self_claim` (self_claim deferred) | NO |
| `consent_public_identity` | boolean | NO | default false | gate |
| `note` | text | YES | admin | NO |
| `attributed_by_user_id` | uuid | YES | | NO |
| `attributed_at` | timestamptz | YES | | NO |
| `revoked_at` | timestamptz | YES | | NO |
| `created_at` | timestamptz | NO | | NO |

**Constraints:** unique open attribution per `transaction_id` where `revoked_at is null`; later attribution replaces via revoke+insert (audit both).

### 5.12 `treasury_publication_settings` (singleton per org)

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `organization_id` | uuid PK | NO | |
| `breath_enabled` | boolean | NO | master fail-closed switch; default false |
| `stage_label` | text | YES | published stage |
| `work_summary` | text | YES | |
| `methodology_note` | text | NO | overrides pending note when enabled |
| `recent_activity_limit` | int | NO | default 5 |
| `updated_by_user_id` | uuid | YES | |
| `updated_at` | timestamptz | NO | |

### 5.13 Runway plan input (explicit, not invented)

Table `treasury_runway_plans`:

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `method` | text | NO | `APPROVED_PLANNED_BURN` only for v1 publishable runway |
| `currency` | text | NO | `USD` |
| `daily_burn_micros` | bigint | NO | approved planned daily burn |
| `effective_from` | timestamptz | NO | |
| `effective_to` | timestamptz | YES | |
| `status` | text | NO | `DRAFT` \| `ACTIVE` \| `SUPERSEDED` |
| `created_by_user_id` | uuid | NO | |
| `approved_by_user_id` | uuid | YES | required for ACTIVE |
| `created_at` | timestamptz | NO | |

**FROZEN:** historical burn-rate runway is **not** used for public `endsAt` in DEE-606. If no ACTIVE runway plan exists, Breath runway fields stay pending.

---

## 6. Contribution-attribution / share contract (FROZEN)

### Qualifying contribution set `Q`

A transaction is in `Q` iff **all** hold:

1. `kind = CONTRIBUTION`
2. `direction = INFLOW`
3. `status ∈ {VERIFIED, PUBLISHED}`
4. not `REJECTED` / `DUPLICATE`
5. native asset is in the **approved contribution asset set** (v1: `USDT` on `TRC-20` only)
6. `usd_amount_micros IS NOT NULL` (valuation required before share math)

Refunds/corrections that reduce contribution:

- A `REFUND` or `CORRECTION` outflow/inflow linked via `corrects_transaction_id` to a member of `Q`, itself in `{VERIFIED, PUBLISHED}`, adjusts the net by its signed USD micros.

### Net contribution amount

For each contribution root `c ∈ Q`:

```
net_usd_micros(c) = c.usd_amount_micros + Σ signed_usd_micros(corrections/refunds linked to c)
```

Negative nets floor to 0 for share numerator/denominator inclusion (full negative retained in audit aggregates separately).

### Numerator / denominator

```
numerator(user) = Σ net_usd_micros(c) for c in Q where open attribution status=ATTRIBUTED AND contributor_user_id=user
denominator     = Σ net_usd_micros(c) for all c in Q
                  including UNMATCHED and ANONYMOUS
share(user)     = numerator(user) / denominator   if denominator > 0 else 0
```

### Explicit inclusions / exclusions

| Item | Counts in denominator? | Counts in user numerator? |
|------|------------------------|---------------------------|
| VERIFIED/PUBLISHED contribution | YES | only if ATTRIBUTED to user |
| UNMATCHED / ANONYMOUS contribution | YES | NO |
| DETECTED / NEEDS_REVIEW / CLASSIFIED / MANUAL_DRAFT | NO | NO |
| REJECTED / DUPLICATE | NO | NO |
| EXPENSE / TRANSFER / ordinary outflow | NO | NO |
| Refund/correction reducing a contribution | reduces net as above | reduces that user’s numerator if original attributed |
| Project expenditures | **NO** — never reduce historical share merely because funds were spent | |

### Multi-currency

v1: only USDT TRC-20 qualifies. Valuation rule: `usd_amount_micros = native_amount_atomic` when `native_decimals=6` and asset=USDT (1 USDT = 1 USD for map math), recorded explicitly with `usd_valuation_source='USDT_PARITY_V1'`. Any other asset/network requires Human Decision before entering `Q`.

### Non-claims (FROZEN)

Contribution share does **not** create equity, shares, securities, profit rights, stronger voting rights, or governance authority.

### Privacy default for public map (FROZEN pending HD-2 confirmation)

Public Breath / future DEE-611 surface initially exposes:

- **aggregate only**: total confirmed contribution USD, contributor-attributed count (optional), unmatched count (optional)
- **no public identity list**
- authenticated **self-only** share endpoint may be added for the contributor’s own percentage (not required for homepage)

Opt-in public identities (`consent_public_identity=true`) are schema-supported but **not published** until Human Decision HD-2.

---

## 7. Watcher idempotency / replay / reconciliation (FROZEN)

### Scope v1

- Network: `TRC-20`
- Token: USDT contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (override via env for non-prod only)
- Directions: INFLOW and OUTFLOW vs active `treasury_watched_addresses`
- Enable: `TREASURY_WATCHER_ENABLED` (independent of billing `WATCHER_ENABLED`)

### Observation identity

```
idempotency_key = `${network}:${txHash}:${transferIndex}:${watchedAddressId}`
```

DB unique on that key. Replay of same Transfer is a no-op return of existing observation.

### Lifecycle (observer only)

1. First sighting (confirmations ≥ 1): upsert observation `OBSERVED`; create `treasury_transactions` status `DETECTED` → immediately transition to `NEEDS_REVIEW` (system).
2. Confirmations ≥ required (default 20 per ADR-0015 doctrine): mark observation `CONFIRMED`.
3. Reorg / disappeared tx after age-out: mark observation `DROPPED`; transaction → `RECONCILIATION_REQUIRED` (never auto-REJECT).
4. Duplicate detection: if same `(network, tx_hash, transfer_index)` already bound to another active transaction for same org, service proposes reconciliation; human confirms `DUPLICATE`.

### Watcher never

- publishes
- sets `kind` / budget / attribution / public description
- creates governance meaning
- signs, broadcasts, or touches trading capital

### Manual provenance

Manual create writes `provenance=MANUAL`, `observation_id=null`, status `MANUAL_DRAFT`, requires admin to submit → `NEEDS_REVIEW`. Manual may include optional paste of tx hash (non-authoritative until linked/verified).

---

## 8. Evidence contract (FROZEN)

- Store **references + metadata + sha256**, never large raw binary in financial rows.
- Default visibility `ADMIN_ONLY`.
- `PUBLIC` evidence requires explicit admin set **and** parent transaction `PUBLISHED` before any public URL issuance.
- Breath public surface does **not** list evidence objects in DEE-606; may only show `provenanceUrl` (explorer) when allowed.
- Every evidence upload/link/unlink writes `audit_logs`.

Storage backend selection (R2 vs Supabase storage) is an implementation detail inside WP-5 but must satisfy the reference contract above. **Human Decision HD-3** if a production bucket does not yet exist.

---

## 9. Public Breath read-model formulas (FROZEN)

Source contract: `lib/landing/breath-public.ts`.  
Server function replaces pending stub when `treasury_publication_settings.breath_enabled=true` **and** required published inputs exist; otherwise remain pending.

### Money basis

All Breath numbers are USD display units derived from integer micros:

```
usd = usd_amount_micros / 1_000_000
```

Only `PUBLISHED` transactions participate in public aggregates unless noted.

### Definitions

Let `P` = published transactions not superseded for aggregation.  
Let `C_pub` = `P` where `kind=CONTRIBUTION` and `direction=INFLOW` (nets after published corrections).  
Let `E_pub` = `P` where `kind=EXPENSE` and `direction=OUTFLOW` (nets after corrections).  
Let `active_budget` = the single public ACTIVE budget selected for Breath (or null).  
Let `ideal` = ACTIVE+PUBLIC `treasury_ideal_annual_budgets` for current period (or null).  
Let `runway_plan` = ACTIVE `treasury_runway_plans` (or null).

### Field formulas

| Field | Formula / rule |
|-------|----------------|
| `status` | `"published"` iff `breath_enabled` and `ideal` present and settings allow; else `"pending"` |
| `lastUpdatedAt` | max(`published_at` of P ∪ settings.updated_at) ISO; null if pending |
| `stageLabel` | `settings.stage_label` if published else null |
| `idealAnnualBudget` | `{ currency:'USD', amount: ideal.amount_micros/1e6 }` else nulls |
| `resources.entered` | Σ net USD of `C_pub` |
| `resources.spent` | Σ net USD of `E_pub` |
| `resources.allocated` | Σ planned remaining commitments: sum over public budgets of `committed` (below) |
| `resources.remaining` | `entered - spent` **accounting identity for published flows** (not wallet RPC balance) |
| `resources.neededNext` | if public OPEN/PARTIALLY_FUNDED funding need exists: `required - derived_funded` of the primary public need; else null |
| `currentFreeFunds` | `max(0, resources.remaining - resources.allocated)` where allocated means **committed unspent** (see below). This is **free/uncommitted operating funds**, not raw chain wallet balance. |
| `budget.planned` | `active_budget.planned_amount_micros/1e6` else null |
| `budget.funded` | Σ net published contributions assigned to `active_budget` (via `budget_id`) |
| `budget.committed` | admin-maintained committed total stored on budget revision tip **or** sum of CLASSIFIED+ expenses assigned to budget that are not yet spent — **FROZEN choice:** store `committed_amount_micros` on budget as Human/admin governed value (not inferred from chain). Derived spent still from ledger. |
| `budget.spent` | Σ net published expenses with `budget_id=active_budget` |
| `budget.remaining` | `planned - spent` (not planned-funded). If negative, publish negative only if Human allows; else clamp display later in UI — **API returns exact signed value**. |
| `budget.fillRatio` | if planned>0: `clamp(funded/planned, 0, 1)` else null |
| `runway.value` / `unit` / `endsAt` | iff `runway_plan` ACTIVE and `currentFreeFunds` published: `endsAt = now + (currentFreeFunds_micros / daily_burn_micros) days`; `value`/`unit` derived as whole days (unit=`days`); `periodLabel` optional human string. Else all null (pending). |
| `recentActivity.inflows/outflows` | last N published txs by `occurred_at` with `public_description` as `label`, explorer URL as `provenanceUrl` when tx_hash present and publish allowed |
| `work.summary` | settings.work_summary |
| `work.githubUrl` | existing constant |
| `methodologyNote` | settings.methodology_note when published; else existing pending note |

### Explicit non-equivalences

| Concept | Definition |
|---------|------------|
| Current wallet balance | On-chain RPC balance of watched addresses — **out of Breath v1 formulas**; admin-only diagnostic later |
| Accounting balance | `entered - spent` from published ledger |
| Committed funds | Admin-governed `committed_amount_micros` on budgets |
| Free/uncommitted operating funds | `currentFreeFunds` as above |

If a scientifically/accountingly defensible value cannot be produced, field stays `null` / pending — **never invent**.

---

## 10. Ideal annual budget contract (FROZEN)

- Represented by `treasury_ideal_annual_budgets` (§5.8).
- Selected for Breath: the single `ACTIVE` + `PUBLIC` row for the configured period year.
- Gauge continues to use `deriveBreathFundingMarkerRatio(currentFreeFunds, idealAnnualBudget)` — no visual redesign.
- Changing the ideal creates a new row; previous becomes `SUPERSEDED`; audit written.

---

## 11. Runway methodology (FROZEN)

- Public runway uses **approved planned burn only** (`APPROVED_PLANNED_BURN`).
- Authoritative input: `treasury_runway_plans.daily_burn_micros`.
- `endsAt` requires both ACTIVE plan and published `currentFreeFunds`.
- Historical burn windows are **not** used for public countdown in DEE-606.
- If no ACTIVE plan: runway pending; homepage countdown stays on pending path.

---

## 12. Admin mutation / audit contract (FROZEN)

### New permissions

| Permission | Use |
|------------|-----|
| `admin.treasury.read` | admin read APIs |
| `admin.treasury.mutate` | drafts, classify, verify, evidence, budgets, needs, attributions, runway drafts |
| `admin.treasury.publish` | publish transactions; enable Breath; activate PUBLIC ideal budget; activate runway plan |

Extend `ADMIN_PERMISSIONS` in `lib/waia-core/permissions/resolve.ts`. Platform role `admin` receives all three.

### Mutation surfaces (backend contracts for DEE-607)

English system names; no UI in DEE-606.

1. List/filter transactions
2. Get transaction + revisions + evidence + attribution
3. Manual create / draft update
4. Classify / verify / reject / mark duplicate
5. Attach/detach evidence
6. Attribute / revoke contributor
7. Budget CRUD + commit amount set
8. Funding need CRUD
9. Ideal annual budget version + activate/publish
10. Runway plan version + activate
11. Publication settings + Breath enable
12. Publish transaction (explicit)
13. Open reconciliation / create correction

Every sensitive mutation calls `writeAuditLogPostgres` with `entityType` under `treasury.*` and org scope.

### Public API

- `getBreathPublicSnapshot()` becomes server-backed, fail-closed, no privileged credentials in browser.
- Optional authenticated self contribution-share endpoint (non-homepage) may ship if low-cost; not required for AC of homepage pending→published path.

---

## 13. Migration + rollback strategy

### Plan-time disposition (FROZEN)

```
DEE_606_MIGRATION_IDENTITY_DEFERRED_TO_IMPLEMENTATION_PREFLIGHT
```

Exact migration numbers are **not** frozen in this plan because:

- `origin/main` tip = `0109`
- Active unmerged DEE-518 reserves **`0110`–`0145`** on branch and **uncommitted `0146`/`0147`** in `/Users/legco/Projects/waia`
- Allocating `0110` or casually choosing `0148` now would collide or falsely claim safety

This is **not** a stop on planning. It **is** a stop on creating migration files until implementation preflight.

### Implementation preflight algorithm (mandatory)

1. `git fetch origin main` in DEE-606 worktree only.
2. Read `origin/main` journal tip tag `N`.
3. Enumerate reserved tags from:
   - open GitHub PR branches touching `db/migrations_postgres/`
   - local NO-TOUCH note of DEE-518 worktree filenames `0110+` (read-only), without modifying that worktree
4. Let `R = max(reserved numeric prefixes ∪ N)`.
5. Allocate DEE-606 additive migrations as `R+1…` with paired `_rls` files as needed.
6. Hand-author SQL + journal entries per `db/AGENTS.md` (no blind `db:generate`).
7. Record allocated tags into this plan `state.migrationIdentity` before coding tables.

If governance later requires freezing numbers **before** plan approval while DEE-518 remains unmerged, escalate:

```
DEE_606_MIGRATION_IDENTITY_BLOCKED_BY_ACTIVE_DEE_518_RESERVATION
```

and wait — do **not** touch DEE-518.

### Rollback

- Additive-only migrations.
- Rollback = forward fix / disable `breath_enabled` / stop `TREASURY_WATCHER_ENABLED`.
- No destructive DROP in the integration PR.
- If a migration fails mid-apply on staging: repair forward; do not rewrite journal history.

---

## 14. RLS / security / isolation plan (FROZEN)

- App-layer authorization primary (admin permissions + org scope).
- Targeted RLS defense-in-depth on all `treasury_*` tables: **ENABLE RLS + deny `authenticated`/`anon`** for SELECT/INSERT/UPDATE/DELETE (same pattern as `0046_payments_rls.sql`).
- Append-only triggers on `treasury_chain_observations`, `treasury_transaction_revisions`, evidence immutability as applicable.
- Service role via `DATABASE_URL_POSTGRES` only.
- No browser secrets; no privileged DB credentials client-side.
- Publication fail-closed (`breath_enabled` default false).
- **Release-blocking tests:** cross-org read/write attempts denied; non-admin forbidden on mutate/publish; public endpoint never returns internal notes/evidence/admin attribution identities.

---

## 15. R5-safe dedicated DB test topology (FROZEN)

While DEE-518 R5 uses `waia-postgres-validate-1` on **54329**:

| Parameter | DEE-606 value |
|-----------|----------------|
| Compose file | `docker-compose.postgres-treasury-validate.yml` (new) |
| Compose project name | `waia-postgres-treasury-validate` |
| Service/container | `postgres-treasury-validate` / `waia-postgres-treasury-validate-1` |
| Host port | **`127.0.0.1:54339`** (never 54329) |
| Volume | dedicated named volume `waia_treasury_validate_pg` |
| DB/user/pass | `waia_treasury_validate` / local-only |
| Scripts | `db:postgres:treasury:up\|down\|bootstrap` — **must not** call `db:postgres:down` or standard bootstrap |

Rules:

- No DEE-606 command may stop/recreate `waia-postgres-validate-1`.
- No global Docker restart.
- Lint/typecheck/static unit tests may run without this DB.
- Postgres integration/isolation tests for treasury **require** the dedicated topology if R5 is active.
- Plan-time: **do not run** Postgres integration tests.

---

## 16. Implementation work packages (dependency order)

### WP-0 — Plan approval gate

Human CONFIRM on this document → set `state.status=approved`. No code.

### WP-1 — Migration identity preflight + schema enums/tables

- Run §13 allocation algorithm.
- Hand-author additive Postgres migrations + Drizzle schema + enums.
- RLS + append-only triggers.
- No watcher yet.

### WP-2 — Domain services + repositories

- Transaction FSM service
- Revision/correction service
- Budget / funding need / ideal budget / runway plan services
- Attribution service
- Evidence metadata service (upload wiring may stub storage backend behind interface)
- Shared audit integration

### WP-3 — Treasury watcher observation

- Watched addresses admin API
- Checkpoint + `TREASURY_WATCHER_ENABLED`
- Reuse Tron adapter patterns; inbound+outbound
- Idempotent observation → `DETECTED`/`NEEDS_REVIEW`
- Health endpoint separate from billing watcher

### WP-4 — Admin backend HTTP contracts

- Route handlers with `admin.treasury.*` permissions
- No DEE-607 UI

### WP-5 — Evidence storage adapter

- Implement object storage adapter satisfying §8
- Admin attach/list only

### WP-6 — Public Breath read model

- Replace pending `getBreathPublicSnapshot()` with DB-backed builder using §9
- Keep pending behavior when disabled/incomplete
- Unit tests for formulas + fail-closed

### WP-7 — Contribution share engine

- Pure functions for numerator/denominator/net
- Admin attribution APIs
- Tests for refunds/exclusions/expenses-do-not-dilute

### WP-8 — Isolation + R5-safe Postgres tests

- Dedicated compose topology
- Tenant/admin isolation tests (release-blocking)
- Watcher idempotency tests against dedicated DB

### WP-9 — PR readiness

- `pnpm lint && pnpm typecheck && pnpm build`
- Targeted unit tests; R5-safe postgres tests
- Update this plan state; `/prepare-pr` later — **not in plan phase**

---

## 17. Validation matrix

| Gate | Command / check | When |
|------|-----------------|------|
| Static | `pnpm lint` | PR readiness |
| Types | `pnpm typecheck` | PR readiness |
| Build | `pnpm build` | PR readiness |
| Unit (formulas/FSM/share) | `pnpm test --run` targeted paths | WP-6/7 + PR |
| Postgres isolation | dedicated treasury compose tests | WP-8 + PR |
| E2E | **not required for DEE-606** (no UI); DEE-607 owns admin e2e | — |
| Governance preflight | `./scripts/linear/preflight-pr-governance.sh` | prepare-pr |
| R5 safety | assert port ≠ 54329; container name ≠ validate-1 | every DB test run |
| Full unit suite | GitHub PR CI authoritative | PR |

---

## 18. Acceptance criteria traceability (Linear DEE-606)

| Linear AC | Plan coverage |
|-----------|---------------|
| Watcher inbound/outbound ingested idempotently, unpublished until human classification, evidence attachable, public only after approval | §§4,7,8,9,12 + WP-3/5/6 |
| Manual transaction equivalent provenance/audit | §§4,5.5,12 |
| Budget and funding-need totals reconcile from ledger/read models | §§5.7–5.9,9 |
| Public data contract supports homepage Breath without privileged DB access | §9, WP-6 |
| Full audit and isolation tests pass | §§12,14,15,17 |
| Single-trunk `main` workflow | Authority + WP-9 |
| Domain ownership decision before migration | §1 |
| Exact schema + state machine | §§4–5 |
| Watcher idempotency contract | §7 |
| Evidence contract | §8 |
| Admin mutation/audit contract | §12 |
| Migration + rollback | §13 |
| Security/tenant-isolation test plan | §§14–15,17 |
| Contribution map data truth for DEE-611 | §6 |

---

## 19. Explicit out of scope

- DEE-607 Admin Finance Console UI/screens
- DEE-611 homepage copy / “Every contribution is remembered” block
- DEE-612 / DEE-613 doctrine publication and solidarity/access workflows
- AI-TRADER execution/risk/research/capital/billing/HWM changes
- Homepage visual redesign / Breath gauge redesign
- Publishing invented financial figures
- Equity/security/governance rights from contribution %
- Custody, signing, disbursement automation (ADR-0014 separation preserved)
- Multi-chain beyond USDT TRC-20 (schema-ready network fields only)
- Using historical burn for public runway
- Touching DEE-518 worktree, R5 screen, port 54329, Execution Server, WF_ECONOMIC, BLIND_HOLDOUT
- Creating migration files during plan phase
- Opening/merging a PR during plan phase

---

## 20. Open Human decisions (gates)

| ID | Decision | Plan default if approved as-is | Blocks |
|----|----------|--------------------------------|--------|
| **HD-1** | Which `organization_id` is the WAIA platform treasury tenant? | Must be explicitly designated (Org-0 or dedicated org); implementation must not guess | WP-1 seed/config |
| **HD-2** | Public contribution map disclosure for v1 | **Aggregate-only** (+ optional self-only authenticated share); no public identity list | DEE-611 copy honesty |
| **HD-3** | Production evidence object storage backend/bucket | Interface frozen; backend choice at WP-5 | WP-5 |
| **HD-4** | Initial ideal annual budget amount/year | Data entry after schema; architecture frozen | Breath `status=published` |
| **HD-5** | Initial ACTIVE runway daily burn (or keep runway pending) | Default: **leave runway pending** until Human sets burn | runway fields |
| **HD-6** | Confirm `budget.committed` is admin-governed (not auto from chain) | **Yes — admin-governed** as frozen in §9 | WP-2 |
| **HD-7** | Whether `TREASURY_WATCHER_ENABLED` may ship on in production in the same PR as schema | Default: ship code **dark** (`enabled=false`) until Human enables | production observe |

Architecture decisions in §§1–15 are **not** optional menus for executors. Only the HD-* rows require Human input.

---

## Solidarity / universal-access compatibility (DEE-612/613)

- `treasury_fund_bucket` includes `RESERVE`, `SPONSORED_ACCESS`, `SOLIDARITY` for later separately accounted funds.
- DEE-606 does not implement sponsored access, eligibility, patron control, or hardship grants.
- Invariant preserved: money supporting another person’s access must never grant the sponsor access to that person’s account, AI-Twin, data, decisions, private history, or voting authority — enforced later; schema must not force sponsor↔beneficiary public linkage.

---

## Related Linear status (plan-time)

| Issue | Role | Status at plan drafting |
|-------|------|-------------------------|
| DEE-606 | primary | Todo → **In Progress** |
| DEE-607 | blocked by 606 | Todo (unchanged) |
| DEE-611 | later consumer | Todo (unchanged) |
| DEE-612 / DEE-613 | doctrine inputs | Todo (unchanged) |

---

## Plan answers checklist (executor-proof)

1. Domain ownership: **Core Treasury/Transparency domain (A)** — §1  
2. Payment/watcher reuse: **patterns yes; tables/checkpoint/flag no** — §2  
3. Schema/dictionary: §5  
4. State machine: §4  
5. Contribution share: §6  
6. Watcher contract: §7  
7. Evidence: §8  
8. Breath formulas: §9  
9. Ideal annual budget: §10 / §5.8  
10. Runway: §11 / §5.13  
11. Admin/audit: §12  
12. Privacy/publication: §6 + §9 + HD-2  
13. Migration/rollback: §13  
14. RLS/security: §14  
15. R5-safe DB: §15  
16. Work packages: §16  
17. Validation matrix: §17  
18. AC traceability: §18  
19. Out of scope: §19  
20. Human decisions: §20  

---

**Marker:** `DEE_606_CANONICAL_PLAN_READY_FOR_HUMAN_REVIEW`  
**state.status:** `draft` (awaiting Human CONFIRM)
