---
integrationIssue: DEE-871
integrationTitle: "AI-TWIN v1 — Epistemic ledger and Human-model persistence"
branch: dee-871-ai-twin-epistemic-ledger
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, integration, canon, pr-governance]
approvalGates: [plan-approved, migration-reviewed, human-merge]
includedIssues: []
state:
  {
    status: in-progress,
    currentWorkPackage: WP-1,
    completedWorkPackages: [],
    remainingWorkPackages: [WP-1, WP-2, WP-3],
    prNumber: null,
    prUrl: null,
    lastValidatedGitSha: b1b62b058a754bfa7b2f729fd02458c582cade68,
    lastValidationAt: "2026-09-06T12:58:00Z",
    blockedReason: null,
    nextAction: "DEE-963 owns the distinct inert WP-1a integration; continue WP-1b reviewed policy/object design without persistence or runtime wiring before its privacy/migration gates are satisfied.",
  }
provenance:
  {
    createdFrom: ROADMAP-AI-TWIN,
    gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md,
    supersedes: null,
  }
---

# DEE-871 — Epistemic ledger and Human-model persistence

## Approved outcome

An append-only, tenant-isolated persistence layer represents observations, provenance/projection, evidence links, versioned claims, dynamic relations, hypotheses, knowledge needs, consent and Human corrections without cutting over legacy readiness.

## 2026-09-08 integration handoff

The historical DEE-130/start wait is satisfied: the canon is merged and the Human resumed implementation. The Sep6 WP-1a admission and receipts below remain historical; they did not qualify full persistence. New [DEE-963](dee-963-ai-twin-epistemic-kernel.md) owns one distinct T1 integration for the already admitted inert kernel, reusing b1b62b058a754bfa7b2f729fd02458c582cade68 from a new verified-main worktree. This later scoped admission replaces only the earlier instruction to keep WP-1a unpublished until all of DEE-871 is ready. It does not relax any persistence, privacy, migration or production gate.

DEE-871 stays In Progress with WP-1/2/3 incomplete. Its parent-level dependencies for DEE-874/875/876 are not discharged by DEE-963. The proposed policy matrix below remains unratified; no retention duration or permanent retention is inferred from resumption. DEE-963 carries its own current exact-head proof and closeout.

## Work packages

### WP-1 — Object and migration design

Freeze typed objects, lifecycle states, retention/export/deletion and append-only migration contract.

#### Admitted WP-1a — inert correction kernel (2026-09-06)

DEE-130 is merged and the Human explicitly resumed autonomous Twin implementation. Base: bf1872160bbdd49ddc2af6d6e566ba1209a6702a. This file and new lib/ai-twin/model/\*\* plus its focused unit test have one owner in the separate dee-871 worktree. PR556 remains frozen; no new PR until this issue's integration boundary is ready.

Implement only a pure, in-memory reference transition kernel for a consented self-report -> proposed claim -> explicit Human correction -> current-model projection. Evidence never becomes a verified fact by changing a label; active/ratified means Human-endorsed, not objectively true or calibrated. Preserve old versions, uncertainty and source references; refuse stale revisions, conflicting retries and cross-organization/cross-subject references. Unknown, expired or revoked modelling consent excludes observations and derived claims from use. Treat an expired/revoked grant as a use restriction, not proof of physical deletion.

The caller must supply authenticated actor/scope, trusted current consent state and time. These inputs are a server-adapter contract, never body/LLM claims. This kernel is not an auth guard, RLS proof, persistent store, provider, endpoint, migration or complete epistemic loop. No production imports or runtime wiring. Fixture content is synthetic and remains local. No clocks, network, environment reads, logging, embeddings or new sensitive inference.

WP-1a does not complete WP-1 or DEE-871. Remaining WP-1b must freeze all canonical v1 objects and reviewed retention/export/deletion semantics before WP-2: exact raw/derived/audit/backup lifetimes, rights propagation, historical consent migration, access policy and disclosure remain explicit review gates. Do not invent durations, auto-opt users into modelling or treat hashes/tombstones as anonymous. Production apply remains separately Human-controlled.

Validation: red regression first, focused deterministic tests including model-actor correction denial, stale revisions, replay conflicts, revoked/expired/missing consent, source lineage, both tenant dimensions and immutable prior versions; scoped lint/format/typecheck and independent read-only review. Do not claim PostgreSQL or end-to-end UI qualification from this kernel.

##### WP-1a local validation receipt

Implementation commit: b1b62b058a754bfa7b2f729fd02458c582cade68. New files only: lib/ai-twin/model/contracts.ts, lib/ai-twin/model/ledger.ts and tests/unit/ai-twin-model-ledger.test.ts. No runtime imports outside the module/tests; no database or deployment changes.

- Initial RED was a missing-module import failure, not a run of behavioral assertions. After implementation, 20 focused tests passed.
- Independent read-only review reproduced a sparse-array evidence bypass: a proposed claim could pass without a real Observation. A second regression covered undeclared nested payload fields. Both failed against the pre-fix kernel (22 tests, 2 failed), then passed after dense-array and exact-key checks.
- Final focused suite: 22/22 pass; scoped ESLint: zero warnings/errors; TypeScript and scoped formatting pass. Canon validator regression, 131 tracked canonical documents and release-identity validation pass on this verified-main-based worktree. These counts do not include the still-unmerged PR556 documents.
- Independent review rechecked the sparse-array reproduction and found no remaining concrete findings. It did not independently rerun the complete focused suite. This is not proof of exhaustive correctness, HTTP input safety, authentication, PostgreSQL RLS, retention/deletion, competing hypotheses, calibration or a finished user interface.
- ModelContext remains a trusted future server-adapter input. A matching actor/subject string is not authentication. Consent availability filters use; immutable in-memory history is not a physical-deletion mechanism. Human endorsement is not objective truth.

WP-1 remains incomplete; no PR or Done transition is justified by WP-1a alone.

#### WP-1b policy and object-design review packet — Proposed, not Ratified

This section records the unresolved persistence boundary, not a new product/privacy decision. The source baseline is the existing [Canonical Algorithm](../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md), sections 2.1, 2.2, 2.5, 3 and 6. The approved semantics are scoped/versioned/revocable consent, provenance, private-by-default Diary modes, explicit Human corrections and subject access/export/deletion. They do not establish numerical lifetimes or indefinite retention.

| Data class | Existing requirement | WP-1b decision still required |
|---|---|---|
| Raw dialogue/Diary observations | Distinguish source and interpretation; modelling requires suitable consent | Retention trigger, default/max lifetime, source granularity, relationship between keeping a private Diary entry and withdrawing modelling consent |
| Claims, hypotheses and corrections | Versioned, evidence-linked and Human-correctable; no silent overwrite | Effects of source deletion on dependent versions, snapshots and indexes; when removal rather than ordinary historical revision is required |
| Consent and rights records | Purpose, source/disclosure scope, version, expiry and revocation | Minimal retained receipt, separate purpose/access/lifetime; no assumption that identifiers or hashes are anonymous |
| Operational/privacy audit | Evidence of safe operations without unnecessary personal content | Allowed fields, access, lifetime and any justified exceptions; no raw dialogue or model text in routine logs by default |
| Exports, caches and indexes | Subject access/export; embeddings are non-authoritative | Package contents/versions, third-party information, verified recipient, delivery/expiry and deletion propagation |
| Backups and processor copies | Privacy obligations cannot be discharged by filtering one read model | Inventory, maximum expiry, deletion propagation/retries and restore-time re-deletion before restored content becomes usable |

Recommended operation separation for review: ordinary correction appends a new version; withdrawal/revocation immediately excludes affected evidence from modelling and requires an erasure/remaining-purpose assessment, not indefinite retention pending a second deletion request. Source/account deletion explicitly starts the approved removal lifecycle across authoritative records and derivatives. A use-filter, tombstone or fingerprint must not be presented as completed deletion. Exact deadlines, independently established retention grounds, retained exceptions and legacy-consent migration remain unresolved, not inferred approvals. The biometric D3 EPHEMERAL-NO-TEMPLATE decision does not define the Human-model ledger's lifetime.

External EU/EEA design check (read 2026-09-06, not a WAIA legal-compliance certification): the [European Commission's consent guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en) explains that withdrawal requires deletion unless another legal ground permits processing, and distinguishes multiple purposes. Do not silently switch the Human model to a different basis after withdrawal. The [EDPB's 2026 erasure report summary](https://www.edpb.europa.eu/news/edpb-identifies-challenges-hindering-the-full-implementation-of-the-right-to-erasure_en) flags retention periods, backup deletion and ineffective anonymisation as recurring implementation difficulties. Neither source ratifies a WAIA lifetime or proves that a future vendor setup satisfies these requirements; the deployed policy and implementation require review.

The next object-design pass can specify IDs, scope/version references, source kinds, event/observation time, explicit purpose/policy references, typed provenance links and the canonical distinction between observation, claim, hypothesis and correction using synthetic data. This does not authorize persistent collection. WP-2 requires one reviewed matrix covering the six classes above, an access/export contract, historical consent handling and a migration review; production application remains separately Human-controlled.

### WP-2 — Persistence and read models

Implement schema, repositories and current-model projections; embeddings remain non-authoritative indexes.

### WP-3 — Isolation and migration proof

Prove tenant isolation, version history, idempotency and safe legacy/backfill hooks.

## Safety invariants

- Observation never becomes interpretation or ratified claim by overwrite.
- No biometric material, connector credential or AI-TRADER domain state enters this ledger.
- Production migration apply and cutover remain Human-controlled.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/integration/isolation tests; `pnpm validate:canon`; PR governance.
