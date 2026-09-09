---
integrationIssue: DEE-871
integrationTitle: "AI-TWIN v1 — Epistemic ledger and Human-model persistence"
branch: dee-871-ai-twin-repository
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
    lastValidatedGitSha: 8c0fa8bebfe3beee666d62eb74d76c75d133efe0,
    lastValidationAt: "2026-09-09T08:42:14Z",
    blockedReason: null,
    nextAction: "Grounded candidate fixture reviewed. Resolve R1 retention classification before runtime admission; finish remaining v1/access contracts. Shared migration/auth integration remains separately coordinated; no Trader mutation.",
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

Actor matrix: an authenticated Human for the exact subject may authorize/revoke consent, correct, request rights operations and approve private experience/export composition. A model actor may only propose interpretations under current modelling permission. An organization administrator, another subject or a model has no implicit consent, correction, archive or export authority. Infrastructure erasure execution consumes an already authorized scoped rights operation; it cannot widen its targets. These are adapter preconditions, not authentication implemented by matching a string.

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

Model-purpose withdrawal and source deletion are separate commands: withdrawal removes affected modelling authorization/derived working content but may preserve the raw Diary only under its independently current raw-archive permission. Source deletion removes that selected source across affected purposes and its dependent content. Never silently turn withdrawal into either indefinite derived retention or deletion of independently authorized personal memory. Minimal rights-state transitions remain fail-closed: requested/restricted -> removal-pending -> live-removed; failure stays restricted and can retry. Live-removed does not mean backups/processor copies verified, and a retry never restores permission.

The PostgreSQL test must opt in with an AI-TWIN-specific explicit loopback URL and expected dedicated database name. Never use `DATABASE_URL_POSTGRES`, `DATABASE_URL`, existing integration/bootstrap commands, `.env` or an ambient/shared database. Use a uniquely named own container from an already available PostgreSQL image with loopback-only ephemeral port, no host data mounts and bounded resources; inspect only its own id and remove only that exact disposable target after validation. Never list/control another program's containers. Fixture SQL stays outside `db/migrations*` and is NOT an alternative production apply path or a reserved migration number.

Fixture guard additionally binds the URL's published port and database identity to the exact newly created container and run token. Before fixture DDL/cleanup, verify `current_database()`, current role and a dedicated database marker installed during creation of this own disposable target. A loopback host plus a familiar database name alone is insufficient authority for destructive cleanup. The suite fails if explicitly opted in but identity/marker/URL is missing or mismatched; skip is allowed only when not opted in.

The rights restriction must commit separately before attempted physical cleanup, survive cleanup rollback and deny stale writers/replay. Synthetic fixture receipts/fences are discarded with the exact temporary database at test completion; they are not a permanent production tombstone policy. Any future retained identifiers/fingerprints require an independently reviewed bounded purpose and access/expiry contract. The independent read-only reviewer accepted this disconnected scope and object matrix, with the actor, source-versus-purpose, durable restriction and exact fixture-identity clarifications incorporated before code.

#### Private archive fixture substep — review before implementation

Reuse DEE-965's exact Human composition contract. The fixture owner seeds explicitly synthetic, scoped/versioned archival authorizations and lifecycle records; the repository cannot create or expand these permissions. A Human-only private-source write represents a separately authorized direct Human declaration, never automated promotion of a dialogue, extraction or model summary. A Human-only experience write/read revalidates exact content approval, current record authority, each persisted private source and its current authority under the same scope lock. All authority writers, including new versions, must join that lock. No archive data is admitted to the current model, search, disclosure or transfer by this substep.

Extend only the already admitted fixture/repository/test surfaces: one fixture archival-authority table and a `private_source` object kind. Rights requests gain an explicit scoped target kind. Source deletion may remove that source and its dependent experience; modelling withdrawal removes only its working-purpose graph. If a withdrawal encounters an unqualified mixed-purpose dependency, leave use restricted and fail cleanup for review rather than erase private memory or infer a retention exception. The positive scenario preserves an independently authorized private experience with an independent Human source when unrelated modelling evidence is removed. Negative scenarios deny model actors, wrong-scope authority, revoked/deleted archive sources and attempts to use archive retention as model/transfer permission. Private experience export/delivery, revisions beyond the admitted initial record, auth routes, real Diary UX, complete object inventory and shared migration qualification remain unfinished.

This is a coherent unpublished DEE-871 work package, not another partial PR. A fixture with explicit trusted seed authorities proves repository behavior only; it does not prove real Human authentication, legal basis or a production consent-ingestion/retention service.

Independent substep review requires kind+id+scope in every rights predicate (including same-id/different-kind fixtures); only existing exactly versioned authorized private sources, never an observation relabeled in a draft; initial-only immutable writes with conflicting retry denial; current authority checked on reads as well as writes and serialized with every authority writer. These checks are part of acceptance before claiming the private archive fixture complete. The larger local diff remains one coherent evidence/rights fixture with substantial negative-test coverage; it is not integration-ready or an exception to final reviewability, migration and runtime gates.

**Validation order:** independent read-only review of this matrix; RED contract tests then limited implementation; focused unit and explicitly opted-in PostgreSQL fixture tests (including real behavioral RED for rights/scope); independent adversarial review; scoped format/lint/typecheck plus required PR readiness checks once the complete integration boundary is actually met. Exact commands: `pnpm exec vitest run tests/unit/ai-twin-model-persistence-contracts.test.ts`; then `WAIA_TWIN_PG_FIXTURE=1 WAIA_TWIN_PG_FIXTURE_URL=<own-loopback-fixture> pnpm exec vitest run tests/integration/ai-twin-model-repository.test.ts`. No implicit success when the fixture suite is skipped.

**Remaining gates:** shared migration/journal compatibility (Trader pins MAX=204), reviewed final access/schema/rights contract, full-v1 inventory, legacy quarantine/migration proof, downstream integration and operational erasure/backup evidence. Account deletion with an intentionally continuing legacy archive and any retained exception remain separate Human decisions. Stop at an actual unresolved gate, not merely because isolated preparation can continue safely.

#### 2026-09-08 local preparation receipt — not integration readiness

DEE-965 merged in PR564 as `655f0f80178ca70ce5b08cd9f0164e9ecff76c7e`. This unpublished continuation was rebased onto that verified main; the earlier Sep6 worktree and unrelated work remain untouched. Reviewed implementation head: `43b08fdf514675bc5104842c47c4f187d8446b7c`. Only the six surfaces admitted above differ from main. There is no runtime caller, shared migration/journal registration, push or PR for this partial DEE-871 package.

- Cumulative targeted validation: **93/93 passed**, comprising 13 explicitly opted-in real PostgreSQL fixture scenarios, 35 kernel, 35 lifecycle and 10 persistence-contract unit tests. The PostgreSQL tests used only a newly created resource-bounded loopback container with synthetic content, no host data mount, verified database/role/port and run marker. This is not production RLS, real authentication or operational erasure proof.
- Behavioral RED/fix evidence includes expired observation replay (1 failed / 8 passed before the fix) and concurrent consent-version revocation (1 failed / 10 passed before consistent scope locking). Exact duplicate hypothesis alternatives also had a failing assertion before the correction. Initial repository and private-archive REDs were missing-feature failures, not proof that all behavioral tests first failed.
- Private archive checks cover current scoped authority on reads/writes/retries; same-id/different-kind rights targets; refusal of model actors, relabeled observations and conflicting content; preservation of independently authorized private experience after unrelated modelling withdrawal; failure-closed mixed-purpose cleanup; source deletion and dependent-content removal. The explicit 2046 test clock proves absence of an automatic policy TTL only, not twenty years of physical durability. No archive permission becomes modelling, disclosure or inheritance-release permission.
- Independent read-only review read the complete six-file diff at the exact implementation head, independently passed **80/80 unit tests**, and reported no remaining concrete P1/P2 within this disconnected scope. It did **not** rerun the 13 PostgreSQL scenarios. Full v1 inventory, runtime integration and production admission were explicitly not approved by this review.
- Scoped ESLint and TypeScript passed; `pnpm validate:canon` passed its regressions, 149 tracked canonical files and release-identity check; `git diff --check` passed. No full unit CI, build, browser or production-readiness claim is made for this unpublished package.
- An additional deliberately wrong run-marker invocation rejected before fixture DDL (`Fixture marker mismatch`, all 13 scenarios skipped). A subsequent direct read of the exact own database confirmed the fixture schema absent. This expected negative safety check is separate from the 93 passing functional tests.

DEE-871 remains **In Progress**, WP-1/2/3 incomplete and downstream dependencies unchanged. Next independently safe work is the remaining v1 object inventory and reviewed access/rights/storage and historical-consent quarantine contracts; shared registration must separately resolve the MAX=204 compatibility boundary without changing Trader from this task. No partial-PR split, automatic legacy opt-in, production data collection or operational retention promise is authorized by this receipt.

- Observation never becomes interpretation or ratified claim by overwrite.
- No biometric material, connector credential or AI-TRADER domain state enters this ledger.
- Production migration apply and cutover remain Human-controlled.

## Validation matrix

### 2026-09-09 continuation admission — historical-source quarantine planner

Human requested continued implementation and particular care for a clear, usable dashboard. The new UI must explain source versus interpretation, correction and permissions without inventing server authority; DEE-879/881 remain the UI owners and are not activated by this storage preparation. Current verified main is `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67`; own clean unpublished branch was rebased onto it. Open PR567 is Trader/shared-auth work and remains outside this task's mutation scope.

Continue the already admitted historical-consent preparation with a **pure metadata-only quarantine planner**, not a database import or user-facing claim of completed migration. Additional owned surfaces admitted before implementation: `lib/ai-twin/model/legacy-quarantine.ts` and `tests/unit/ai-twin-model-legacy-quarantine.test.ts`. Existing shared schema, journal, authentication, runtime routes, sources mirror, UI and Trader files remain unchanged. No database, containers or provider calls are needed for this step.

Input is a trusted adapter's scoped inventory of exact legacy source identities/revisions, original creation timestamps and source kinds (dialogue, Diary, readiness snapshot, prediction, verification, embedding). Never accept raw text, profile values, vectors, credentials, consent flags or requested authority. Validate plain JSON and exact fields before access; reject malformed, foreign-scope and duplicate identities atomically. Preserve original timestamps including unknown time; inventory must not restart a retention clock. No fingerprint of private content is created.

Every valid item remains excluded from the new model. Direct dialogue/Diary sources need current source/purpose/retention review and explicit authorized selection before any separately implemented import. Legacy readiness is not new Formation evidence; legacy predictions/verifications need separately reviewed provenance and cannot be silently promoted to a calibrated loop; embeddings are non-authoritative indexes. This planner never grants consent, imports records, adjusts Formation, creates an archive, deletes legacy data or claims quarantine was applied to storage. Quarantine planning itself is not a retention exception; future runtime storage/rights review must establish any inventory lifetime.

Acceptance for this bounded substep: deterministic immutable scope-bound manifest with explicit `plan_only`, no model-use/import/formation/archival/disclosure authority and item-level reason codes; synthetic tests for every kind, foreign scope, duplicate and delimiter-collision identities, malformed time, untrusted extra fields/getters/cycles/sparse arrays, no TTL reset and no automatic permission from legacy values. Red test first, scoped lint/typecheck, cumulative model unit tests, canon validation and independent read-only review. The existing 13 PostgreSQL tests remain Sep8 evidence and are not counted as newly executed here. Full DEE-871 and all three work packages remain incomplete.

#### Remaining object-contract substep — relations and knowledge needs

Continue the existing object matrix within `persistence-contracts.ts` and its unit test only. Promote the reference-only DynamicRelation and KnowledgeNeed shapes to pure validated candidates, with creation time and explicit retention-policy identity. Dynamic relations remain proposed/contested/withdrawn, never intrinsic or calibrated personality facts. Require context, uncertainty, valid time interval, scoped unique eligible endpoints and no self-reference. Knowledge needs carry reason, proposed observation, state and exact eligible evidence; open unknowns may have no evidence, while a resolved state must reference evidence. Validation of a state is not permission to change it or proof that its meaning was verified. Human skipping, resolution, planner selection and question-generation transitions remain in their downstream owners.

For both, the caller must supply a current trusted purpose/policy and eligible versioned source set; equality checks do not authenticate consent or prove retention eligibility. No policy duration, score, new inference category or collection permission is introduced. Reject undeclared fields/getters/sparse arrays before inspection, unsupported object kinds, scope/purpose/policy mismatches, unavailable versions, duplicates and self-links; return deeply immutable independent candidates. These are local shape/lineage contracts only, with no new persistence or runtime caller. RED tests, targeted cumulative unit checks, scoped lint/typecheck and independent review are required before a validation receipt. This does not qualify the rest of the all-v1 inventory or DEE-871 completion.

`pnpm lint`; `pnpm typecheck`; focused unit/integration/isolation tests; `pnpm validate:canon`; PR governance.

### 2026-09-09 validation receipt — local preparation only

Own branch based on verified main `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67`, no conflicts during unpublished rebase, no other worktree changes. Plan-before-code commits: `50f8690a` (quarantine) and `091f7dbc` (relation/knowledge contracts). Reviewed quarantine head `b423c3d18197feec9116af621593a08b03099228`; final code head `3777e51d5ea22ff589383c2845b1ba0b9b6f46f5`.

- **106/106 cumulative unit tests pass**: kernel 35, lifecycle 35, persistence contracts 22, quarantine 14. Quarantine RED was a missing module with zero assertions; relation/knowledge RED had 10 failures caused by missing functions, not a demonstrated semantic regression. A later test-only TypeScript fixture error was corrected, then typecheck and scoped ESLint passed. No test or production check was weakened.
- Independent read-only review independently reproduced 14/14 quarantine and 22/22 contract tests, read the exact admitted diffs, and reported no remaining concrete P1/P2 in those local scopes. It did not rerun the full 106. The previous PostgreSQL suite was not rerun or counted as current evidence: no SQL, repository behavior or existing hypothesis validator was changed in this substep; no database or container was accessed.
- Canon validation passed regressions, 151 tracked canonical files and release-identity validation; scoped diff checks and clean-worktree checks passed. No full PR CI, new build, browser or production-readiness claim. Runtime import search confirms the added entry points appear only in their modules/tests.
- `plan_only` quarantine is not applied to storage, deletion, a retention extension or an import permission. Source dates/unknowns survive unchanged; old readiness and verification cannot grant Formation credit.
- Candidate validation is not semantic verification: available evidence alone does not resolve a question or establish a Sigma/Delta/tension. State changes and kind-specific meaning remain downstream. Historical relation intervals are accepted as records, not current-use authority. Scope/purpose/policy equality cannot authenticate a person or approve a policy.
- Read-only UX review was recorded in DEE-879 comment `4c9d1cf8-d158-4abe-885e-ea3680aa3fab`: concrete proposed keyboard/mobile/error/correction/permission acceptance checks. It neither implements the dashboard nor changes DEE-879/881 dependency gates or ratifies a layout.

Eight files currently differ from main, all within this one unpublished storage-preparation package. It exceeds the approximate line-count target, substantially through synthetic negative tests; one model/persistence rollback boundary and eight-file ownership keep local review tractable, but this is **not** final PR-size approval. Final integration review must decide whether the complete acceptance scope remains reviewable; do not grow or publish an unreviewed monolith or create a second PR on DEE-871. No PR/merge or Done transition occurred on this continuation.

The shared migration boundary is unchanged at this main: Trader pins MAX=204. Its current PR567 also owns shared authentication work. Neither surface may be altered here. Isolated preparation is not globally blocked by those facts, but full runtime/production completion cannot be claimed before final object/access/rights contracts, separately admitted schema/auth integration, complete user journeys and operational erasure/backup qualification.

### Grounded relation / knowledge storage fixture — admission before implementation

Following the Human's instruction to continue, the next bounded scenario consumes the already reviewed relation/knowledge validators in the disconnected repository. Only existing `postgres-repository.ts`, fixture SQL and its integration test, plus this plan, may change. No shared schema/journal, consent creation, auth, runtime callers, application UI, environment loaders, provider or Trader surfaces. Full DEE-871 remains T3 and incomplete; this local fixture admission is not a new production schema or access approval.

Store initial model-proposed relations (`proposed`) and grounded knowledge needs (`open`) with exact version 1 and current purpose/policy/clock binding. Require nonempty currently eligible observation/current-claim references in this first persistent slice; an in-memory open unknown may still have no evidence, but persistence of such an ungrounded need requires the future explicit purpose-authority contract and is not silently inferred here. Human decisions, `resolved`/`skipped`, relation endorsement, revisions and multi-hop relation/need grounding remain downstream/unimplemented. Do not fabricate consent or use archive authority as modelling permission.

Every read/write/retry uses the existing short per-subject transaction lock and authoritative current source eligibility. **Fixture-only Proposed classification:** exercise the existing model-retention helper with a creation-anchored annual necessity review; the canon has not yet classified initial proposed relations/open needs as long-lived model rather than unconfirmed working hypotheses. This does not ratify that mapping or permit production storage. Current dialogue/current-claim evidence eligibility independently bounds every use and must never be extended by the candidate lifetime; no caller-controlled anchor. Refuse current use when the relation interval has ended, sources are unavailable or the fixture model review is due. A shape-valid candidate is not a verified relationship or resolved question. Immutable content plus scope/purpose/request-bound fingerprint receipts prevents conflicting retries; semantically identical JSON key ordering must not cause a conflict. Clock rollback must not admit a new record. No external work inside a transaction.

Extend only the fixture object-kind allowlist with `relation` and `knowledge_need`; retain existing scoped composite foreign keys and least-privilege roles. Persist typed provenance edges to each source. Source rights restriction must hide dependent candidates before deletion and deny replay; explicit cleanup must physically remove them and their links/receipts. Withdrawal's working-purpose allowlist includes the two new kinds, never private archives. Independent sources/other subjects stay untouched. No temporary-data operation touches another database/container.

Acceptance: real opted-in PostgreSQL tests for cross-connection persistence, exact source versions/current Human correction, own-scope and wrong-purpose denials, non-model actor/unknown kind/status/ungrounded admission denial, deterministic idempotency/content conflict, expiry/revocation read-and-replay refusal, and rights closure with physical deletion. Re-run the entire existing fixture and cumulative model units, scoped lint/typecheck/canon and independent read-only review. Create only an exact own resource-limited loopback container from the existing Postgres image, bind DB/role/port/token before DDL, remove only that own target afterwards. Full UI/auth/backup/production qualification is excluded. This adds one coherent scenario to the unpublished eight-file package; final integration-size review remains mandatory rather than automatically waived.

#### Grounded fixture validation and pending Human decision R1

Implementation/review head `8c0fa8bebfe3beee666d62eb74d76c75d133efe0`. Admission `a9292ff4` was clarified by `fd718ccf` **before code** after independent review identified that the relation/need retention classification was not ratified. Four admitted files changed in this substep, no shared migrations or production callers.

- Initial RED: 13 existing PostgreSQL scenarios passed, 2 new scenarios failed at an explicit missing-method assertion. This proves absent functionality, not a prior semantic failure. Final cumulative **122/122 pass**: 16 actually executed PostgreSQL scenarios + 106 model units. The new tests verify separate-connection persistence, canonical-key-order retry, changed-content rejection, source revision correction, scope/purpose/policy/actor checks, expired source/interval denial, backward-clock rejection, newer consent revocation, separately committed restriction and cleanup failure/retry with dependent links/receipts removed.
- TypeScript, scoped ESLint, diff checks and canon validation (151 files plus regressions/release identity) passed. Independent read-only review found no remaining concrete P1/P2 within the disconnected substep; independently passed 22 contract tests, but did not run PostgreSQL or the cumulative122. Annual necessity-review blocking is inspected, not separately reached by a PG fixture with still-eligible year-old evidence. No auth, full-v1, UI, operational backups or production qualification is implied.
- Own resource-limited Postgres16 fixture was verified by exact container id/loopback port/database/role/run marker before DDL. Post-run verification confirmed its fixture schema absent. No user/shared/Trader data, processes, worktrees, PRs, settings or migration journal were modified. Supabase/Postgres guidance informed short transaction-scoped locking and preserved least-privilege/scoped-FK boundaries; no Supabase feature, service, deployment or advisor call was activated.

**R1 — Proposed, awaiting Human classification:** treat unconfirmed proposed relations and open knowledge needs as working hypotheses, with the approved working-memory rule of 90 days from creation or independently verified substantial new evidence; rereading, rephrasing or retry must not reset the clock. Human-selected private lived experience remains under its separate archive authorization with no automatic TTL. This proposal does not automatically promote a confirmed relation into permanent storage, resolve a need or preserve deleted sources. It replaces the fixture-only annual-review experiment only after explicit Human approval and implementation/verification. No runtime/storage release may use the unratified fixture mapping. Other isolated preparation is not globally blocked by R1, but deciding its product/privacy meaning belongs to the Human.
