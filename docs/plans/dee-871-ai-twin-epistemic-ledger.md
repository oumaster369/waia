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
    nextAction: "DEE-963 merged; DEE-965 owns the approved retention/experience foundation. Full persistence remains gated by shared migration compatibility, access/rights and historical-consent proof.",
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

## 2026-09-08 later Human approval and compatibility boundary

The earlier Proposed-only statements above and below are historical, not the current duration decision. After PR563 merged as 40669e6bea60ecb8fb0709c4bb72794d0b36157b, the Human explicitly accepted the recommended retention baseline and the three-layer inheritable-experience proposal. [Canonical Algorithm sections 6.1–6.3](../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md) now carries exact durations, anchors, conditional receipts and separate inheritance-release gates. This supersedes only the claim that no numerical/long-lived retention decision exists, not the remaining access, migration, operational-erasure or historical-consent gates.

[DEE-965](dee-965-ai-twin-lifecycle.md) owns one distinct, reversible inert lifecycle/experience foundation integration on dee-965-ai-twin-lifecycle from verified main. Original DEE-871 branch/history stays preserved. Full T3 persistence is not admitted by a policy test: read-only review found Trader's schema preflight fixes the maximum migration at 204 and rejects unknown applied hashes; its test consumes the entire shared journal. Do not register a new migration or change that Trader contract. Resolve the compatibility boundary separately before any shared registration/apply.

WP-1/2/3 and DEE-874/875/876 prerequisites remain incomplete. Persisted all-v1 objects, consent authority, transactional concurrency, both-tenant access, physical erasure/restore, legacy consent, and real integration tests still need proof. Isolated tests must never use an ambient/shared database. Default unit CI can skip Postgres tests; explicit isolated execution must be demonstrated, not inferred from a green suite.

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

### 2026-09-08 isolated WP-1b / WP-2 preparation admission

The Human's resumed implementation and later retention/experience approval permit local preparation, not shared migration registration or production use. This dated entry supplements the historical WP-1b packet; it does not replace the retention canon delivered by DEE-965. Primary unpublished continuation branch: `dee-871-ai-twin-repository`, created from verified `origin/main` `40669e6bea60ecb8fb0709c4bb72794d0b36157b` in its own worktree. The earlier Sep6 branch and WIP remain preserved. Rebase this unpublished continuation onto the DEE-965 squash before consuming its contracts. Keep one eventual DEE-871 integration PR; no partial Done or dependency discharge.

**Architect consultation / scope:** the Human explicitly authorized isolated implementation and scoped AI-TWIN merge, with AI-TRADER precedence. This authorizes the following synthetic, disconnected preparation only; unresolved production privacy choices, migration compatibility and T3 runtime admission are not inferred. Full DEE-871 remains T3. No runtime callers, shared schema/client/transaction runner, auth, environment loader, CI, migration journal or Trader files may change in this preparation.

**One owner:** the integrating agent owns all changed files; independent agents may only review. Expected surfaces: this existing plan, new `lib/ai-twin/model/persistence-contracts.ts`, new `lib/ai-twin/model/postgres-repository.ts`, `tests/unit/ai-twin-model-persistence-contracts.test.ts`, `tests/integration/ai-twin-model-repository.test.ts`, and its dedicated `tests/fixtures/ai-twin-model-repository.sql`. Reuse the merged kernel and lifecycle, do not duplicate or rewire the working legacy Twin persistence. Additional surfaces require a recorded admission amendment before editing.

#### Object / access / rights matrix to review before repository implementation

Every reference contains organization, subject, object kind, stable id and positive version; references are exact, not a guessed latest version. Every persisted sensitive object is bound to a current purpose, creation time and retention policy. Unknown historical permissions are quarantined, not retrospectively ratified. Neither content hashes nor scope strings authenticate a caller.

| Object family | Stored distinction / links | Lifecycle and release limit |
|---|---|---|
| Consent | Versioned source/purpose/disclosure/mode/issue/expiry/revocation authority | Server-supplied authenticated context; no LLM/body grant or historical opt-in; current authority checked within the same transaction as use |
| Observation | Self-report versus other future source kinds, event versus record time, context/projection, exact grant | Ordinary immutability; source/model-purpose withdrawal excludes use immediately; rights deletion removes affected content, not just projection |
| Claim / Human correction | Existing kernel's version, predecessor, evidence, status, Human endorsement versus truth | Compare expected revision, preserve ordinary conflicting history; content removal may erase historical dependent versions |
| EvidenceLink | Scoped versioned source/target; support, contradiction or contextual qualification | Referential closure and source eligibility; cannot keep a removed source alive through a derived summary |
| Hypothesis | Multiple explicit alternatives, support/contradiction, uncertainty, falsifier, validity and affected domains | Unconfirmed working retention uses substantial evidence anchor, never access/rephrasing; no invented calibrated score or automatic promotion |
| DynamicRelation | Typed Sigma/Delta/attractor/tension/temporal transition, endpoints, context/time, uncertainty | A proposed relation, not an intrinsic numerical personality property; endpoint rights propagate |
| KnowledgeNeed | Missing evidence/contradiction, reason, proposed observation, state and evidence refs | No unapproved planner weights; Human skip is not a readiness penalty; no collection authority |
| Formation / Health | Versioned evidence and requirement/policy references, explained states | Storage/reference support only; deterministic scoring and ratification engine belong to DEE-876 |
| Reflection / prediction / outcome | Uncertainty, expected versus observed, evidence/consent/stop-condition references | Storage/reference support only; DEE-875 owns reflection/experiment transitions, no real action permission |
| Private experience | DEE-965 Human-approved exact content fingerprint/version, provenance and independent archive purpose | Recheck current record rights and exact current sources; no inheritance/disclosure authority; no automatic TTL is not undeletability |
| Rights operation | Scoped request, affected purposes/records, dependency closure, immediate restriction, removal stage/retry/failure | Seven/thirty-day design deadlines share the same request anchor; physical-delete/backup proof never inferred from state flags |
| Export manifest | Requester, selected versioned records/provenance, exclusion reasons and 24-hour expiry | Private composition only; no delivery, third-party disclosure or legacy-release authority |

V2/V3-only LegacyDirective/DisclosureGrant/AlignmentContract/ActionCapability, and separately owned cost/price/subscription objects receive typed references only, never speculative schemas or activated permissions. Full v1 object coverage is an acceptance matrix, not a claim that the first fixture implements every downstream engine.

#### Minimal closed fixture scenario and negative evidence

1. In a dedicated empty local test database, persist a synthetic consented observation, competing interpretations and an explicit Human correction. Reopen another connection and prove provenance, ordinary version history and current projection survive.
2. Scope every read/write by both organization and subject. Prove cross-organization and same-organization/other-subject denial, including referenced endpoints, rights operations and retry keys.
3. Prove transaction rollback, conflicting idempotent retry rejection and concurrent revision protection. Database reads of current grants/rights and dependent writes must be serialized consistently; no network/provider work inside transactions.
4. Withdraw the observation's modelling purpose. Immediately deny model use/replay; execute explicit live-content removal and show dependent working content is absent from a second connection. An independently authorized private experience may survive only with genuinely independent eligible sources, not the removed observation.
5. Prove failed erasure remains restricted and retryable; stale pre-withdrawal content cannot be restored through an ordinary repository write. This proves only fixture live storage, not real backups, processors or end-to-end rights operations.

The PostgreSQL test must opt in with an AI-TWIN-specific explicit loopback URL and expected dedicated database name. Never use `DATABASE_URL_POSTGRES`, `DATABASE_URL`, existing integration/bootstrap commands, `.env` or an ambient/shared database. Use a uniquely named own container from an already available PostgreSQL image with loopback-only ephemeral port, no host data mounts and bounded resources; inspect only its own id and remove only that exact disposable target after validation. Never list/control another program's containers. Fixture SQL stays outside `db/migrations*` and is NOT an alternative production apply path or a reserved migration number.

**Validation order:** independent read-only review of this matrix; RED contract tests then limited implementation; focused unit and explicitly opted-in PostgreSQL fixture tests (including real behavioral RED for rights/scope); independent adversarial review; scoped format/lint/typecheck plus required PR readiness checks once the complete integration boundary is actually met. Exact commands: `pnpm exec vitest run tests/unit/ai-twin-model-persistence-contracts.test.ts`; then `WAIA_TWIN_PG_FIXTURE=1 WAIA_TWIN_PG_FIXTURE_URL=<own-loopback-fixture> pnpm exec vitest run tests/integration/ai-twin-model-repository.test.ts`. No implicit success when the fixture suite is skipped.

**Remaining gates:** shared migration/journal compatibility (Trader pins MAX=204), reviewed final access/schema/rights contract, full-v1 inventory, legacy quarantine/migration proof, downstream integration and operational erasure/backup evidence. Account deletion with an intentionally continuing legacy archive and any retained exception remain separate Human decisions. Stop at an actual unresolved gate, not merely because isolated preparation can continue safely.

- Observation never becomes interpretation or ratified claim by overwrite.
- No biometric material, connector credential or AI-TRADER domain state enters this ledger.
- Production migration apply and cutover remain Human-controlled.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/integration/isolation tests; `pnpm validate:canon`; PR governance.
