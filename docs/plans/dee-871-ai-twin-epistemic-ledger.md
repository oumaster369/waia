---
integrationIssue: DEE-871
integrationTitle: "AI-TWIN v1 — Epistemic ledger and Human-model persistence"
branch: dee-871-ai-twin-canonical-continuation
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
    lastValidatedGitSha: 90dd0a3d48a697fe6d188ca3041330cacb671116,
    lastValidationAt: "2026-09-14T08:41:02Z",
    blockedReason: "RightsOperation still needs exact Human decisions for valid cancellation transitions, FAILED retry semantics, type-specific target/effect contracts and minimal receipt retention before a deterministic record/state machine can be implemented.",
    nextAction: "Obtain the remaining RightsOperation semantic decisions, then admit its pure append-only lifecycle contract. Do not start shared migration/schema, Trader compatibility, runtime writers, Society, deployment or the final integration PR.",
  }
provenance:
  {
    createdFrom: ROADMAP-AI-TWIN,
    gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md,
    supersedes: null,
  }
---

# DEE-871 — Epistemic ledger and Human-model persistence

## 2026-09-14 canonical continuation — annual necessity-review contract

Recovery established one writable continuation at
`dee-871-ai-twin-canonical-continuation`, clean from verified `origin/main`
`c6f79636b4aff2f0bf170b4357db7bb0d2abcb73`. Earlier DEE-871 worktrees remain
read-only forensic sources: the ledger and repository branches are superseded by
merged DEE-963/973 foundations, while `dee-871-ai-twin-shared-boundary` at
`7802b39474f0126c8ef00655ebec2bad41bc093b` contains valid but unmerged,
unmounted WIP. None is a continuation location.

AI-TRADER PR #590 subsequently merged to `origin/main` as `d7d5941a`; its child
PRs #585–#588 remain foreign. The continuation integrated only that fresh main
commit at the accepted checkpoint boundary. The shared boundary remains frozen:
no numbered migration, journal entry, `db/schema.postgres.ts`, Core/auth
contract, Trader path/test/preflight, runtime route or production configuration
is admitted.

### Continuation matrix

1. **WP-1 — object/lifecycle/access contract.** The merged DEE-963/973/965
   foundations and current AI-TWIN model modules are authoritative. The
   Human-controlled annual necessity-review slice below is committed as stable
   checkpoint `99d98b1647c5b31751b855076cd8fab7a700f4f0` but not merged. WP-1
   remains incomplete until the complete v1 persisted inventory,
   temporal/source qualification, historical-consent treatment and final
   access/rights contract are reconciled without importing superseded branch
   state wholesale.
2. **WP-2 — persistence and current-model reads.** The current disconnected
   repository/fixture on main is authoritative for merged behavior.
   `dee-871-ai-twin-shared-boundary` is a read-only source for coherent,
   unmerged authenticated-member, consent, observation, claim revision,
   correction and selected live-erasure work. Each future slice must be
   re-admitted and ported onto this continuation. Shared schema registration,
   migration journal ordering and runtime mounting remain blocked by the
   AI-TRADER collision boundary; the old branch itself must not be merged.
3. **WP-3 — isolation, legacy migration and cutover proof.** Not complete.
   Production currently has three non-equivalent concepts: legacy
   `{0,33,67,100}` readiness, the separate reasoning-maturity heuristic and the
   ratified evidence-state Formation/Model Health model. The readiness writer is
   default-off, and no authoritative write API completes the legacy
   `socializationCompleted` transition. These are migration/qualification
   evidence, not authority to enable a writer, invent socialization persistence
   or collapse the models. Society remains a separately gated v3 concern.
4. **Peripheral recovery evidence.** DEE-605 homepage visuals, DEE-784 “My
   Twin” navigation restoration and DEE-799's old Twin facade/proxy harness may
   inform later UX/runtime qualification. Their gone/stale branches are neither
   DEE-871 continuation sources nor evidence that canonical persistence,
   readiness migration or socialization writes are complete.

### Selected bounded work package

The Human-ratified 2026-09-12 rule is the next isolated WP-1 retention/rights
qualification:

- WAIA prepares the annual storage-necessity review and the Human confirms it.
- First Human endorsement creates the initial model-class review anchor but is
  not itself a necessity-review confirmation.
- A later review binds an exact organization, subject, model record and positive
  version, plus explicit Human actor, preparation time and confirmation time.
- When review is overdue, the affected record is excluded from new inference and
  advice. This is neither automatic deletion nor permission for indefinite
  pending retention.
- Human access, correction and deletion remain separate rights paths and are not
  blocked by this productive-use assessment or by subscription state.
- Confirmation does not renew consent, restore removed evidence, establish
  truth, promote an archive, refresh evidence or widen purpose.
- Current authorization and evidence eligibility remain mandatory after review.
  No grace period, default waiting duration, deletion deadline or retained
  receipt exception is introduced.

Owned files are this plan, the Product Constitution, the Canonical Algorithm,
the AI-TWIN v1 gap registry, `lib/ai-twin/model/lifecycle.ts` and
`tests/unit/ai-twin-model-lifecycle.test.ts`. The implementation remains a pure,
disconnected policy contract with no caller or persistence adapter added.

Acceptance requires an explicit missing-behavior RED, exact one-year boundaries
before/at the due instant, exact record/version and both-tenant dimensions,
Human-only confirmation, chronology, immutable source authorization, overdue
productive-use denial, independent rights metadata, and negative proof against
consent/evidence revival, archive promotion, automatic removal deadlines,
getters and undeclared authority fields. Validation is the focused lifecycle
unit suite, cumulative AI-TWIN model units, scoped lint/typecheck, canon
validation, diff checks, then repository PR-readiness checks only if this
bounded package remains collision-free.

### Implementation and local validation receipt

The required RED failed seven focused cases while the old policy still returned
`retain` and allowed productive use after the annual due instant. The bounded
implementation now requires a canonical Human-only confirmation with a reviewed
policy version, preparation/confirmation chronology, both tenant dimensions and
exact record/version binding. Initial endorsement is an explicit inherited
model-class receipt in separately supplied trusted lineage; ordinary record
revision cannot carry or refresh it. At the due instant, otherwise-authorized
knowledge returns `human_review_required` and
`purposeUseAllowed: false`, with no expiry or removal target. Removal caused by
withdrawn purpose, ineligible evidence or erasure remains higher priority.
Rights are reported as a separate assessment.

The existing retention policy identifier remains
`human-approved-2026-09-08/v1`; the new review receipt has the separate
`human-approved-2026-09-12/v1` identifier. This avoids treating annual review as
consent renewal or invalidating existing purpose grants.

Independent review initially found two P2s: the ordinary-record input could
carry a refreshed initial anchor, and Constitution wording could be read as
blocking first-year use. The implementation now accepts annual lineage only
through a separate exact `ModelNecessityReviewState` trusted-adapter contract,
rejects record-level anchor/review metadata, and the Constitution pauses use
only once the interval is overdue. Focused re-review found both resolved and no
remaining concrete P1/P2. The adapter must still obtain that lineage from an
authoritative immutable source; this pure policy function does not authenticate
or persist it.

Validated on the uncommitted continuation diff over exact base
`c6f79636b4aff2f0bf170b4357db7bb0d2abcb73`:

- focused lifecycle GREEN: 48/48;
- cumulative AI-TWIN model units GREEN: 185/185;
- changed-file ESLint GREEN;
- `pnpm typecheck` GREEN;
- `pnpm validate:canon` GREEN, 173 canonical files checked;
- `pnpm lint` GREEN;
- `pnpm build` GREEN, with only the pre-existing Next.js middleware convention
  deprecation warning;
- `git diff --check` GREEN.

Immediately before PR-readiness validation, `origin/main` remained the exact
base SHA and open AI-TRADER/research PRs #585, #586, #587, #588 and #590
remained foreign. No merge/rebase was necessary. No shared migration, journal,
Postgres schema, Trader preflight/test, runtime, environment, deployment or
Society surface changed.

### Stable checkpoint and fresh-main synchronization

The Human accepted the annual necessity-review slice as a stable WP-1
checkpoint. It was committed without unrelated history as
`99d98b1647c5b31751b855076cd8fab7a700f4f0` and then rebased as the single
unpublished DEE-871 commit onto fresh `origin/main`
`d7d5941a995b83473acb6e00c42d5252c44b2303`, which contains merged AI-TRADER PR
#590. The upstream change touched only foreign Trader/shared migration surfaces
and did not overlap the six-file annual-review checkpoint. The rebased diff
against fresh main remains exactly those six admitted AI-TWIN files;
`git diff --check` passes and the cumulative four AI-TWIN model unit files pass
185/185 on the new base. This checkpoint does not complete WP-1, discharge
DEE-871 dependencies or authorize a PR.

### Remaining WP-1 dependency matrix

1. **Complete v1 epistemic-object inventory.**
   - Complete pure/disconnected validators already exist for working
     hypotheses, dynamic relations, knowledge needs, reflection,
     prediction/experiment, outcome receipt, Formation/Health inputs, private
     export, retention, private experience and legacy quarantine.
   - `EvidenceLink` is typed and represented in the disconnected fixture but
     lacks its own exact pure validator. This is the smallest current inventory
     gap.
   - A pure `RightsOperation` contract and standalone consent/observation
     qualification remain after EvidenceLink. Evaluated Formation/Model Health
     outputs belong to DEE-876 and must not be invented here.
2. **Temporal qualification.**
   - Existing contracts qualify event/record chronology, relation validity,
     substantial-evidence anchors, prediction windows, outcome chronology and
     annual necessity-review boundaries.
   - EvidenceLink still needs an original creation instant bound to the trusted
     current clock. Evidence-known-at, independence/recency scoring,
     sufficiency thresholds and transitive temporal closure remain engine or
     ingestion decisions; this task must stop rather than infer them.
3. **Source/provenance qualification.**
   - Existing candidates recheck exact current eligible source versions, and
     private experience rechecks its exact current provenance.
   - EvidenceLink still needs exact source and target availability, both tenant
     dimensions, closed relationship vocabulary and no exact self-link.
     Validation is lineage admission only: it cannot establish truth,
     independence, consent, collection authority or multi-hop closure.
4. **Final rights/use contract.**
   - The stable checkpoint separates overdue productive use from Human
     access/correction/deletion; current authorization and source eligibility
     still win. Private export and private archive authority also remain
     separate.
   - The remaining pure RightsOperation and consent/access reconciliation must
     preserve requested/restricted/live-removed distinctions without claiming
     physical deletion. Authenticated services, RLS, backup/processor proof and
     operational erasure are WP-2/WP-3 and remain blocked from this sequence.

Dependencies are sequential: exact reference/provenance qualification precedes
the final pure rights graph, while no safe WP-1 contract depends on shared
migration registration. Historical-consent import remains `plan_only`; moving
beyond quarantine requires a separately admitted Human/runtime decision.

### Next bounded WP-1 slice — EvidenceLink qualification

Implement one pure `validateEvidenceLink` contract in
`lib/ai-twin/model/persistence-contracts.ts`, with focused tests in
`tests/unit/ai-twin-model-persistence-contracts.test.ts` and this plan as the
only owned files.

The validated object binds its own `evidence_link` reference, purpose, original
creation time and retention-policy identity; an exact eligible evidence source;
an exact currently available claim or hypothesis target; one of `supports`,
`contradicts` or `contextualizes`; and a nonempty Human-readable reason. The
trusted adapter context supplies both exact current sets in the same scope and
purpose. Matching identifiers do not authenticate authority.

Reject foreign organization or subject, unavailable/stale versions, duplicate
trusted references, unsupported source/target kinds, exact source-target
self-link, future creation, changed purpose/policy, empty reason, getters,
hidden/extra fields, custom prototypes, cycles and sparse arrays. Return an
independent deeply frozen value carrying no truth, ratification, write,
collection, consent, disclosure, Formation, archive or action authority.

Start with an explicit missing-function RED, then GREEN the focused contract
suite and cumulative four AI-TWIN model unit files. Run scoped ESLint,
typecheck, full lint/build, canon and diff validation, followed by independent
P1/P2 review. Do not wire the validator into
`postgres-repository.ts`; persistence is WP-2. No canonical algorithm change is
needed because the EvidenceLink relationship meaning is already ratified.

### EvidenceLink implementation and validation receipt

The focused RED executed 99 cases: the 89 existing persistence-contract tests
passed and all 10 new EvidenceLink cases failed because
`validateEvidenceLink` did not exist. The minimal GREEN adds the qualified
object and trusted context described above without a repository caller.

Focused persistence-contract tests pass 99/99 and cumulative AI-TWIN model units
pass 196/196 across ledger, lifecycle, persistence contracts and legacy
quarantine. Changed-file ESLint, `pnpm typecheck`, full `pnpm lint`,
`pnpm build`, `pnpm validate:canon`, `git diff --check` and IDE diagnostics are
GREEN. Build output contains only the pre-existing Next.js middleware
convention deprecation warning.

Independent exact-slice review found no P1/P2. It confirmed tenant scope,
version eligibility, chronology, purpose/policy binding, closed source/target
and relationship kinds, hostile-object rejection, deep immutability and
authority-negative coverage. Evidence-known-at, source independence/recency,
sufficiency, transitive closure, authentication, consent proof and persistence
remain explicit residual limits rather than implied capability.

Fresh `origin/main` remained
`d7d5941a995b83473acb6e00c42d5252c44b2303` at this slice boundary. No shared
migration, journal, Postgres schema, repository, Trader, runtime, environment,
deployment or Society file changed.

### Sequential stop boundary after EvidenceLink

EvidenceLink is the last remaining WP-1 slice whose complete shape and
qualification are fixed by the current ratified canon without another product
decision:

- `ConsentGrant` still lacks its canonical disclosure qualification. The canon
  requires disclosure, but does not yet freeze its exact v1 shape and allowed
  values. Adding an arbitrary field or treating private modelling as disclosure
  would invent authority.
- A standalone persisted Observation validator restricted to only
  `dialogue | diary` would duplicate the current kernel while leaving the
  canonical imported-artifact, provider/device and correction/outcome source
  admission unresolved. Expanding those source kinds requires explicit
  consent/privacy and ingestion qualification rather than a type-only guess.
- The RightsOperation matrix fixes Human control, immediate restriction,
  source deletion versus purpose withdrawal, dependency closure and the shared
  seven/thirty-day targets. It does not yet freeze the exact durable
  request/failure/retry/closure receipt shape or any minimal retained-receipt
  purpose and expiry. The canon explicitly leaves the proposed twelve-month
  receipt conditional. A new pure record now would silently decide those open
  semantics or misrepresent the disconnected fixture's `restricted` and
  `live_removed` flags as the final contract.

Accordingly, sequential implementation stops before choosing fields for those
contracts. This is a product-semantic boundary, not completion: WP-1 remains in
progress and WP-2/WP-3 remain untouched. After that decision, shared migration
registration, `db/schema.postgres.ts`, Trader schema-preflight compatibility,
authenticated runtime mounting and production activation remain later explicit
stop gates.

### 2026-09-14 Human decision — source admission and RightsOperation

The Human resolved the prior semantic boundary for DEE-871 WP-1:

1. Productive Human-model use requires deterministic current purpose, admitted
   source class, permitted use, retention policy and disclosure boundary.
   Missing, expired, revoked, mismatched or non-provable authority fails closed.
2. AI-TWIN is private by default. Storage, possession, Formation progress or
   prior consent for another source/purpose grants neither modelling nor
   disclosure. New sensitive/not-yet-authorized classes require Human-visible
   disclosure and explicit Human authorization before first productive use.
3. Ordinary voluntarily supplied dialogue may use an already-current dialogue
   grant without per-message re-consent. A post-withdrawal statement is a new
   source event with its own creation time and current authority and cannot
   revive the old source, consent or dependent claims.
4. Disclosure permission is separate, specific, purpose-bound, versioned and
   revocable.
5. Rights requests use the canonical evidence-bearing lifecycle
   `REQUESTED -> ACCEPTED -> USE_BLOCKED -> LIVE_REMOVAL_IN_PROGRESS ->
   LIVE_REMOVED -> RESIDUAL_COPIES_PENDING -> CLOSED`, with explicit
   `REFUSED`, `FAILED` and conditionally valid `CANCELLED`.
6. Acceptance binds exact tenant, Human/subject, operation, target, original
   request time, policy and actor. Use blocking is independent of cleanup;
   live removal and residual-copy closure require separate evidence.
7. Failure/retry history is append-only and never resets the request clock or
   manufactures success. Minimal receipts preserve no removed personal content.
   A request, tombstone, hash, attempted job or process exit cannot prove
   completion.
8. `WITHDRAW_USE`, `DELETE_ERASE`, `EXPORT`, `CORRECT`, `RETAIN` and `ARCHIVE`
   share lifecycle auditability but retain type-specific effects. No operation
   renews consent, widens purpose, establishes truth, grants archive authority
   or changes Formation/Model Health.

This authorizes deterministic DEE-871 contracts, tests and canon only. It adds
no migration/apply, runtime writer, Society, Trader or deployment authority.

#### Selected smallest safe slice — private source admission

Implement one pure, disconnected v1 admission contract before the larger
RightsOperation state machine:

- freeze v1 admitted productive source classes to the existing `dialogue` and
  `diary`; any unknown class fails `SOURCE_CLASS_NOT_ADMITTED` until its own
  Human-visible disclosure and authorization contract is ratified;
- make the existing modelling grant's disclosure boundary explicit as
  `private_only`; that value grants no disclosure and cannot be replaced by a
  request/body/model claim;
- accept an ordinary new source event under the exact latest current grant
  without per-message Human reconfirmation only when scope, purpose, source
  class, `private_modelling` use, retention policy, issue/expiry/revocation
  chronology and private boundary all match;
- reject withdrawn event identity, stale/older grant version, missing or
  duplicate current grant, raw-only use, foreign tenant/subject, changed
  purpose/policy, future source creation, expired/revoked grant, unknown class,
  getters, hidden/extra fields, sparse arrays and cycles;
- return an immutable minimal admission decision with
  `productiveUseAllowed: true`, `disclosureAllowed: false` and
  `disclosureGrant: null`. It authenticates nobody, stores nothing and carries
  no Formation, truth, archive, collection, action or runtime authority.

Owned implementation surfaces are `lib/ai-twin/model/contracts.ts`,
`lib/ai-twin/model/source-admission.ts`, the existing inert ledger's consent
check, focused source-admission/ledger tests and the disconnected repository
test's typed synthetic grant. Canon and this plan record the decision. Do not
modify the repository implementation, fixture SQL, shared schema/migrations,
Trader, runtime routes or Society.

RED must demonstrate the missing admission function and the current kernel's
acceptance of a grant without a resolvable disclosure boundary. GREEN requires
focused source-admission and ledger tests, cumulative AI-TWIN model units,
typecheck, lint, build, canon/diff validation and independent P1/P2 review.

#### Private source-admission implementation receipt

The RED was behaviorally specific: the new source-admission module could not be
resolved, while 35 existing ledger tests passed and the new ledger case failed
because a grant with an unqualified disclosure boundary still admitted
productive use.

The pure GREEN adds policy `human-approved-2026-09-14/v1`, explicit
`private_only` boundary on the existing consent grant, a minimal content-free
admission receipt and an exact validator for one new dialogue/Diary event. The
inert ledger now rejects grants without the exact private boundary and rejects
malformed grant objects/source arrays before reading them. No per-message
Human confirmation is added.

Independent review found one P1 in the first GREEN: candidate input selected its
own purpose and grant from the trusted grant set. The correction removes every
authority selector from the event candidate. Trusted adapter context now binds
source class, active purpose, permitted use, retention policy and resolved
grant; the validator then proves that reference is the unique exact latest
grant. A parallel formation/archive-grant regression proves candidate input
cannot choose the archive purpose, and undeclared candidate source/purpose/grant
or policy fields are rejected. Re-review confirmed the P1 resolved with no
remaining P1/P2.

Final evidence:

- focused source-admission + ledger tests GREEN: 56/56;
- cumulative five-file AI-TWIN model units GREEN: 217/217;
- scoped ESLint, `pnpm typecheck`, full `pnpm lint`, `pnpm build`,
  `pnpm validate:canon`, `git diff --check` and IDE diagnostics GREEN;
- build emitted only the pre-existing Next.js middleware convention warning;
- repository implementation and fixture SQL are unchanged; the opt-in
  PostgreSQL suite was not rerun because this slice changes only the typed
  synthetic grant used by that test, not repository behavior.

Fresh `origin/main` remained
`d7d5941a995b83473acb6e00c42d5252c44b2303`. No shared migration, journal,
schema, Trader, runtime, environment, deployment or Society surface changed.

#### RightsOperation boundary after source admission

The source-admission checkpoint is
`90dd0a3d48a697fe6d188ca3041330cacb671116`. The next sequential WP-1 slice is
the pure RightsOperation lifecycle, but implementation stops before inventing
four details not fixed by the current decision:

1. which exact lifecycle states still permit `CANCELLED`;
2. whether `FAILED` terminates the operation, returns to an earlier state on
   retry, or records an append-only failed attempt while the operation remains
   in another state;
3. exact target/effect contracts for `EXPORT`, `CORRECT`, `RETAIN` and
   `ARCHIVE`, which must not inherit withdrawal/deletion use-blocking effects;
4. the purpose and expiry of the minimal content-free rights receipt, whose
   former twelve-month proposal remains explicitly conditional in retention
   canon.

The lifecycle order, original-clock rule, live-versus-residual evidence
separation and no-authority effects are ratified and preserved. Those four
remaining choices materially determine legal states and retained evidence, so
no enum-only or fixture-derived implementation is admitted until the Human
resolves them. This is the current product-semantic stop boundary; the later
shared-DB/Trader boundary has not been entered.

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

### R1 ratified 2026-09-09 — admission before correction

The Human explicitly confirmed R1 in the same AI-TWIN task. The preceding Proposed entry and annual-review experiment are historical and superseded, not deleted. Proposed relations and open knowledge needs are 90-day working memory from creation or independently verified substantial new evidence; rereading/rephrasing/retries cannot extend retention. Independently selected private experience remains separately authorized with no automatic TTL.

Additional owned surfaces for this correction: the existing canonical algorithm, `lib/ai-twin/model/lifecycle.ts` and `tests/unit/ai-twin-model-lifecycle.test.ts`, alongside the already admitted repository and this plan. Introduce explicit retention classes `proposed_relation` and `open_knowledge_need` with the existing hypothesis rule. Preserve the September 8 policy identity for its unchanged existing classes; this is a documented additive classification, not reinterpretation of persisted `model` records. Replace the disconnected repository's experimental model mapping with these working-memory classes. Only initial candidates are supported, so the repository passes creation time, never a caller-controlled evidence-renewal anchor. No renewal service, permanent promotion, automatic archive, new schema, runtime caller or consent authority is admitted.

Test the new classes directly before implementation: one millisecond before/exactly at day 90; independently trusted substantial-evidence anchor; necessity review not extending age; revoked/ineligible/wrong-purpose/erasure cases. This isolates the candidate rule from dialogue expiry, which otherwise masks it in the current grounded fixture. Then rerun the existing scoped model unit suite and all 16 actual PostgreSQL fixture scenarios in a newly created identity-bound synthetic database; scoped lint/typecheck, canon checks and independent read-only review. Existing admission and cleanup rules apply. Shared auth, schema/journal, runtime, UI, production and Trader remain outside mutations; full DEE-871 remains In Progress.

#### R1 validation receipt — isolated correction, not full persistence readiness

Ratification/plan commit `261d6f2b` precedes implementation `bfa813715fbddef29b8de4959ab60c62c60c2908`. Human approval is also recorded in DEE-871 comment `f90fbdb8-4d5c-42de-ab1a-bb99dbda8bf9`. The prior pending-R1 receipt remains historical.

- RED: all eight new class-specific tests failed with `Unknown retention class`; the 35 existing lifecycle tests passed. This demonstrates missing classification, not a separate behavioral RED for every assertion.
- Final cumulative run at 2026-09-09 08:53 UTC: **130/130 passed** (16 actual PostgreSQL scenarios; lifecycle43, kernel35, persistence-contract22, quarantine14). The direct lifecycle tests isolate day90 from source expiry, cover one millisecond before/exact boundary, no renewal from repeated planning/necessity review, anchor chronology and early exclusion. Existing private archive no-TTL and rights/isolation regressions pass unchanged.
- Scoped ESLint, TypeScript, diff check and canon validation passed (151 canonical files, validator regressions and release identity). Independent read-only review of the exact implementation head found no concrete P1/P2 and independently ran lifecycle43/43; it did not rerun PostgreSQL or the cumulative130. A subsequent test-title clarification makes explicit that the pure helper verifies anchor chronology, not authenticity of substantial new evidence; implementation is unchanged.
- Test isolation: own resource-limited PostgreSQL16 container `426b8c83d20efc09e9b629ccc937566adec098924e8dcec1cdf2df9aacd6eb18`, verified exact role/database/run marker and loopback port58382, tmpfs data and no host mounts. Post-run query confirmed the fixture schema absent; only that own disposable container was removed. No shared/Trader database, process, worktree, PR, configuration or migration registry was mutated. Supabase/Postgres guidance preserved the least-privilege/isolated-fixture boundary; no Supabase feature or production operation was introduced.

The R1 approval gate is resolved. Expiry planning/exclusion is not a physical deletion service, authentic evidence renewal, full tenant/auth qualification or a production retention promise. This remains one unpublished DEE-871 package; no partial PR, merge, deployment or Done transition. Remaining admitted work is final v1 object/access/rights inventory and separately qualified integration; historical quarantine is still plan-only. Existing shared schema/auth compatibility gates and UI dependencies remain unchanged.

### Private export composition — bounded admission before implementation

Continue the export-manifest row of the existing WP-1 matrix in only `persistence-contracts.ts`, its existing unit test and this plan. This is a pure reference-only composition plan, not a downloaded archive, endpoint or disclosure. Reuse DEE-965's export-retention policy; no database, schema, environment, UI, provider or Trader change. Verified remote main remains `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67`.

Expected scenario: a trusted future server adapter supplies the Human actor/scope, stable manifest request id and original creation time, exact approved selection and a fresh export-specific eligible-reference set. The function validates a proposed selection against that exact approval, never infers selection from all eligible records. It produces selected permitted exact versions and a generic exclusion entry for each selected unavailable version; does not traverse provenance or disclose raw content. Foreign-scope input, model actors, altered selection, malformed/duplicate/unsupported references fail atomically. An empty current approval means revoked/unapproved and is denied. Eligibility for modelling or keeping an archive is not export eligibility; the adapter must independently review third-party rights/redaction and all current purposes before inclusion. Matching identifiers does not implement authentication.

Manifest expiry is 24 hours from its original trusted creation, not rerun time; deny composition at/after expiry and invalid/future clocks. Reuse the lifecycle helper rather than add another duration constant. Current eligibility is reevaluated on every call, so a reference can move to excluded after revocation without extending expiry. Results are independent/deeply frozen; no omitted or newly eligible item is silently added, and no exclusion reason reveals undisclosed source details. `deliveryAuthority: none` is unconditional. Returned metadata is itself scoped/private, not anonymous or an authority token. A future renderer/delivery service must reauthorize the request, exact contents and current rights at use, implement actual 24-hour artifact expiry/deletion and a stable server-side idempotency record; no such service exists in this step.

Acceptance: behavioral tests for explicit selection, separate organization/subject, current exact versions, revoked selection, caller-supplied TTL/authority/raw fields, duplicate/sparse/getter input, immutable results, day boundary/retry and independent permission loss. Start with RED then implement; cumulative four model unit files, scoped lint/typecheck, canon and independent read-only review. Existing 16 PG scenarios are historical evidence, not rerun/countable in this pure-only step. This extends no full-v1 or integration-ready claim; final batch reviewability and shared migration/auth gates remain.

#### Private export composition validation receipt — 2026-09-09

Admission `1c127dd06434422cf8527f869b3b9c3445c8d31b` preceded implementation/review head `fa43288c0fb25b5ed58782e6159768ccf8f3f743`. Independent pre-code consultation confirmed the closed-kind, exact-approval, stable-identity and neutral-exclusion boundaries. Only two already owned code/test files changed; this plan records their scope and results.

- Initial RED: eight tests failed because the function did not exist; 22 existing tests and ten new generic-rejection tests passed. The latter accepted the missing-function exception and are not evidence of behavioral RED. Final **132/132 cumulative unit tests passed**: contracts40 (18 new export cases), lifecycle43, kernel35, quarantine14.
- TypeScript, scoped ESLint, diff check and canon validation passed (151 files, validator regressions and release identity). Independent read-only review found no concrete P1/P2 within the exact pure substep and independently ran contracts40/40; it did not rerun cumulative132 or qualify all persistence.
- No PostgreSQL/container/provider operation occurred. Earlier 16 PG scenarios remain dated historical evidence, not part of this run. No new build/full CI/browser or operational export claim. Import search found the function only in its module and tests.
- Exact trusted Human selection is matched by kind/id/version and both scope dimensions; only a fresh export-specific eligibility set permits inclusion. The manifest's own creation/deadline remains stable across recomposition and excludes at exactly24h. This is not an immutable file snapshot or an authentication/permission token. Runtime approval acquisition, stable server idempotency, third-party redaction, final-content reauthorization, actual files/delivery and physical expiry remain unimplemented.

Read-only remote check: main `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67`; open PR567 owns Trader/shared-auth work. Neither was mutated. The full unpublished package now spans11files, approximately3184 added lines before this receipt, with substantial fixture/negative-test content. This local review does not waive final integration reviewability or authorize another partial PR. Remaining all-v1 Formation/Health and reflection/prediction/outcome storage contracts, final access/rights qualification, historical import and separately admitted shared integration are not complete. DEE-871 remains In Progress; no push, PR, merge, status/dependency change or automatic wakeup.

### Reflection / expectation / outcome vocabulary — admission before implementation

Continue the existing v1 object matrix using only `persistence-contracts.ts`, its existing unit test and this plan. Read sources: Canonical Algorithm §2.6/§3 and current DEE-875 issue/plan. DEE-875 stays Backlog with its DEE-871/874 dependencies; this step does not implement its lifecycle, calibration engine or actions. No DB, migration, runtime, UI, provider or Trader changes.

Add pure validated initial Reflection and PredictionExperiment candidates with exact scoped/versioned references, purpose/policy, creation, context, uncertainty and current evidence. Reflection is proposed, not a ratified Human fact. Prediction stores an expected outcome and bounded observation window, separate from actual results; optional experiment intent is only a proposal with reversibility notes and a stop condition. State remains proposed; action authority is always none and experiment-specific consent remains absent, not inferred from general modelling permission. These required text fields do not certify safety, reversibility, semantic grounding or permission to run an experiment. No numeric confidence/Formation credit or new retention-class mapping.

OutcomeReceipt vocabulary permits unknown, declined and human_reported, never verified-by-label. Require the exact current trusted prediction object supplied by a future storage adapter, revalidate its evidence/purpose/scope and match its exact version. The trusted Human actor must match the subject; matching strings is not authentication. Unknown/declined carry no observed result/time/evidence. Human-reported outcome requires nonempty text, uncertainty, observation-only provenance and an event time between prediction creation and report creation, not in the future. It may fall outside the predicted window (a miss remains useful); do not manufacture matching results, copy expected text into an outcome or update calibration. An observation reference's existence alone does not prove Human origin, independence or real-world truth: ingestion/provenance qualification stays downstream. General consent/advice acceptance is not an outcome.

Reject foreign scope, wrong purpose/policy, missing/stale evidence, malformed/getter/extra-field input, unsupported object/state, self-reference, impossible chronology and model-actor reports. Return independent deeply frozen values; no write, promotion, TTL extension or external permission. Future storage must recheck current object authority, retention and rights in the same transaction; a caller-supplied prediction is not proof it exists in storage. Unknown/decline never earns or loses progress in this substep. Transition-specific consent, operational safety review and actual metrics belong to DEE-875.

Verification: explicit missing-feature RED followed by focused synthetic tests across all three shapes and cross-object binding; cumulative four model unit files; scoped lint/typecheck/canon/diff checks; independent read-only plan and exact-head code review. Do not count earlier PG runs as current or present schema vocabulary as a complete runtime loop. Full-batch reviewability must be reassessed before publication; no new PR or dependency discharge from this substep.

Independent pre-code review adds exact lineage/chronology checks: prediction creation <= window start < window end; every receipt (including unknown/declined) is created at/after its prediction; a prediction cannot cite the kind+id of its own reported outcome at any version. Expired prediction windows may still receive late reports, and observations outside the expected window must not be silently discarded. These are structural consistency checks, not proof of a safely conducted experiment or an independently observed result.

#### Reflection / expectation / outcome validation receipt — 2026-09-09

Admission `858056fe8bf00cb493f2d8e154522c8243006297` plus independent-review clarification `0100e25a` preceded implementation/review `6ed6cb21a33a8bb91e770b0da431522d86c1591d`. Only the two already owned code/test files changed; no runtime caller or new persistence registration.

- Initial RED:20 new tests failed at the explicit function-availability guard,40 existing tests passed. Four additional chronology/cycle cases were added after plan review; no claim that each behavioral assertion was first reproduced failing.
- Final **156/156 cumulative units passed**: contracts64 (24 new cases), lifecycle43, kernel35, quarantine14. Cases cover exact prediction/version/scope, policy and current evidence, event/window/report chronology, direct self-outcome cycles across versions, Human attribution, observation-only report evidence, unknown/declined, no inferred consent/authority, immutable output and no prediction overwrite.
- Independent exact-head read-only review found no concrete P1/P2 in this pure-contract delta and independently ran contracts64/64. It did not rerun cumulative156, PostgreSQL or full DEE-871 qualification. TypeScript, scoped ESLint, diff check and canon validation passed (151 files, validator regressions and release identity).
- The pure checks do not establish that evidence was known at forecast creation, its Human origin, independence or truth; they do not traverse multi-step provenance cycles. The future repository/ingestion layer must qualify evidence's recorded/known time and dependency closure before storage or calibration. Typed observations are not automatically independent real outcomes. No new retention classification is admitted by these validators.
- No DB/container/provider, shared auth/schema/journal, Trader worktree/process/PR, deployment or browser modification. Remote main remains90de233a; openPR567 is outside mutation scope. Earlier PG receipts remain historical, not part of156. No full build/CI/E2E or actual experiment/calibration claim.

DEE-875 remains Backlog under its unchanged dependencies; DEE-871 remains In Progress and unpublished. Formation/Health storage contract, complete persisted inventory, temporal/rights/access qualification, historical import and shared integration remain unfinished. This is not approval to merge the growing partial package: final all-file reviewability and integration acceptance remain gates; no additional PR or Done transition.

### Formation / Health input snapshots — bounded admission before implementation

Sources read: Constitution §3.1–5, Canonical Algorithm §3–4, current DEE-876 issue and plan. The six domain meanings, maturity0..4 and caps are ratified targets; the versioned requirement ledger and evaluated computation are still DEE-876-owned and absent. Do not fabricate their weights, a deterministic evaluator result or a Human Initial Review.

Within the existing `persistence-contracts.ts`, its unit test and this plan, add explicit **input** snapshot types and validators for Formation and Health, not completed FormationSnapshot/ModelHealthSnapshot outputs. Each has scoped/versioned identity, purpose/policy, creation and `status: unassessed`. Formation contains exactly the six constitutional domain identifiers once each; Health contains exactly the six constitutional facets (freshness/temporal coverage, provenance/corroboration, calibration, contradictions, untested/changing domains, Human corrections/contested claims). Each row holds exact currently eligible evidence references and a nonempty explanatory note. Empty evidence is permitted and remains unknown; source availability is not maturity, health, calibration or ratification. Shared evidence may contextualize several rows, but duplicate refs within a row are invalid and no independent-evidence count is computed.

Reuse the current JSON/scope/purpose/policy/reference checks. Reject missing/duplicate/unknown dimensions, foreign-scope or stale evidence, extra percentages, maturity values, ratification/permission/history-overwrite fields, malformed notes, sparse arrays and getters. Return independent deeply frozen input snapshots. Health has no setter/reference that can rewrite formation history; neither type contains completion, identity trust, Society, billing or action authority. This is a storage-input vocabulary only, not a new retention classification, persistence route, engine activation or UI.

Acceptance: two complete synthetic inputs with and without evidence; exact sets and evidence versions; loss of source eligibility; prohibition of numeric status/ratification/authority; immutable formation input after separate health recomposition. Explicit missing-feature RED; cumulative four model unit files; scoped lint/typecheck/canon/diff and independent read-only review. No DB/containers/shared auth/schema/journal/Trader mutation. Full engine output storage and evaluated requirements remain pending, so these types do not complete all-v1 inventory, DEE-871 or DEE-876. Before adding further work packages, reassess the accumulated package's integration boundary and reviewability.

#### Formation / Health receipt and foundation handoff — 2026-09-09

Admission `c0292db5b5f473401ab1989ad2b2e4172d90c25a` preceded source implementation `cb87f5b62707e47c7f1c22933d18f7ce29e9a39d`. Initial missing-feature RED: 22 failures, 64 existing contract tests passing. Registry immutability also had a specific behavioral RED before both registries were frozen. Final four-file cumulative units: **180/180** (contracts88, lifecycle43, ledger35, quarantine14); typecheck/scoped lint/diff passed. The independent reviewer reran 180 units and confirmed the Formation/Health input boundary. No evaluator, stored snapshots, percentages, ratification or user-facing behavior is delivered; DEE-876 remains Backlog. Current integration canon/build qualification belongs to the receiving batch, not this substep receipt.

The original source branch is now frozen and clean at the exact implementation above. DEE-973, under the same v1 milestone and DEE-868 parent, owns one complete disconnected evidence-and-rights foundation integration, not this issue's unfinished shared-runtime acceptance. Its main-based branch admitted adoption in `0365fcb8`, then preserved source commits in merge `279799e63f18e4675372e9f18d149803241d0b33`. Review found two P2 defects in accumulated repository behavior; only the new batch owns their interval/privacy fixes and fresh PostgreSQL/whole-package qualification. See [DEE-973 plan](dee-973-ai-twin-evidence-foundation.md). All earlier statements of unpublished substeps remain historical; no parent or downstream completion is inferred. DEE-871 stays In Progress and is blocked by the foundation until it lands.
