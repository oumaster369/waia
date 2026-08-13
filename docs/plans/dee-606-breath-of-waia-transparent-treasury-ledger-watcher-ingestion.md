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
  status: approved
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-0, WP-1, WP-2]
  remainingWorkPackages: [WP-3, WP-4, WP-5, WP-6, WP-7, WP-8, WP-9]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 44c06089cb01eab95ce1b1f118f6a15bef853f35
  lastValidationAt: "2026-08-13"
  blockedReason: null
  nextAction: "prepare/execute WP-3 Treasury Watcher (DARK) under the approved plan."
  wp2:
    status: COMPLETE
    startingSha: 7ac23d999278e366a0df428445ec8191a589cbda
    implementationSha: 44c06089cb01eab95ce1b1f118f6a15bef853f35
    validatedAt: "2026-08-13"
    filesCreated:
      - lib/waia-core/treasury/**
      - tests/unit/treasury-*.test.ts
      - tests/unit/helpers/treasury-wp2.ts
    targetedTestCommand: "pnpm exec vitest run tests/unit/treasury-transaction-fsm.test.ts tests/unit/treasury-cash-effect.test.ts tests/unit/treasury-watcher-verify.test.ts tests/unit/treasury-publication.test.ts tests/unit/treasury-commitment-lifecycle.test.ts tests/unit/treasury-contribution-share.test.ts tests/unit/treasury-inception.test.ts tests/unit/treasury-service-audit-scope.test.ts"
    targetedTestFiles: 8
    targetedTestCount: 138
    lint: PASS
    typecheck: "WP-2 modules clean; repository tsc still reports pre-existing WP-1 drizzle bigint default(0) errors in db/schema.postgres.ts:4618 and :4621 (unchanged; no schema edit in WP-2)"
    gitDiffCheck: clean
    provedInvariants:
      - transaction-fsm-allowed-and-forbidden
      - cash-effect-matrix
      - watcher-verified-precondition
      - publication-orthogonality
      - commitment-lifecycle-and-active-derivation
      - contribution-share-primitives-wp2-only
      - inception-without-checkpoint-seed
      - audit-revision-org-scope
    watcherDark: true
    httpUi: none
    schemaMigrationChanges: false
    dbGenerateRun: false
    wp7ScopeConsumed: false
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
  wp1Authoring:
    status: COMPLETE
    authoredAt: "2026-08-12"
    validation: DEDICATED_POSTGRES_VALIDATION_PASS
    note: "WP-1 COMPLETE after dedicated Postgres validation on 127.0.0.1:54339."
  wp1BoundedCorrection:
    status: CHECKPOINT_ORG_SCOPE_CORRECTED
    afterSha: c26ebad5731be312489c6f72b576827dc1245ed2
    correctedAt: "2026-08-13"
    reason: "treasury_watcher_checkpoints was keyed only by checkpoint_key; approved invariant requires all Treasury entities org-scoped. Composite PK (organization_id, checkpoint_key) + organizations FK. 0148/0149 identities unchanged."
  wp1TypeCorrection:
    status: COMPLETE
    correctedAt: "2026-08-13"
    reason: "Drizzle bigint(mode=bigint) defaults for treasury_balance_reconciliations.explained_pending_micros and tolerance_micros used number literal 0; corrected to bigint literal 0n. SQL migrations and validated Postgres semantics unchanged."
    typecheck: PASS
    postgresRevalidationRequired: false
    wp1ValidatedImplementationShaUnchanged: 0df1b9698f1af27222c60bfb11191f0cf3f85676
  wp1Validation:
    status: DEDICATED_POSTGRES_VALIDATION_PASS
    validatedImplementationSha: 0df1b9698f1af27222c60bfb11191f0cf3f85676
    validatedAt: "2026-08-13"
    port: 54339
    evidencePath: /tmp/dee606-wp1-postgres-validation-0df1b9698f1af27222c60bfb11191f0cf3f85676.log
    evidenceSha256: 462bf9d40ae72e425cbec39a70aa93bf1c9ef94623a1b5184eac06eb4bf2ab07
    passCategories:
      - empty-db-apply
      - catalog
      - enums
      - organization_id
      - watcher-checkpoint-composite-pk
      - rls
      - append-only
      - same-org-composite-fks
      - check-constraints
      - journal-monotonicity
    dee518LocalJournalTipObserved: 0148_trader_forecast_v2_open_tail_null_bounds_v1
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
  humanArchitectureApproval:
    status: COMPLETE
    approvedAt: "2026-08-12"
    approvedArchitectureSourceSha: 82377e4f4869b9bf64f26a9578c2335cdbcb8b15
    approvalToken: CONFIRM-DEE-606-ARCHITECTURE-PLAN-82377E4F
    architectReview: COMPLETE
    humanArchitectureApproval: COMPLETE
  humanDecisionDispositions:
    HD-1: APPROVED
    HD-2: APPROVED
    HD-3: DEFERRED
    HD-4: DEFERRED
    HD-5: APPROVED_DEFAULT_PENDING
    HD-7: APPROVED_DARK
  migrationIdentity:
    disposition: ALLOCATED_BRANCH_RESERVATION
    mainTipAtAllocation: "0109"
    dee518ReservationThrough: "0147"
    dee518LocalJournalTipObservedReadOnly: 0148_trader_forecast_v2_open_tail_null_bounds_v1
    allocatedTags:
      - 0148_treasury_transparency_ledger_foundation
      - 0149_treasury_transparency_ledger_rls
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
    note: "Branch reservation after max(main tip 0109, DEE-518 reservation 0147). DEE-518 local worktree now also contains 0148_trader_forecast_v2_open_tail_null_bounds_v1. Final identity reconciliation/renumbering is WP-9 / PR readiness. Allocation is NOT permission to Human-merge. See §13."
  r5SafePostgres:
    requiredPort: 54339
    forbiddenPortWhileR5Active: 54329
    note: "Dedicated treasury validate topology only; never stop/recreate waia-postgres-validate-1. WP-1 authoring intentionally skipped apply/validation while R5 authority work was active."
  correctionPass:
    afterSha: a95b9c1c27b9d98df66cfb944c292dd1967e5f5e
    reason: "Independent Architect review corrections (T3, accounting vs detail publication, cash equation, commitments, runway as-of, reconciliation, fund-bucket deferral)."
  integrityPass:
    afterSha: a0f00846b55a53f1f9ecb2db8c9e6bef82a156e0
    reason: "Final integrity corrections: ledger inception anchor, internal-transfer observation coalescing, temporally exact reconciliation + freshness, reconciled resource flows, budget.remaining with commitments, same-org FK integrity, kind/direction constraints."
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
| `organization_id` | uuid FK | NO | part of PK |
| `code` | text | NO | part of PK; stable code |
| `title` | text | NO | |
| `is_active` | boolean | NO | |
| `created_at` | timestamptz | NO | |

**Primary key:** `(organization_id, code)`.  
**Seeded v1 rows only (per treasury org):** `OPERATING`, `RESERVE`, `UNASSIGNED`.

Future solidarity/access buckets may be inserted later after DEE-612/613 Human approval — schema remains compatible without canonizing unapproved doctrine now. DEE-606 does **not** implement solidarity workflows.

### 5.1c `treasury_ledger_inceptions` (FROZEN chain/watcher start boundary)

Deterministic ledger-inception anchor. Prevents `OPENING_BALANCE` + historical backfill double counting.

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `network` | text | NO | e.g. `TRC-20` |
| `token_contract` | text | NO | |
| `asset_code` | text | NO | `USDT` |
| `inception_block` | text | NO | inclusive boundary block height |
| `inception_block_hash` | text | YES | if provider/source supports it |
| `inception_time` | timestamptz | NO | |
| `opening_balance_transaction_id` | uuid | NO | FK → `treasury_transactions.id` (OPENING_BALANCE) |
| `watcher_start_block` | text | NO | first block eligible for canonical watcher ingestion; **strictly after** inception boundary |
| `evidence_object_id` | uuid | YES | evidence/provenance ref |
| `status` | text | NO | `ACTIVE` \| `SUPERSEDED` |
| `created_by_user_id` | uuid | NO | |
| `approved_by_user_id` | uuid | NO | required for ACTIVE |
| `created_at` | timestamptz | NO | |

**Binding rules:**

1. Exactly one `ACTIVE` inception per `(organization_id, network, token_contract)`.
2. Linked `OPENING_BALANCE` represents the consolidated balance of the recon-included managed treasury address set **at the inception anchor**.
3. That `OPENING_BALANCE` must be `VERIFIED`, evidence-backed, and linked here before watcher ingestion is considered canonical.
4. Treasury watcher canonical ingestion starts **strictly after** the inception boundary (`watcher_start_block` > `inception_block` numerically / as defined by chain ordering).
5. Historical transfers at or before the inception boundary **MUST NOT** also be counted as post-inception ledger movements.
6. Initial `treasury_watcher_checkpoints.last_scanned_block` for the matching checkpoint key is **deterministically seeded** from the approved inception (`watcher_start_block − 1` / equivalent scan cursor so the first scan begins at `watcher_start_block`).
7. Future ledger rebase / inception replacement is a separate explicit reconciliation/migration operation — **never** silent mutation of an ACTIVE inception.

**Required tests:** opening + historical backfill cannot double-count; checkpoint seed matches inception; transfers at/before inception excluded from semantic ledger; replacing ACTIVE inception requires SUPERSEDED path + audit.

### 5.1d Same-organization relational integrity (FROZEN)

All organization-scoped references between `treasury_*` entities **MUST** be same-organization by **database constraint**, not merely application convention.

Use composite unique keys + composite FKs (or equivalent Postgres-enforced pairs) for relationships including:

- transaction → fund bucket `(organization_id, fund_bucket_code)` → `treasury_fund_buckets(organization_id, code)`
- transaction → budget / funding need
- transaction ↔ observations via observation links
- attribution → transaction
- evidence link → transaction / evidence object
- commitment → budget / fulfillment transaction
- runway snapshot → runway plan
- inception → opening balance transaction
- reconciliation → organization (+ inception where applicable)

Cross-organization references must be impossible even through privileged app bugs. Targeted RLS remains defense-in-depth **in addition** to this invariant.

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
| `organization_id` | uuid FK | NO | part of PK — **not** encoded in `checkpoint_key` |
| `checkpoint_key` | text | NO | e.g. `TRC-20:treasury` — **not** bare `TRC-20`; org-local, not globally unique |
| `last_scanned_block` | text | NO | |
| `last_scanned_at` | timestamptz | NO | |
| `lease_until` | timestamptz | YES | |
| `last_error` / `last_error_at` | text/timestamptz | YES | |
| `cycle_count` | int | NO | default 0 |
| `created_at` / `updated_at` | timestamptz | NO | |

**Primary key:** `(organization_id, checkpoint_key)`. Database-enforced org-scoped identity. Do **not** rely on organization encoded inside `checkpoint_key`.

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

**Canonical blockchain Transfer identity** (org-scoped semantic coalesce key):

```
(organization_id, network, token_contract, tx_hash, transfer_index)
```

Address-relative observations may be multiple for the same Transfer; semantic ledger coalesces to one transaction (§5.5b, §7).

### 5.5 `treasury_transactions`

| Field | Type | Null | Meaning | Mutability | Public detail |
|-------|------|------|---------|------------|---------------|
| `id` | uuid PK | NO | | immutable | only if DETAIL_PUBLIC |
| `organization_id` | uuid FK | NO | | immutable | NO |
| `status` | `treasury_tx_status` | NO | accounting FSM | FSM | NO |
| `detail_publication` | enum | NO | default `PRIVATE` | publish authority | YES state |
| `provenance` | enum | NO | | immutable | limited |
| `canonical_network` | text | YES | set for watcher-origin | immutable | NO |
| `canonical_token_contract` | text | YES | | immutable | NO |
| `canonical_tx_hash` | text | YES | | immutable | NO |
| `canonical_transfer_index` | int | YES | | immutable | NO |
| `direction` | enum | NO | | immutable after NEEDS_REVIEW | if DETAIL_PUBLIC |
| `kind` | enum | YES | null until classified | revision | if DETAIL_PUBLIC |
| `fund_bucket_code` | text | NO | default `UNASSIGNED`; FK with org | revision | NO unless policy |
| `native_*` | money fields | NO | | immutable after leave draft | amount if DETAIL_PUBLIC |
| `accounting_amount_micros` | bigint | YES | required before VERIFIED; magnitude ≥ 0 | revision until VERIFIED; then correction only | amount if DETAIL_PUBLIC |
| `accounting_denomination_policy` | text | YES | e.g. `USDT_NOMINAL_USD_POLICY_V1` | same | NO |
| `cash_effect_micros` | bigint | YES | signed effect on consolidated treasury cash; set at classify/verify per §9 | system from kind rules | NO |
| `counterparty_is_internal` | boolean | NO | true when both sides are managed treasury addresses | classify / watcher objective fact | NO |
| `occurred_at` | timestamptz | NO | | create; correction via link | if DETAIL_PUBLIC |
| `purpose` / `category` | text | YES | | revision | if DETAIL_PUBLIC |
| `counterparty_display` | text | YES | | revision | only if DETAIL_PUBLIC **and** `publish_counterparty` |
| `publish_counterparty` | boolean | NO | default false | revision | gate |
| `project_module` / `milestone_stage` | text | YES | | revision | if DETAIL_PUBLIC |
| `budget_id` / `funding_need_id` | uuid | YES | | revision | NO |
| `description` / `internal_notes` | text | YES | | revision | NO |
| `public_description` | text | YES | Breath row label | revision | if DETAIL_PUBLIC |
| `tx_hash` | text | YES | denorm (= canonical when watcher) | immutable if watcher | only if DETAIL_PUBLIC + policy |
| `corrects_transaction_id` | uuid | YES | | immutable once set | if DETAIL_PUBLIC |
| `duplicate_of_transaction_id` | uuid | YES | | on DUPLICATE | NO |
| `detail_superseded_by_id` | uuid | YES | | detail workflow | NO |
| `ledger_inception_id` | uuid | YES | required for OPENING_BALANCE | immutable once set | NO |
| `verified_at` / `verified_by_user_id` | timestamptz/uuid | YES | | on VERIFIED | NO |
| `detail_published_at` / `detail_published_by_user_id` | timestamptz/uuid | YES | | on DETAIL_PUBLIC | NO |
| `latest_revision_id` | uuid | YES | | system | NO |
| `record_content_digest` | text | NO | | system | NO |
| `created_by_user_id` | uuid | YES | | immutable | NO |
| `created_at` / `updated_at` | timestamptz | NO | | system | NO |

**Removed:** single authoritative `observation_id` on the transaction. Observation linkage is many-to-one via §5.5b.

**Semantic idempotency (watcher-origin):** unique partial index on  
`(organization_id, canonical_network, canonical_token_contract, canonical_tx_hash, canonical_transfer_index)`  
where those fields are NOT NULL. Replay cannot create a second semantic treasury transaction for the same canonical Transfer.

**Indexes:** `(organization_id, status)`; `(organization_id, detail_publication)`; `(organization_id, occurred_at desc)`; `(budget_id)`; `(kind, status)`.

**Composite FKs (same-org):**  
`(organization_id, fund_bucket_code)` → `treasury_fund_buckets`;  
`(organization_id, budget_id)` → `treasury_budgets(organization_id, id)` (budgets carry unique `(organization_id, id)`); likewise funding needs.

### 5.5a Kind / direction / cash-effect invariants (FROZEN)

Impossible combinations must not become `VERIFIED` (CHECK constraints + service guards):

| Kind | Required direction | Cash-effect rule |
|------|--------------------|------------------|
| `OPENING_BALANCE` | `INFLOW` (frozen representational direction) | `cash_effect_micros = +accounting_amount_micros` (`A > 0`) |
| `CONTRIBUTION` | `INFLOW` | `+A` (`A > 0`) |
| `EXTERNAL_INFLOW` | `INFLOW` | `+A` (`A > 0`) |
| `EXPENSE` | `OUTFLOW` | `−A` (`A > 0`) |
| `EXTERNAL_OUTFLOW` | `OUTFLOW` | `−A` (`A > 0`) |
| `INTERNAL_TRANSFER` | `INTERNAL` | `0` (consolidated); `A ≥ 0` magnitude recorded for display/audit |
| `REFUND` | `INFLOW` or `OUTFLOW` | sign follows direction (`+A` / `−A`); `A > 0` |
| `CORRECTION` / `BALANCE_ADJUSTMENT` | must agree with signed effect | `cash_effect_micros ≠ 0`; direction `INFLOW` iff effect > 0, `OUTFLOW` iff effect < 0; evidence required |

**Non-negative / positive amount constraints:** `accounting_amount_micros ≥ 0`; commitment `amount_micros > 0`; budget `planned_amount_micros > 0`; runway `daily_burn_micros > 0`; ideal `amount_micros > 0`; native atomic amounts ≥ 0.

### 5.5b `treasury_transaction_observation_links` (FROZEN)

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `transaction_id` | uuid | NO | |
| `observation_id` | uuid | NO | |
| `observation_role` | text | NO | `PRIMARY` \| `INTERNAL_COUNTERPARTY` \| `SECONDARY` |
| `created_at` | timestamptz | NO | |

**Constraints:**

- unique `(transaction_id, observation_id)`
- unique `(observation_id)` — one observation links to at most one semantic transaction
- composite FKs enforce same `organization_id` for transaction and observation

**Coalescing rules:**

- External inbound/outbound Transfer matching one managed address → normally **one** observation link → **one** semantic transaction.
- Managed A → managed B (same org, both watched) → **two** address-relative observations may link to the **same** semantic transaction; `direction = INTERNAL`; `kind` classifies as `INTERNAL_TRANSFER` (or remains unclassified until human classify, but cash effect once VERIFIED is 0); **never** two independent semantic movements; **never** double-count in aggregates.
- Watcher may objectively detect both endpoints are managed treasury addresses; it still does **not** assign business/governance meaning beyond the objective internal-transfer fact.

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

**Constraints:** unique `(organization_id, id)` for composite FK targets; unique `(organization_id, code)`.

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
| `fulfills_transaction_id` | uuid | YES | expense/outflow that fulfills |
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

Independent control — **not** accounting SoT. Must be temporally exact.

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `ledger_inception_id` | uuid | YES | FK to ACTIVE inception used for scope |
| `as_of_block` | text | NO | chain block height for on-chain balance read |
| `as_of_time` | timestamptz | NO | reconciliationAsOf wall/logical time |
| `observed_onchain_balance_atomic` | bigint | YES | null if provider cannot prove exact snapshot |
| `accounting_cash_balance_micros` | bigint | YES | `accountingCashBalanceAt(reconciliationAsOf)` |
| `delta_micros` | bigint | YES | observed_nominal − accounting when both known |
| `explained_pending_micros` | bigint | NO | default 0; sum of known OBSERVED/unconfirmed effects explaining delta |
| `unexplained_residual_micros` | bigint | YES | delta − explained_pending |
| `status` | enum | NO | |
| `tolerance_micros` | bigint | NO | v1: `0` for USDT nominal |
| `evidence_object_id` | uuid | YES | optional screenshot/export |
| `notes` | text | YES | admin |
| `created_by` | text | NO | `service`/`admin` |
| `created_at` | timestamptz | NO | |

#### Temporally exact accounting side (FROZEN)

```
accountingCashBalanceAt(reconciliationAsOf) =
  Σ cash_effect_micros(t) for t in VERIFIED
  where t is effective at or before reconciliationAsOf under these inclusion rules:
```

- **Watcher-origin VERIFIED rows:** include only if **all** linked observations have `block_height` ≤ `as_of_block` (chain boundary). If any linked observation lacks a comparable block height, treat that row as not includable for this as-of and mark recon `UNAVAILABLE` unless an approved alternate bound exists.
- **Manual / OPENING_BALANCE / BALANCE_ADJUSTMENT / CORRECTION facts:** include only if `occurred_at` (effective time) ≤ `as_of_time`.
- Do **not** compare a current-chain balance with an accounting total containing later movements.

If the chain provider cannot prove an exact comparable balance snapshot at the captured block/time:

```
status = UNAVAILABLE
```

Never fabricate exactness. `observed_onchain_balance_atomic` may be null when UNAVAILABLE.

#### Publication freshness (FROZEN)

v1 maximum acceptable reconciliation age: **10 minutes** (aligned to existing ~1 minute cron; no stricter repo canon found).

Breath financial aggregates may publish only when the **latest** reconciliation for the treasury org/asset is:

- `MATCHED`, or
- `PENDING_CONFIRMATIONS` **only if** the entire delta is exactly explained by known OBSERVED/unconfirmed transfers **and** `unexplained_residual_micros = 0`

Fail closed:

- `UNAVAILABLE` ⇒ Breath pending
- `MISMATCH` (unexplained residual ≠ 0 beyond tolerance) ⇒ Breath pending
- latest recon older than **10 minutes** ⇒ Breath pending (stale)

#### Other v1 rules

- Participating addresses: active watched addresses with `include_in_balance_recon=true`, same network/token, within the ACTIVE inception scope.
- Internal transfers are cash-neutral in accounting and net-zero on consolidated on-chain sum.
- Tolerance: **0 micros** under `USDT_NOMINAL_USD_POLICY_V1`.
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

Requires an `ACTIVE` `treasury_ledger_inceptions` row; canonical ingestion starts at `watcher_start_block` strictly after inception. Checkpoint is seeded from that boundary. Transfers at/before inception are never ingested as post-inception semantic movements.

### Observation idempotency (address-relative)

```
observation_idempotency_key = `${network}:${txHash}:${transferIndex}:${watchedAddressId}`
```

One observation per matched watched address is allowed.

### Semantic transfer identity + coalescing (FROZEN)

Canonical Transfer identity:

```
(organization_id, network, token_contract, tx_hash, transfer_index)
```

Semantic ledger: **exactly one** `treasury_transactions` row per canonical Transfer (unique partial index). Links via `treasury_transaction_observation_links`.

| Scenario | Observations | Semantic txs | Cash effect when VERIFIED |
|----------|--------------|--------------|---------------------------|
| External inbound to managed A | 1 | 1 | `+A` (once classified as contribution/external inflow) |
| External outbound from managed A | 1 | 1 | `−A` |
| Managed A → managed B | 2 | **1** (`INTERNAL`) | **0** |
| Replay of any of the above | no new semantic tx | still 1 | unchanged |

Watcher may objectively detect internal endpoints; it does not assign further business/governance meaning.

### Observation FSM

1. confirmations ≥ 1 → observation `OBSERVED`; ensure semantic tx exists (`DETECTED` → `NEEDS_REVIEW`) and link observation
2. confirmations ≥ required (default 20) → observation `CONFIRMED`
3. disappeared after age-out → `DROPPED` + semantic tx `RECONCILIATION_REQUIRED`
4. Periodic / cycle-end: emit balance reconciliation at captured as-of (§5.15)

### Binding VERIFIED precondition (WATCHER)

For `provenance = WATCHER`, transition to `VERIFIED` is **rejected** unless **every** linked observation satisfies:

```
observation_status = CONFIRMED
AND confirmations_observed >= confirmations_required
```

For internal transfers with two links, **both** must be CONFIRMED.

Human may **classify** while OBSERVED, but must **not** VERIFY until the precondition holds.

Until VERIFIED: excluded from accounting cash, contribution share, and public financial aggregates.

### Required tests

- classify-before-confirm allowed; verify-before-confirm rejected
- after CONFIRMED (all links), verify allowed
- OBSERVED amounts absent from aggregates and contribution share
- external inbound ⇒ one semantic tx; external outbound ⇒ one semantic tx
- managed A → managed B ⇒ two observations, one semantic tx, cash effect zero
- replay ⇒ still one semantic tx
- inception boundary: no double count with OPENING_BALANCE; checkpoint seeded correctly
- idempotent replay; DROPPED opens reconciliation

Watcher never publishes details, never sets kind/budget/attribution beyond objective internal-transfer detection, never signs/broadcasts.

---

## 8. Evidence contract (FROZEN)

Reference + metadata + sha256 only. Default `ADMIN_ONLY`. `PUBLIC` evidence requires explicit set **and** does not imply DETAIL_PUBLIC transaction disclosure unless separately approved. Every upload/link/unlink audits.

---

## 9. Canonical accounting + Breath formulas (FROZEN)

### 9.1 Signed cash-effect semantics (per VERIFIED row)

Let `A = accounting_amount_micros` (magnitude ≥ 0; kind rules in §5.5a).

| Kind | Direction | `cash_effect_micros` |
|------|-----------|----------------------|
| `OPENING_BALANCE` | `INFLOW` | `+A` (linked ACTIVE inception; evidence required; establishes since-inception starting resources) |
| `CONTRIBUTION` | `INFLOW` | `+A` |
| `EXTERNAL_INFLOW` | `INFLOW` | `+A` |
| `EXPENSE` | `OUTFLOW` | `−A` |
| `EXTERNAL_OUTFLOW` | `OUTFLOW` | `−A` |
| `REFUND` | `INFLOW` / `OUTFLOW` | `+A` / `−A` |
| `CORRECTION` / `BALANCE_ADJUSTMENT` | agrees with sign | signed non-zero; evidence required |
| `INTERNAL_TRANSFER` | `INTERNAL` | `0` consolidated |

No hidden mutable scalar balance. Each semantic transaction counted **once** in aggregates (internal coalescing).

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

As-of variant for reconciliation: `accountingCashBalanceAt(reconciliationAsOf)` per §5.15.

### 9.3 Public resource flows (must reconcile with cash)

For Breath v1, resource-flow fields derive from VERIFIED **signed cash effects** (consolidated treasury cash), not from contribution-category alone:

```
resources.entered =
  Σ max(cash_effect_micros(t), 0) for t in V

resources.spent =
  Σ max(−cash_effect_micros(t), 0) for t in V

# INTERNAL_TRANSFER contributes 0 to both

resources.remaining =
  resources.entered − resources.spent
  = accountingCashBalance_micros   # exact identity
```

Implications:

- `OPENING_BALANCE` is included in `entered` for the since-inception Breath presentation.
- Positive `BALANCE_ADJUSTMENT` / inbound refunds increase `entered`; negative adjustments / outflows increase `spent`.
- `resources.spent` means **consolidated treasury cash outflow**, not merely `kind=EXPENSE`.
- Contribution-share engine remains separate (§6) and is **not** redefined here.

### 9.4 Breath field formulas

Breath publishes only when:

- `breath_enabled = true`
- ideal annual budget ACTIVE+PUBLIC present
- **no** material unresolved transaction reconciliation (§4)
- latest balance reconciliation satisfies §5.15 publication freshness (`MATCHED`, or explained `PENDING_CONFIRMATIONS` with zero unexplained residual; not stale > 10 minutes; never `UNAVAILABLE`/`MISMATCH`)

Else `status = "pending"` and numeric fields null/empty.

| Field | Rule |
|-------|------|
| `status` | `"published"` iff gates above hold; else `"pending"` |
| `lastUpdatedAt` | max timestamp among authoritative inputs used in the snapshot: VERIFIED transaction changes (`verified_at`/`updated_at`), commitment lifecycle changes, latest balance reconciliation `created_at`, ideal annual budget activation/change, latest runway snapshot `created_at`, funding-need / publication-settings changes. Must not be older than any material input used. |
| `stageLabel` | settings |
| `idealAnnualBudget` | ACTIVE+PUBLIC ideal |
| `resources.entered` / `spent` / `remaining` | §9.3 |
| `resources.allocated` | `activeCommittedFunds` (derived) |
| `resources.neededNext` | primary public funding need: required − derived funded; else null |
| `currentFreeFunds` | from §9.2 |
| `budget.planned` | active public budget planned |
| `budget.funded` | Σ VERIFIED contributions with `budget_id = active_budget` |
| `budget.committed` | Σ active commitments for that budget (`APPROVED`+`RELEASED`) — separate visible field |
| `budget.spent` | Σ VERIFIED expenses with that `budget_id` (and other VERIFIED outflows assigned to the budget per classify rules) |
| `budget.remaining` | `planned − budget.spent − budget.committed` (exact signed API value; **not** clamped; commitments reduce remaining without being falsely recorded as spent) |
| `budget.fillRatio` | `clamp(funded/planned,0,1)` if planned>0 else null |
| `runway.*` | from latest `treasury_runway_snapshots` if ACTIVE plan exists; else pending |
| `recentActivity` | only `detail_publication = DETAIL_PUBLIC` and `status = VERIFIED` (and not SUPERSEDED) |
| `work` / `methodologyNote` | settings; methodology must state `resources.spent` = consolidated cash outflow |

### 9.5 Non-equivalences

| Concept | Definition |
|---------|------------|
| On-chain wallet balance | RPC sum — reconciliation control only |
| `accountingCashBalance` | Σ VERIFIED cash effects (= `resources.remaining`) |
| `activeCommittedFunds` / `resources.allocated` | derived from commitment facts |
| `currentFreeFunds` | accounting cash − active commitments |
| Contribution totals | §6 share engine — separate from resource-flow entered |

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
| `admin.treasury.mutate` | drafts, classify, verify (with preconditions), evidence, budgets, needs, attributions, commitments lifecycle, runway drafts, opening/adjustment entries, ledger inception create/approve |
| `admin.treasury.publish` | detail publication, Breath enable, activate PUBLIC ideal, activate runway plan, snapshot refresh |

Platform `admin` receives all three. Every sensitive mutation writes `audit_logs`.

### Backend contracts for DEE-607 (no UI here)

Transaction FSM; detail publication; commitments CRUD/lifecycle; budgets/needs/ideal/runway; evidence; attribution; ledger inception; balance reconciliation view; Breath preview using §9; correction workflow.

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

**Same-organization composite FK integrity (§5.1d)** is mandatory in addition to RLS.

Release-blocking tests:

- cross-org denial (app + DB FK)
- non-admin denial
- public endpoint never returns internal notes/evidence/admin identities
- aggregates include PRIVATE VERIFIED without leaking detail fields
- material / stale / UNAVAILABLE / MISMATCH reconciliation forces Breath pending
- impossible kind/direction/cash-effect combinations rejected before VERIFIED
- commitments reduce `budget.remaining` without being recorded as spent
- internal transfer coalescing: two observations → one semantic tx → cash effect 0
- inception + opening balance cannot double-count historical transfers

---

## 15. R5-safe DB test topology (FROZEN)

Dedicated compose `docker-compose.postgres-treasury-validate.yml`; project `waia-postgres-treasury-validate`; port **54339**; never 54329; never stop `waia-postgres-validate-1`; no global Docker restart. Plan-time: do not run Postgres tests.

---

## 16. Work packages (dependency order)

### WP-0 — Human architecture approval gate (T3)

**COMPLETE.** Human Architect approved architecture source SHA `82377e4f4869b9bf64f26a9578c2335cdbcb8b15` with token `CONFIRM-DEE-606-ARCHITECTURE-PLAN-82377E4F`. Architect review complete. Human architecture approval complete. `state.status=approved`. Implementation WPs remain incomplete until executed.

### WP-1 — Migration preflight + schema

**COMPLETE.** Dedicated Postgres validation **PASS** on `127.0.0.1:54339` (compose project `waia-postgres-treasury-validate`). Validated implementation SHA `0df1b9698f1af27222c60bfb11191f0cf3f85676`. Evidence sha256 `462bf9d40ae72e425cbec39a70aa93bf1c9ef94623a1b5184eac06eb4bf2ab07`. Empty-DB apply of full branch history (112 migrations, final `0149_treasury_transparency_ledger_rls`); 20 `treasury_*` tables all org-scoped; 18 Treasury enums; watcher checkpoint PK `(organization_id, checkpoint_key)`; RLS 20/80; append-only triggers; 24 same-org composite FKs; 20 CHECKs. Merge-order gate remains **binding** (DEE-518 local journal tip observed `0148_trader_forecast_v2_open_tail_null_bounds_v1`; not merged to main). No watcher enablement. HD-3 remains DEFERRED.

### WP-2 — Domain services

**COMPLETE.** Core-owned `lib/waia-core/treasury/**` domain/services over the validated WP-1 schema. Implementation SHA `44c06089cb01eab95ce1b1f118f6a15bef853f35`. Targeted unit tests **138/138 PASS**. Watcher remains DARK. No HTTP/UI. No schema/migration edits. No `db:generate`. WP-7 contribution engine not consumed (WP-2 primitives only). Inception does **not** seed watcher checkpoints. Merge-order gate remains binding.

### WP-3 — Treasury watcher (DARK)

Inception-seeded checkpoint; watched addresses; inbound+outbound; address-relative observation idempotency; semantic Transfer coalescing (esp. internal A→B); confirmation; temporally exact balance reconciliation emission; never verify; never assign governance meaning.

### WP-4 — Admin backend HTTP contracts

Permissions + mutation APIs for DEE-607 (incl. inception); no UI.

### WP-5 — Evidence storage adapter

Implement only after HD-3 storage path approval; interface ready earlier.

### WP-6 — Breath read model + runway snapshots

§9 formulas (`entered`/`spent`/`remaining` identity; budget.remaining with commitments); fail-closed reconciliation freshness; as-of runway tests; complete `lastUpdatedAt` inputs.

### WP-7 — Contribution share engine

VERIFIED-only; unmatched in denominator; expenses do not dilute; nominal policy tests. Unchanged share semantics.

### WP-8 — Isolation + R5-safe Postgres tests

Verify-precondition; aggregate-vs-detail separation; commitment derivation; budget.remaining; internal-transfer coalescing; inception double-count prevention; same-org FK isolation; recon as-of / stale / UNAVAILABLE fail-closed.

### WP-9 — PR readiness

lint/typecheck/build; targeted tests; migration merge-order proof; prepare-pr later — not in plan phase.

---

## 17. Validation matrix

| Gate | Check | When |
|------|-------|------|
| Architect review + Human architecture approval | T3 gates | before implement |
| lint / typecheck / build | pnpm | PR readiness |
| Unit: FSM, verify precondition, cash equation, resource identity, budget.remaining, commitments, runway as-of, share, recon as-of/freshness, internal coalescing, inception | targeted | WP-2/3/6/7/8 |
| Postgres isolation + same-org FK on :54339 | dedicated compose | WP-8 |
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
| Watcher idempotency + verify precondition + internal coalescing + inception | §§5.1c,5.5b,7 |
| Contribution map data truth | §6 |
| Migration + merge-order safety | §13 |
| Temporally exact recon + freshness | §5.15 |
| Resource entered/spent/remaining identity | §9.3 |

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

| ID | Decision | Disposition (Human 2026-08-12) | Blocks |
|----|----------|--------------------------------|--------|
| **HD-1** | Platform treasury tenant | **APPROVED.** Use/create a dedicated Core organization for **WAIA Platform Treasury**. Do **not** reuse AI-Trader Org-0. Exact org creation/ID resolution remains WP-1 implementation precondition. | WP-1 seed |
| **HD-2** | Public contribution disclosure | **APPROVED.** v1: aggregate-only; no public contributor identity list; authenticated self-only contribution share may be supported; contributor identity remains private unless separately approved later. | DEE-611 honesty |
| **HD-3** | Evidence object storage | **DEFERRED.** Production evidence object storage is **not** yet approved. Cloudflare R2 remains the architecture recommendation (no approved durable object-store binding exists). No new production storage service may be provisioned until HD-3 is resolved. Must be resolved before WP-5 production evidence storage implementation. | WP-5 production uploads |
| **HD-4** | Initial ideal annual budget amount/year | **DEFERRED.** Intentionally not chosen yet. Do not invent a value. Does not block schema/domain implementation. Blocks Breath pending→published financial figures if ideal budget is required by the publication contract. | Breath published status |
| **HD-5** | Initial ACTIVE runway daily burn | **APPROVED DEFAULT.** Runway remains pending until the Human explicitly approves an ACTIVE planned daily burn. Do not infer burn from historical expenses. | runway fields |
| ~~HD-6~~ | ~~manual committed scalar~~ | **REMOVED.** Commitment facts + derived totals are mandatory. | — |
| **HD-7** | Production watcher enablement | **APPROVED.** Architecture and code ship with `TREASURY_WATCHER_ENABLED=false` (DARK). Production enablement requires a separate explicit Human operational gate after implementation/merge/readiness. | ops after merge |

### Human architecture approval record

| Field | Value |
|-------|--------|
| Approval token | `CONFIRM-DEE-606-ARCHITECTURE-PLAN-82377E4F` |
| Approved architecture source SHA | `82377e4f4869b9bf64f26a9578c2335cdbcb8b15` |
| Architect review | COMPLETE |
| Human architecture approval | COMPLETE |
| Plan `state.status` | `approved` |
| WP-0 | COMPLETE |
| WP-1 | COMPLETE (`DEDICATED_POSTGRES_VALIDATION_PASS` on `:54339`) |
| WP-2 | COMPLETE (domain services; implementation SHA `44c06089cb01eab95ce1b1f118f6a15bef853f35`; 138 targeted tests) |
| Current work package | WP-3 (watcher DARK; not started in the WP-2 closeout task) |
| Migration identities | `0148_treasury_transparency_ledger_foundation`, `0149_treasury_transparency_ledger_rls` (branch reservation; merge-order gate still binding) |

---

## Plan answers checklist

1. Domain ownership: **Core Treasury domain (A)** — §1  
2. Payment/watcher reuse: patterns yes; billing tables/checkpoint/flag no — §2  
3. Schema/dictionary: §5 (incl. inception, observation links, commitments, snapshots, recon, fund registry, same-org FKs)  
4. State machines: accounting FSM + detail publication — §4  
5. Contribution share: VERIFIED + nominal policy — §6  
6. Watcher + VERIFIED precondition + coalescing + inception — §7  
7. Evidence — §8  
8. Breath + accounting formulas (resource identity; budget.remaining) — §9  
9. Ideal annual budget — §10  
10. Runway as-of — §11  
11. Admin/audit — §12  
12. Privacy/publication — §§4.2,6,9  
13. Migration + merge-order — §13  
14. RLS/security + same-org integrity — §14  
15. R5-safe DB — §15  
16. Work packages — §16  
17. Validation — §17  
18. AC traceability — §18  
19. Out of scope — §19  
20. Human decisions — §20  

---

**Markers**

- First draft commit: `a95b9c1c27b9d98df66cfb944c292dd1967e5f5e`
- Architect correction commit: `a0f00846b55a53f1f9ecb2db8c9e6bef82a156e0`
- Final integrity / Human-approved architecture source SHA: `82377e4f4869b9bf64f26a9578c2335cdbcb8b15`
- Approval token: `CONFIRM-DEE-606-ARCHITECTURE-PLAN-82377E4F`
- `state.status`: **approved** (Architect review COMPLETE; Human architecture approval COMPLETE; WP-0 COMPLETE; WP-1 COMPLETE; WP-2 COMPLETE; currentWorkPackage WP-3)
- WP-1 validation: **DEDICATED_POSTGRES_VALIDATION_PASS** (`127.0.0.1:54339`; SHA `0df1b9698f1af27222c60bfb11191f0cf3f85676`)
- Migration reservation: **0148** foundation + **0149** RLS; merge-order gate still binding; DEE-518 local tip observed `0148_trader_forecast_v2_open_tail_null_bounds_v1`
- Binding gates preserved: DEE-518 migration merge-order; watcher ships DARK; HD-3 DEFERRED
- Prior Architect decisions remain intact: T3; Core Treasury domain; accounting/detail separation; VERIFIED accounting truth; contribution share; commitment facts; deterministic runway snapshots; no DEE-612/613 hard-coded doctrine
- `DEE_606_WP1_DEDICATED_POSTGRES_VALIDATION_PASS_WP1_COMPLETE_READY_FOR_WP2`
