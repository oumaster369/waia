---
integrationIssue: DEE-1136
integrationTitle: "Separate recorded acquisition and saved research ownership from capital runtime"
parentIssue: DEE-639
branch: dee-1136-noncapital-domain-ownership
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres, build, validate-canon, validate-pr-governance, validate-execution-v2-consumer-graph, validate-reality-v2-consumer-graph]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: approved
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2, WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 8f92fb2ae3d30986821d3c3a19364fc24c55235a
  lastValidationAt: "2026-09-28T00:10:48.757177Z"
  blockedReason: null
  nextAction: "Complete WP-2 within the accepted42-path contract, freezing coherent boundaries for independent review. Root owns the already-delegated checked merge; native/host/publication actions remain separately coordinated."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1136 — Fixed noncapital ownership domains

## Goal, owner and actual base

Add fixed `RECORDED_ACQUISITION_V1` and `SAVED_RESEARCH_V1` operational owners so recorded collection/analysis and saved research no longer compete for the original organization capital lease. Preserve original capital637 meaning, immutable attribution, old APIs/replay and the actual existing computation/persistence owners. This closes only the C3 ownership separation within the 23-stage runtime; it does not supply cadence, fair scheduling, Guardian/later-Reality semantics or whole P10 completion.

Live [DEE-1136](https://linear.app/deepsense/issue/DEE-1136/ai-trader-separate-recorded-acquisition-and-saved-research-ownership), UUID `6337496c-8bcf-4ab4-b642-3191e1160952`, is In Progress with the single execution label `backend`, parent DEE-639, related DEE-646/1135/1111 and no blocking relation. One issue, this plan, branch and eventual PR own the complete integration. DEE-646 retains the broader research/evolution program; no duplicate job/campaign/issue is added. Canon Step18 owns runtime exclusion/posture without trading discretion; Step20 preserves capital safety and research separation. ADR-0007/0017/0021 and existing T3/migration governance apply; no financial, product or scientific meaning is changed.

Root created this branch from checked main `82819a9581d09afb81eeeff4153abebbf59b8662` and fast-forward integrated the finite accepted DEE-1135 component `dbfa2eb39ed54971e119d1bcf4151ef804272ac7`, tree `37f501c8abc28eb162e25a157468aaa63e93c4de`, in the reused clean checkout. The old89bc branch is preserved. This is the exact engineering predecessor, not a claim that all1135 is merged or complete. Its full225 migrations and actual observation-only ten-case counterproof are accepted; prior9/1RED is retained. Only schema/journal overlap the original37-path C3 map; the other30 existing mapped blobs were pinned at this predecessor. Research behavior still derives from accepted828, not unfinished current-account product semantics.

Root selected isolated engineering after that component. **Before publication**, the full actual1135 predecessor must be checked into main, then normally merged/reconciled with this branch; rebind the complete integrated chain, actual generated identities and affected combined source/native/CI proof. A changed1135 schema requires real conflict/review work. No rebase/force-push, missing-chain acceptance or relabelled old results. Engineering does not wait for all1135 product semantics.

Plan-only grant: external `parallel-runtime-owner/dee1135-root-plan-admission/dee1136-plan-grant.json`, SHA `2d1b24c10376267411c71201a79a33e3c0378805e4e9c3aeec54622427f2ced7`. The sole plan is committed before executable work. Root read the full213-line plan, accepted its technical design/initial39-path/WP boundaries and released WP-1→WP-2 source once the final plan checkpoint is posted; independent amendment closure is accepted as recorded below; this checkpoint runs no tests/DB and claims no new implementation validation.

## Fixed routes and compatibility

New owned-pool CLIs are `scripts/trader/recorded-acquisition.ts` and `scripts/trader/saved-research.ts`. They reuse existing strict parsers, environment checks and finite caller-supplied session inputs. No domain/holder/runtime/actor/evaluator/output/URL selector or legacy fallback is accepted. Saved mode selects exactly one existing Understanding/application operation; incomplete results exit nonzero, errors remain payload-free and pools close in finally. No recurring service or activated deployment is created.

| Fixed caller | Actual shared owner path |
|---|---|
| `runRecordedAcquisitionLoopPostgres` | Existing recorded loop private core → actual HtxBarPollSource/normalizer/MI service → `publishRecordedAcquisitionAnalysis` → `completeRecordedAcquisitionAnalysisPostgresV1` → same fixed CONTEXT_UNAVAILABLE noncapital cycle/companion |
| `runSavedDomainResearchLoop` | `createSavedDomainResearchOwner().execute()` → fixed assignment/profile/actor core → actual RR snapshot/fixed computation → RC completion |
| `runSavedDomainApplication` | `createSavedDomainApplicationOwner().execute()` → existing apply/availability/consume/explicit-B complete-consumer algorithm using one private holder/accounting |
| Held saved completion | `prepareHeldSavedDomainResearchReplay().bindHeld` → `writeFixedSavedDomainResearchCompletion` → same one-use fixed implementation/receipt service |

The original `paper-bar-close-loop.ts`, exported old recorded/research/application wrappers, arguments and public shapes retain their legacy-capital route. Share private mechanics without caller-selected domain strategies or nested root-owner calls. Preserve the original public Understanding per-read/deadline behavior; do not falsely attribute new whole-invocation512/64MiB enforcement to the old wrapper. Original recorded replay still claims where it already did; application completed replay remains claim-free.

Sessions and assignments have immutable write-domain affinity. Existing roots gain only default relational `CAPITAL_LEGACY_V2` metadata, never rewritten JSON. New roots use their fixed literal. Legacy unfinished roots continue only through the old route. Cross-domain facts remain readable: saved research may consume legacy/acquisition recorded packets; applications may replay completed legacy/saved Understanding. Fixed saved B preparation/writing requires a SAVED assignment; fact replay stays read-only and does not adopt that domain.

## Lease, transaction and SQL contract

Add five tables: `trader_recorded_acquisition_lease_history_v1`, `trader_recorded_acquisition_lease_heads_v1`, `trader_saved_research_lease_history_v1`, `trader_saved_research_lease_heads_v1`, `trader_runtime_ownership_refs_v1`. New server-only fixed claim/assert helpers have separately branded acquisition/saved holders and no public general-domain factory. Database tuple/domain constraints remain authoritative against forged objects. Held helpers accept only the actual method-limited executor, never a new connection/transaction/callback or capital holder cast.

Histories contain organization FK, nonempty trimmed runtime ID<=1024 UTF-8 bytes, positive signed-int32 epoch, lowercase64hex digest PK, nullable same-org prior digest, finite adjudication/expiry, positive duration, raw body and created time. Unique(org,epoch), unique(org,runtime,epoch,digest), unique(org,digest); exact prior FK, epoch1 iff prior NULL, otherwise exact prior head/epoch+1. Acquisition duration retains its existing positive-int32 bound, saved duration1..120000ms; no defaults, renewal or early takeover. Validity is adjudication+duration, inclusive at expiry; successor only after actual expiry.

History body cap4096 and exact nine keys `{schemaVersion,ownershipDomain,organizationId,runtimeInstanceId,leaseEpoch,expectedPreviousDigest,adjudicatedAtUtc,validUntilUtc,durationMs}`; schema `waia.trader.noncapital_domain_lease.v1`, fixed domain, positive types/NULL-safe equality to every SQL projection, raw UTF-8 SHA256 equals digest. Construct with the existing semantic canonicalizer. Head PK organization has exact own-history composite FK including runtime/epoch/digest/expiry, matching unique parent key; immutable histories/references, no head DELETE or arbitrary UPDATE, no cascade removal. All five tables enable deny-by-default authenticated/anon RLS with existing service-role posture; no new login/grant/SECURITY DEFINER.

Use transaction-scoped two-int advisory keys `(1121001,hashtext(org_uuid_text))` for acquisition and `(1126001,hashtext(org_uuid_text))` for saved. Their spaces are distinct from the original one-bigint org637 lock. Same-domain hash collisions serialize only; exact tenant predicates remain. Runtime order: fixed domain advisory lock → own head FOR UPDATE → post-wait DB clock/current holder → existing deterministic root/source row locks → writes → final currentness → real COMMIT/deferred checks. No held transaction acquires another domain or capital-account lock. Provider I/O stays outside transaction and publication fences again afterward. RR replacement causes real serialization/currentness refusal, never stale-holder success.

History BEFORE INSERT and head INSERT/UPDATE guards use that same lock/head/post-wait clock, exact prior/epoch progression and valid current time. Deferred initially-deferred per-row claim/head triggers recheck exact final head and wall clock at COMMIT: an expired claim transaction rolls back; a late client ACK after an actually valid COMMIT may refuse while retaining its durable prefix. Only one claim per domain/org can survive in a transaction. No automatic retry/release/renewal.

Add exact old-history uniqueness `(organization_id,runtime_instance_id,lease_epoch,content_digest)` without changing original rows or TypeScript capital claim/assert/assessment. Ownership refs have exact domain/org/runtime/epoch/lease_digest, exactly one nonnull corresponding capital/acquisition/research parent digest equal to lease_digest, three tenant/runtime/epoch/parent composite FKs, PK(domain,org,digest) and full tuple uniqueness. MATCH SIMPLE is only for inactive NULL alternatives; positive exactly-one/domain checks prevent skipping the active parent. Add supporting partial/full indexes. Backfill actual old CAPITAL histories, then narrow AFTER INSERT fixed-domain reference triggers for all three histories; no unchecked ON CONFLICT DO NOTHING or fake capital history.

Each following receipt table gets NOT NULL default CAPITAL ownership metadata and an allowed fixed-domain check. Replace its direct old-history digest FK with the exact ownership-reference tuple FK while retaining original logical/source/audit keys, checks, hashes and global work uniqueness. Validate full old tuples before removing exactly those ten direct FKs.

| Receipt table suffix (prefix `trader_`) | New permitted domain | Added immediate affinity |
|---|---|---|
| runtime_noncapital_cycles_v2 | acquisition | Original cycle key stays globally unique |
| recorded_analysis_sessions_v1 | acquisition | Session root |
| recorded_analysis_packets_v1 | acquisition | Exact session/config |
| recorded_analysis_companions_v1 | acquisition | Exact packet AND cycle |
| research_understanding_assignments_v1 | saved | Assignment root; source session may be legacy/acquisition |
| research_understanding_completions_v1 | saved | Exact Understanding assignment |
| research_application_assignments_v1 | saved | Configuration root |
| research_applications_v1 | saved | Exact application assignment |
| research_application_availability_v1 | saved | Exact application/digest |
| research_application_consumptions_v1 | saved | Exact application AND availability/digests |

Append ownership_domain to each original parent/child tuple for the eight affinities; add matching UNIQUE parent and supporting child indexes, immediate NO ACTION FKs, keeping original logical FKs. Exact tuples: packets(org,session,config)→sessions(org,session,contentDigest); companions(org,session,sequence,packetDigest)→packets(org,session,sequence,contentDigest); companions(org,account,symbol,interval,scheduledClose)→cycles(org,account,symbol,interval,pitAnchor); completions(org,session,assignmentDigest)→Understanding assignments(org,session,contentDigest); applications(org,assignmentDigest)→application assignments(org,assignmentDigest); availability(org,application,applicationDigest)→applications(org,application,contentDigest); consumption adds that same application tuple and (org,application,availabilityDigest)→availability(org,application,contentDigest). Source facts do not acquire a matching-domain requirement.

Keep all ten existing AFTER INSERT deferred receipt constraint triggers. Replace only the bodies of `trader_runtime_noncapital_cycles_v2_fence` and `trader_recorded_analysis_v1_fence`: CAPITAL executes original org637 behavior; acquisition/saved use only their fixed corresponding lock/head/clock. Each receipt is fenced even when its parent already exists. All original semantic/link/audit/receipt functions remain byte-identical. Preserve the actual scalar `RETURNING contentDigest` success postcondition and receipt atomicity through completion; no successful no-op INSERT inference.

## Three-root admission and one budget

The configuration assignment is distinct from pair-specific applicationId: capture uses digest(configuration), while the latter includes adjacent P/A. The initial completed-result RR transaction first checks/replays the selected final result. Completed replay returns with **no new probe/claim**; absent explicit replay refuses claim-free. Only incomplete write-capable work makes one counted fixed scalar SELECT before claim.

Three fixed PK-constrained UNION ALL branches return at most three logical roots: application assignment by(org,assignmentDigest); application by(org,applicationId); Understanding assignment by(org,researchSessionId). Do not filter these lookups by expected domain/contentDigest and hide a conflict as absence. The actual Understanding contentDigest must match the selected assignment for write admission. The new Understanding range command uses only its exact session branch before its first absent-completion claim.

| Operation | Configuration root | Pair application | Understanding root |
|---|---|---|---|
| apply | Absent or SAVED | Absent or SAVED | Genuine CAPITAL/SAVED completed facts may be read |
| consume | Existing SAVED | Existing SAVED | Genuine completed CAPITAL/SAVED B facts may be read |
| complete-consumer | Existing SAVED | Existing SAVED | Existing SAVED for fixed write-capable B preparation |
| saved Understanding | Not queried | Not queried | Absent or matching SAVED |

Return only eight scalars per present root: rootKind,organizationId,keyDigest,ownershipDomain,contentDigest,leaseEpoch,leaseDigest,present=true. keyDigest is SHA256 of the full exact captured-key UTF-8 text; full predicates remain exact. Aggregate in fixed order into one control packet plus actual byte length, empty[] if none; no body/head scan, arbitrary root type or truncation. PKs prove cardinality. Strict kinds/keys/org/table-domain/duplicate/byte checks precede use. Offline maximal packet1299/envelope1430 bytes is structural, not native measurement. Actual control/head charges must fit4096 inside the original67108864 aggregate. Identity includes exact root/table/org/key plus actual domain/content/epoch/lease; absence and later presence are distinct charged versions, repeated exact bytes deduplicate, changed bytes under the same immutable identity refuse. The new helper must retain/compare actual content bytes under that stable version identity: existing ResearchReadBudget remembers sizes only and does not by itself detect same-length changed content. Charge the fixed requested-kind/presence packet even when empty.

Observed incompatible/missing required roots refuse before claim/stage effects. Initial RR does not lock future absent roots. A later boundary observing an unexpected existing root may use **one** additional counted scalar SELECT in its existing transaction; no per-packet loop/new transaction or budget. An invisible insertion race can instead produce23505/40001 or a proven earlier refusal; preserve actual cause and rollback, not an invented domain error or diagnostic retry. Immediate affinity is independently tested through actual SQL; never bypass an earlier public-owner guard to force it. A previously committed claim remains until expiry and is accounted separately from failed stage rows.

Keep one originating HeldResearchAccounting for new saved invocations:120000ms,512 submitted SQL,67108864 unique input bytes, existing selected-history32 and candidate/row bounds, statement30s/lock5s, reserved BEGIN/COMMIT/ROLLBACK. The existing4,000,000-byte extra-body component and4096 control allowance are inside64MiB. Claim/settings/root/RR/RC/receipt/availability/consumption retain the actual origin codecs, same holder and WeakMap one-use handle lifetime. No evaluator/output/facts are accepted back into the writer. Max32 input does not promise32 completions universally fit512; honest refusal retains its completed prefix without internal retry.

Normal incomplete application adds one submitted SELECT; complete replay adds zero; the observed-root race adds at most one in an existing transaction. Preserve the traced16-statement claim and four-statement currentness checks; server reference/RI/fence/index work is additional real work, not separately counted by the client observer. Historical natural32 was459 submitted SQL/5 transactions/961618 unique bytes/registration62166; prospective460 is only an estimate. Measure actual new counts/control bytes/wall duration within unchanged limits; no simulated late-ACK timer is real120s elapsed proof.

## Historical replay and top-level command fields

Preserve pure11 `fbbeb707fe792747e88ad5e76782651f40fa7fd9351a6b47b2af83cf09bb8bb8` and pure49 `abb0618c8dc0298376fe7513c184d6c20f67aa93551caadfb1febf4f3de9f3b4` byte-for-byte. The exact historical828 command profile is `5070c0aa8e42824892dd2915c5d70b21cac4e9a22aec5947a7255d62a3d8faf2` (93 paths). Admit it only for validated stored CAPITAL artifacts with those exact pure identities. Generate actual separate current legacy/saved command closures; do not force an old count or accept caller/unknown profile selection.

Replay each stored assignment/application/witness/evidence/relation/availability/consumption under its own exact admitted profile while recomputing actual source/actor/profile/chronology/registry/meaning, raw hash and SQL audit links. Every newly written child uses the actual current selected command identity even after a historical prefix; old parents keep old bytes. No substituted old digest pretends old code ran now.

0223 generic headers/raw hashes and nested witness command-string checks do **not** require the top-level command field in every application table. Add a named check on each of the four application tables in0225: `ownership_domain <> 'SAVED_RESEARCH_V1' OR (jsonb_typeof(body_json::jsonb->'commandManifestDigest')='string' AND (body_json::jsonb->>'commandManifestDigest') ~ '^[0-9a-f]{64}$' AND (body_json::jsonb->>'commandManifestDigest') <> '5070c0aa8e42824892dd2915c5d70b21cac4e9a22aec5947a7255d62a3d8faf2') IS TRUE`. The explicit IS TRUE rejects missing/JSON-null/wrong-type fields despite PostgreSQL CHECK accepting NULL. CAPITAL rows are unaffected; no body rewrite. The fixed replay selector independently requires top-level string/lowercase64hex then exact supported profile; well-shaped unknown digests are not SQL authority. Nested witness representation remains independently checked.

## Closed implementation map

Exactly40 nonplan paths plus this plan =41. The initial39-path map and two explicitly admitted projection follow-through paths below are exhaustive. This exceeds the approximate20-file target because one connected ten-relation migration requires its actual fixed callers, legacy replay, generated closures and strict native/compatibility gates in one rollback boundary. Splitting schema/callers would expose missing parents or unproved attribution; these are serial work packages, not separate issues/PRs. Any further path needs demonstrated necessity and root admission before edit.

| Path | Finite change |
|---|---|
| `lib/trader/paper/durable-noncapital/run-recorded-paper-loop-postgres-v1.ts` | Keep old export; add fixed acquisition wrapper over private existing loop, capture/publish/completion route and currentness. |
| `lib/trader/paper/durable-noncapital/repository-postgres-v1.ts` | Fixed acquisition publication with tagged session/packet INSERTs and corresponding holder fence; preserve exact source normalization and MI writers. |
| `lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2.ts` | Fixed acquisition completion delegates existing computation/cycle/companion writer with new domain; old public wrapper unchanged. |
| `lib/trader/paper/research-understanding-v1/run-saved-research-loop.ts` | New saved-domain range caller; old loop unchanged; one private owner/accounting lifetime. |
| `lib/trader/paper/research-understanding-v1/repository-postgres.ts` | Fixed saved owner; real assignment/profile/actor core and holder-minted private execute, held transaction reservation. |
| `lib/trader/paper/research-understanding-v1/held-replay.ts` | Named fixed saved bind/snapshot wrapper, original originating-pool/accounting lineage, no public writer callbacks. |
| `lib/trader/paper/research-understanding-v1/completion-write-postgres.ts` | Named fixed saved wrapper over same one-use snapshot/RC writer; unchanged scalar stored-digest postcondition and receipt service. |
| `lib/trader/paper/research-understanding-v1/bounded-source-postgres.ts` | Named fixed assignment predicate; shared exact decoder/projections; original reader untouched. |
| `lib/trader/paper/research-application-v1/run-saved-application.ts` | New fixed saved wrapper, same captured command schema and result shape. |
| `lib/trader/paper/research-application-v1/repository-postgres.ts` | Fixed holder/metadata/root probes, shared single accounting/completion, per-artifact truthful current versus historical replay representation. |
| `lib/trader/paper/research-application-v1/computation-manifest.ts` | Generated two actual command closures; preserve original pure11 entries/digest exactly. |
| `scripts/trader/generate-research-application-manifest.ts` | Separate actual legacy/new fixed CLI closures and exact allowed modules/selected branches; no wildcard capability admission. |
| `scripts/trader/generate-research-understanding-manifest.ts` | Separate legacy/new fixed runtime inventory check; pure49 generation remains identical. |
| `db/schema.postgres.ts` | Five new tables, ten metadata columns, typed-parent/affinity schema declarations. |
| `db/migrations_postgres/meta/_journal.json` | Append exactly one allocated successor after full accepted integrated chain; every predecessor unchanged. |
| `scripts/postgres-validation/prepare-historical-reconciliation-fixture.ts` | Then-current final suffix applied after unchanged historical prefix/prelude/27-row seed; do not infer compatibility from missing chain. |
| `tests/unit/postgres-historical-reconciliation-bootstrap.test.ts` | Exact appended suffix/order plus missing/duplicate/out-of-order negative controls, seed identity retained. |
| `lib/trader/observability/fhv-v2-postgres-schema-preflight.ts` | Exact compatible new migration identity only; no read authorization or FHV frontier expansion. |
| `tests/unit/fhv-v2-postgres-schema-preflight.test.ts` | Positive exact new identity and altered/missing identity negatives; original max207 unchanged. |
| `tests/unit/forecast-v2-applied-migration-identity-v1.test.ts` | New exact trailing migration compatibility only; original Forecast max148 unchanged. |
| `.github/workflows/postgres-integration.yml` | Path filters plus one new domain-native suite in then-current strict roster; retain 30-minute capital job/PROFILE/generic boundaries. |
| `scripts/postgres-validation/assert-capital-test-results.mjs` | Exact accepted old suite union plus new domain suite, zero skips/no omitted or duplicated suite/test identities. |
| `tests/unit/postgres-historical-reconciliation-profile-proof-guard.test.ts` | Exact updated suite union/count and unchanged timeout/profile guard meaning. |
| `lib/trader/intelligence/information-sufficiency/information-sufficiency-consumer-inventory-v2.ts` | Trace actual fixed saved owner/shared completion writer and receipt producer; preserve strict read-only assignment/replay capabilities. |
| `lib/trader/intelligence/market-understanding-consumer-inventory-v1.ts` | Add actual fixed caller reachability to same shared producer, no new generic Understanding owner. |
| `tests/unit/trader-information-sufficiency-consumer-closure.test.ts` | Strict actual new call graph and no caller-output/evaluator/root-pool nesting; retain original negatives. |
| `tests/unit/trader-market-understanding-consumer-closure.test.ts` | Strict actual fixed write/replay graph; generic persistence remains deferred and bypass guards intact. |
| `tests/unit/research-application-v1-capability.test.ts` | Separate exact command closures, fixed domain module methods and old profile admission negatives; no source/trust/capital permission. |
| `tests/unit/trader-research-understanding-capability.test.ts` | Both exact CLI branches, same writer/actor/profile/no-authority boundaries; original negative suite retained. |
| `tests/helpers/research-application-v1-process.ts` | Keep old seed/default child behavior; named saved-domain seed wrapper over same actual source/profile/measurement/hypothesis fixture core, using real fixed domain writers. No production test mode. |
| `lib/trader/runtime-authority/v2/noncapital-domain-lease-postgres-v1.ts` (new) | Fixed acquisition/saved named claims/assertions and bounded root metadata, private shared mechanics, no general factory. |
| `lib/trader/paper/research-application-v1/replay-command-compatibility-v1.ts` (new) | Private one explicit 828 legacy replay profile plus exact current profiles; no caller selector/policy. |
| `scripts/trader/recorded-acquisition.ts` (new) | Real fixed acquisition owned-pool CLI, existing parser and producer, no legacy fallback. |
| `scripts/trader/saved-research.ts` (new) | Real exclusive fixed saved Understanding/application CLI and closed error/exit paths. |
| `tests/helpers/noncapital-domain-process.ts` (new) | New-domain child-process/native observers and synthetic transport only. Reuse existing public transport/clock barrier; actual CLI imported in child, all DB/pools closed. |
| `tests/unit/trader-runtime-domain-ownership-closure.test.ts` (new) | Fixed domain constructor/call/negative source closure, exact SQL/FK/fence structure and current/historical command representation tests. |
| `tests/integration/postgres-runtime-domain-ownership-v1.test.ts` (new) | Real two-domain/legacy/upgrade-relevant race/fence/native accounting proof described in PROOF-PLAN. |
| `db/migrations_postgres/0225_trader_noncapital_domain_ownership_v1.sql` (new) | Exact hand-authored migration/constraints/backfill/fences after full225 predecessor. |
| `docs/plans/dee-1136-noncapital-domain-ownership.md` (new) | Sole integration state, scope, evidence and publication metadata. |
| `lib/trader/paper/research-application-v1/bounded-read-postgres.ts` | Add the exact ownershipDomain scalar to four fixed application read/candidate projections; preserve bounds, identities and statement count |
| `tests/unit/research-application-v1-bounds.test.ts` | Update the exact candidate fixture and verify domain scalar read/write accounting and refusal controls |
| `tests/unit/postgres-capital-proof-guard.test.ts` | Preserve the independent prior25 roster and every rejection control while adding the actual domain suite26 |

The #10/#31 application/root-helper responsibilities include the G01 third root and exact accounting; #32 and schema/migration include A01 positive shape versus profile membership; domain unit/native/helper paths carry their new controls. No change to old capital modules, original CLI, SQL0000..0224, pure members, canonical MI service/repository, Forecast/Decision/Risk/Execution/Guardian, scheduler or operator UI. Original application71 and Understanding24 native files remain byte-identical; their setup helper keeps the old default behavior while adding only named fixed-route support. Existing exact two MI service Measurement delegates remain the only application lineage calls, with no source/trust/Forecast authority.

## Migration, upgrade and rollback

Allocated successor: idx225, version7, when1780000000225, tag `0225_trader_noncapital_domain_ownership_v1`, breakpoints true; full chain226 only after implementation/application. Preserve every225 predecessor SQL byte/index/time. Hand-author SQL and matching schema/journal; no snapshot generator or missing-chain suffix apply.

Transactional migration under quiesced relevant writers and bounded lock acquisition: lock old history plus ten receipt tables in literal lexicographic table-name order; add old tuple uniqueness; create fixed histories/heads/refs/guards; backfill actual CAPITAL refs and future reference triggers; add default domains; validate old tuples/every original column/body/hash/count and affinities; add/validate new composite/affinity keys while old digest FKs remain; drop exactly ten direct FKs identified by constrained columns/referenced relation, not guessed truncated names; replace only two fence bodies; verify catalog. Any lock/validation error aborts the whole migration. No disable-immutable-trigger/data-repair shortcut.

Separate genuine two-version upgrade: exact828 executable/full224 creates real legacy recorded/Understanding/application completed and interrupted prefixes, including config C/pair(0,1). Save original values/raw bodies/hashes/audits/outputs. Apply full actual accepted predecessor chain then0225; verify every original column unchanged, default CAPITAL, exact old-history refs and all ten/eight relationships. A separate deliberately mismatched old tuple makes actual upgrade roll back, not repair history. New executable strictly replays old artifacts, continues legacy prefixes only through old routes with truthful current children, and permits separately rooted new saved fact use. Merely stamping old hashes into current fixtures is insufficient.

Rollback retains stricter schema and disables new commands; old routes keep their original domain. Do not delete histories, rewrite new-domain rows as capital or restore old direct FKs over new data. Any schema reversal is a separate reviewed data-preserving migration. Production apply/deployment is outside this issue's source/native work.

## Acceptance and work packages

WP-1: plan adoption, then coherent schema/fixed-domain lease/ref/fence source and bounded metadata primitives. Freeze for independent source review with original capital/SQL/pure/inherited component preservation. No claim of behavior compatibility before actual callers and proofs exist.

WP-2: actual fixed CLI/private-owner routes, strict read versus write domain separation, old API/per-artifact replay and current manifests. Add meaningful unit/capability/domain native support within the closed map. Preserve one held origin/accounting, real RR→RC/deferred commit, scalar no-op refusal and old registrations. Freeze complete source/actual native inventory for independent review and appropriate serial readiness.

WP-3: integrate actual checked predecessor when available; bind exact source/full chain/native titles; separately admitted fresh native and two-version upgrade/bootstrap evidence; independent outcome review; exact-head full CI and root-owned publication/checked merge. Required proof groups:

1. Same-org capital/acquisition/saved coexistence with unchanged capital head/history; same-domain busy/expired successor, no renewal, cross-org isolation and no cross-domain lock starvation.
2. Real fixed acquisition CLI with declared synthetic transport through actual source/normalizer/MI owner; exact session/packet/cycle/companion holder refs. No source qualification inferred.
3. Real saved Understanding/application CLI with network forbidden, real profile/actor/receipt, P/A/S/B chronology, actual completion/consumption and one origin/holder/budget; unknown remains unknown.
4. All ten typed parents and eight affinities: wrong org/runtime/epoch/digest/domain, inactive-NULL bypass, forbidden table-domain, duplicate work and original logical/body/audit constraints fail. Direct SQL controls reach affinities without weakening owner guards.
5. Genuine old same-config/new-pair application refuses at the third root before any new claim/stage effect; genuine SAVED prior-pair assignment permits the next pair. Preserve completed final historical replay with zero new probe/claim.
6. Actual observed and invisible post-probe races, preexisting-root conflicts, saved fact reads versus B write refusal; distinguish committed claim prefixes, failed stage effects,23505/40001/40P01/55P03/cancellation/harness timeout from success. Observe actual server PIDs/blockers/waits.
7. Histories/heads malformed envelope/raw hash/projection/duration/epoch/prior/future time, renew/early takeover/update/delete refuse. Actual deferred receipt/claim expiry at COMMIT rolls back; late ACK after actual COMMIT preserves durable prefix honestly. SET CONSTRAINTS IMMEDIATE is not a substitute for real deferred proof.
8. Natural32 composite measured query/byte/time/candidate bounds and P/A/B-only bodies with predecessor metadata; induced512/513 and aggregate/control/4,000,000-byte/candidate65536/65537 boundaries, reserved rollback, no refreshed budgets. Saved Understanding max32 honest exhaustion and retained-prefix recovery, not guaranteed32-fit.
9. Actual interruption after claim/B commit/before-after consumption, restart and no duplicate receipt/completion/audit/consumption; scoped RETURN NULL completion trigger reaches refusal in old/new actual owners, cleaned finally, no falsely rolled-back committed claim.
10. All four SAVED top-level field checks reject missing/null/numeric/boolean/object/array/malformed/uppercase/short with valid recomputed outer hash and relational candidates. Separate unknown64hex/profile/pure/nested witness controls; preserve genuine historical parent/current-child provenance.
11. Strict new CLI flags before pool acquisition, fixed constructors/reachability, shared writer/receipt authority and no caller output/evaluator/root-pool nesting; no generic Understanding/source/capital bypass. Exact selected legacy/new command inventories and unchanged pure11/pure49.
12. Deny browser roles, unchanged global role/RLS/trigger posture, exact constraints/index catalog, source/chain before-after, redaction, bounded watchdog/no automatic retry, zero clients/process leaks and all failures retained.

Run complete unchanged application71 + Understanding24 and then-current original recorded/capital/Risk/Execution/accepted1134/1135 suites as applicable, plus actual new domain file. Derive strict roster/test counts from final source; no guessed25/26 count, filtered registration or copied historical green. Local two-version upgrade and bootstrap (unchanged historical prefix/prelude/27 seed then full suffix with real journal readback) are distinct evidence. FHV only proves exact schema compatibility, preserving max207; Forecast max148 stays unchanged.

After source grants, required local readiness is appropriate focused units/compatibility, both manifests/runtime inventories, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm validate:canon`, `pnpm validate:pr-governance` and existing Execution/Reality graph validators. Full unit aggregate is authoritative on GitHub PR CI, not duplicated wholesale locally. No UI change requires extra local browser flow tests. Native runners require exact immutable source/225+new SQL, actual registered titles/markers, one fresh root-chosen synthetic DB, real driver/role/posture/timeout/closure proof, no retries or secret output. Root coordinates exclusive heavy/PG slots; no validation is implied by this plan.

## Evidence and remaining boundaries

External audit root is `audit-ai-trader-full-2026-09-25`. Original contract `parallel-runtime-owner/c3-domain-separation-contract-82819a95` freeze1513ff89 remains intact; M02 report322f843f/93-artifact manifestc7c38cb4 requires G01/A01. Separate amendment `parallel-runtime-owner/c3-domain-separation-contract-82819a95-m02-amendment` report `3fa625d06d4c2a7ab25d56996d346c3f1bfd3379452a1ffdf69159c7aa736219`, nine-artifact freeze `7eaa66f83cce81428fd0b0aefb838d19f556ed69fba03f1536f0480d350a7ee4`, contains the exact roots/SQL predicate/proof delta and39-path dependency binding. Independent M02 amendment closure is now accepted: report `71eb19e2e81fa03991dd534b931227e0d6bffb7c0be751ac04681cddae121939`,25-artifact manifest `c3dc8610e40d0e13f5397bba6bb8f73acb37c3827efe062f507f66494acce8d1`; root adoption `81c7b2f3d500bcde7e9b99c3ede24111f68eba387a7ae38a309042a4b9f86322` explicitly retains actual-content comparison beyond size-only budget deduplication. This accepts the finite design, not source/native behavior.

Inherited finite1135 source/repair and actual ten-case outcome remain separately attributed to dbfa. Independent actual-outcome report `8866da28f6dcc252b82a296efc25565d4b8a5e3b071488aeae801abea494cb27`, four-artifact freeze `b1513866596f271a5600035512c746ab646cb0b792f75755331f33ca46f06750`, proves only that acquisition component; its original9/1RED remains. These are dependencies, not DEE-1136 validation.

No invented cadence, selector policy, lease handoff, financial/empirical thresholds, scientific source admission, holdout use, live keys/order/activation, production/C3 host mutation or new capital ingress. Ordinary producers, fair succession across all lots/interrupted work, Guardian evaluator→sealed trigger→qualified protective owner and later-Reality mandate semantics remain separate scopes. The user has already delegated checked merge to root. The conventional frontmatter human-merge gate records that existing authority boundary and does not request another Human permission; root still proves exact-head acceptance and owns publication/merge. Actual trading and activation remain operator-only. The user has already authorized nontrading production deployment, but deployment is outside this slice's current source/native grant. Current actual plan/source/native/CI evidence is required before any completion claim.

## WP-1 source checkpoint

The first coherent source boundary adds0225/full226 journal registration, matching typed schema, fixed held acquisition/saved lease helpers and the bounded three-root/control-byte primitives. Six executable/test paths are changed inside the closed map; the application command declaration is regenerated from the actual schema bytes, with its93 paths and pure11/pure49 identities preserved. The new focused unit file checks the real compiled scalar-query boundary, configuration/pair distinction, foreign fact versus write-root admission, strict packet shape/byte charges, absence→presence, same-length content conflict, fixed-domain busy/claim behavior and exact persisted claim body. These assertions are authored, not yet executed. Existing wrappers/callers and prior native files are untouched at this boundary; WP-2 routes and compatibility remain open.

New heads use INSERT only for the first epoch and an exact prior-digest UPDATE for a successor. This avoids PostgreSQL BEFORE INSERT first-epoch validation on an UPSERT candidate while retaining one guarded head-write statement and the traced12 inner/16 total claim count. Millisecond-exact stored timestamps positively match all sealed string projections. No SQL was applied, no behavior/native compatibility was inferred, and all225 predecessor migrations remain immutable. Independent source review and serial scoped checks precede acceptance of this boundary.

## WP-1 retained RED and WP-2 projection follow-through

On immutable16a24b178024d83f514fcaaf811b476bcc21d928, actual manifest checks/runtime inventory,72 focused tests/3 files/0 skip and four-path ESLint passed. Typecheck exited2 at00:07:11.312063 UTC with exactly two literal Symbol-brand inference errors (boolean versus true) in the new fixed helper; canon was not reached. External `dee1136-wp1-checks-16a24b17` retains all six raw logs/receipts and source identity. Correct only these two private brand annotations to `true as const`; no runtime/SQL semantics change. Scoped successor validation remains required.

Root's admitted follow-through `dee1135-root-plan-admission/dee1136-bounded-domain-scope-addendum.json`, SHAe4014941, adds exact map rows40–41 before their edits. The existing fixed application `common` projection omits ownershipDomain; exact write-key checking also excludes it. Carry that scalar through the same four bounded projections/candidate measurements so historical CAPITAL provenance and current SAVED profiles can be verified without an extra completed-replay probe. Preserve each original row cap,512/64MiB/4,000,000 budgets, query count, pure11/49 and all registration/source projections. Update only the related unit candidate/projection evidence; generate the actual resulting command identity. The closed map is now41 paths, with no other additional path granted. This does not retroactively change16a source evidence.

The literal-brand correction is committed as5f5cacf5da6ffc47d69c33fe0e57e5c5870b2f78: exactly two `as const` annotations, preserving all other nonplan16a entries. The initial RED freeze is `e6f03d29443d4648e9a2c00ab83899fe1c7f21d71ba5fbd39cc1a528ac5d268c` (15 artifacts); source/native acceptance remains pending successor checks and independent review.


## WP-1 acceptance and WP-2 source work

Corrected immutable8f92 passed72 focused tests/3 files/0 skip, helper ESLint, typecheck and canon at00:10:31.930467–00:10:48.757177 UTC. The18-artifact correction freeze is251b213c9d9db2184889a32dc75cd33a252dc64b24420e87a433593f0d781bbf; the original16a compiler RED remains intact. Independent M02 reportd836b9257a8a568b3b73632410a1d06d7ca5d4cfc47c272b2ea7cb5076cc543e and seven-artifact freeze90d42ce0be60ed6f140f3bdba18d5d1596f05304ec01df58e4a142f044a8a770 accepted only the finite WP-1 source/readiness. Root adopted it in `dee1135-root-plan-admission/dee1136-wp1-independent-root-adoption.json` (de74f91d). WP-2 source is released under the same42-path contract; actual routes, historical replay, full226 native upgrade/fences and natural32 accounting remain unproved until their separate actual checks.

The intermediate WP-2 source checkpoint adds both real fixed CLI routes, same private writers, fixed saved-domain replay/write handle binding, one invocation ledger and per-artifact exact current/historical command representation. Current generated application command inventories each contain95 actual paths; the pure11 declaration and all pure49 source bytes remain unchanged. Bootstrap/FHV compatibility now enumerates the full225 predecessor plus0225, with the original207/148 frontiers and27 seed intact. The strict native roster adds exactly the new domain file to the prior25.

The new native file is authored but unexecuted and intentionally not yet the full WP-2 proof package. Its current cases cover actual three-domain claims, fixed acquisition/saved CLIs, configuration versus pair roots, legacy fact/write distinction, natural32 accounting, expiry, installed FK/fence catalog, actual uniqueness versus shape outcomes, three process-death prefixes, simulated-monotonic late ACK, induced513 and two suppressed-completion owners. Direct eight-affinity insertion controls, genuine two-version upgrade, remaining root races/malformed-row controls and full acceptance remain open. Intermediate source lint/compiler/focused units are separately attributed; no native or whole-package acceptance follows from this checkpoint.


## Intermediate WP-2 retained checks and exact roster follow-through

Immutable1e941fb94134a7394da24a3fb4a6314710b8eefe scoped ESLint stopped at one native observer `no-this-alias` error at00:45:03.880884 UTC. Narrow test-only610d9bb8 corrected that observer; its scoped ESLint passed, then typecheck stopped at00:46:14.239047 UTC with captured-profile/public-selector typing mismatches and missing native helper control-ledger arguments. Units had not run. Both raw packages remain under `dee1136-wp2-intermediate-1e941fb9` and `dee1136-wp2-observer-correction-610d9bb8`. Correction c2d6ca94 derives the held public selector from the already-captured exact profile id/digest, retains the private definition for assignment creation, and supplies the actual native control ledger; no cast, pure/cap change or WP-1 core edit.

Root admission `dee1135-root-plan-admission/dee1136-capital-guard-scope-addendum.json`, SHA717bd0c90cbb7ddbafca0c00c5c00e8f0879d95019d7aa9fede8d190d67b23e0, adds the exact42nd path before editing it. The independent capital proof guard unit still enumerates25 while the actual admitted roster is old25+domain26. Add that suite and update its positive title/count; preserve all old suites and missing/skipped/failed/empty/duplicate controls, extended to the new suite. No proof gate, test filtering, runtime policy or native grant changes.
