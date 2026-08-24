---
integrationIssue: DEE-685
integrationTitle: "Required Information Profile + Fail-Closed ISG Integration Batch"
parentIssue: DEE-621
branch: dee-685-required-information-sufficiency-gate
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, postgres-ci, github-pr-ci]
requiredValidation:
  - focused-contract-tests
  - focused-postgres-tests
  - paper-poll-fixture-backtest-non-bypass
  - replay-and-tenant-closure
  - lint
  - typecheck
  - build
  - full-frozen-head-unit-suite
  - pr-governance
  - independent-exact-head-adversarial-review
approvalGates:
  - human-ratified-dee-621-scope
  - t3-scope-preauthorized
  - integration-ready
  - dee-653-exact-head-admission
includedIssues: [DEE-686, DEE-687, DEE-688, DEE-689]
---

# DEE-685 — Required Information Profile + Fail-Closed ISG

## Admission

- Human-ratified owner: DEE-621, including its 2026-08-18 Step 1, Step 3, and Step 6 addenda.
- Authoritative base: `origin/main@5cc17ad85e47266eb8f832e16eda093641ba3b54`.
- Dependencies: DEE-620 and DEE-597 are Done.
- Duplicate audit: DEE-621 is the unique active implementation owner; no earlier child or Integration Batch exists.
- Integration boundary: one branch/worktree, one admitted/frozen manifest, one next PostgreSQL migration, one PR, one squash merge, and one revert-PR rollback.

The Human subsequently authorized provenance-compatible readmission of four mechanically discovered closure surfaces before publication: three legacy paper/intelligence tests whose expectations must reflect the already-ratified `information_sufficiency_blocked` and null-execution result, plus the existing Reality V2 consumer inventory digest. This changes no production byte, Reality disposition, scientific meaning, security boundary, or capital authority. The earlier full-suite-only FHV checkpoint failures were classified as contention/nondeterminism by an unchanged isolated 6/6 proof; no FHV surface is admitted or modified.

## Ratified semantic boundary

The train builds a generic, immutable and content-addressed `RequiredInformationProfileV2` plus deterministic `InformationSufficiencyReceiptV2`. Profiles are purpose- and question-relative and support `NEW_OPPORTUNITY`, `OPEN_POSITION_REASSESSMENT`, and explicitly non-capital research use. Requirements are `MANDATORY`, `CONTEXT_TRIGGERED`, or `OPTIONAL_ENRICHMENT`.

Layer A is fail-closed. Missing, unavailable, stale, untrusted, non-PIT, non-replayable, source-revision-mismatched, version-incompatible, insufficiently independent, or policy-forbidden contradictory evidence cannot be hidden by optional evidence or an aggregate score. Substitution is allowed only through an exact profile-declared equivalence rule and must be visible in the receipt.

Layer B is contract-only in this train. The profile may pin a later-qualified aggregate evaluator version and digest, but this implementation invents no formula, component, weight, threshold, source classification, or empirical policy. `SUFFICIENT` is epistemic permission to continue only; it creates no probability, economics, action, sizing, Risk permission, Execution authority, or live-capital authority.

`NEW_OPPORTUNITY` insufficiency blocks new-entry Forecast/Decision admission and order submission, but it never blocks a separately sufficient `OPEN_POSITION_REASSESSMENT` lane or risk-reducing Guardian exit. Tests and research must declare explicit non-capital authority; omission is never a silent bypass.

## A → B → C → D

### DEE-686 — contracts and deterministic evaluator

- Define the closed purpose, question, applicability, evidence state, contradiction, substitution, terminal and reason-code vocabularies.
- Build immutable profile identity and deterministic hard-floor evaluator/receipt over exact DEE-620 Observation, trust/provenance and Measurement identities.
- Preserve `NOT_REQUIRED` and `NOT_APPLICABLE`; never mark causal `WHY` answered from price-only evidence.
- Expose only a version/digest-bound adapter seam for a later-qualified Layer B aggregate.

Expected surfaces: `lib/trader/intelligence/information-sufficiency/**`, focused unit tests.

### DEE-687 — PostgreSQL persistence

- Add exactly `0162_trader_information_sufficiency_v2.sql`, the journal entry, Drizzle schema, tracker record and a server-only repository.
- Persist exact profile/receipt JSON and digest identity with tenant scope, append-only guards and authenticated/anon deny RLS.
- Prove service-role CRUD/idempotency, conflicting-content denial, tenant isolation, cross-tenant denial, mutation denial and fresh migration apply.

Expected surfaces: PostgreSQL schema/migration/journal/tracker, ISG repository, focused migration and PostgreSQL tests.

### DEE-688 — non-bypassable runtime binding

- Require exact sufficiency authority before Forecast/Decision construction and before new-entry submission.
- Share identical evaluator semantics across paper, poll, fixture and historical replay.
- Missing executable authority and `INSUFFICIENT | UNAVAILABLE` block entries deterministically.
- Preserve Guardian/open-position reassessment and risk-reducing exits as a separate lane.

Expected surfaces: evaluation/Forecast-Decision/paper orchestration types and services plus focused unit/integration tests.

### DEE-689 — consumer, question, replay and tenant closure

- Inventory every profile/receipt producer, Forecast/Decision consumer, paper/poll/fixture/backtest entry seam and possible bypass.
- Prove question-relative hard floors, causal-WHY boundaries, non-holdout historical analogues, bounded terminals, duplicate/dependence handling, explicit substitution, same-PIT parity and separate Guardian lane.
- Freeze the manifest only after the exact cumulative diff and evidence map are complete.

Expected surfaces: checked source/consumer inventory and focused closure tests; no downstream DEE-622/645 implementation.

## Validation and freeze

After each serialized child commit, run its focused tests, cumulative focused tests, typecheck and scoped lint. Wave B onward requires fresh migrated PostgreSQL and real authenticated/anon role probes. Mark a child Done only after its immutable commit, scoped gates and independent reviewer acceptance are recorded.

After D, freeze the exact manifest/head and run once: fresh PostgreSQL migration/smoke, all focused PostgreSQL/tenant/replay/non-bypass proofs, lint, typecheck, build, a fresh migrated SQLite database and the full unit suite, canonical/PR governance validation, and one fresh exact-head adversarial review with zero unresolved P1/P2. Any material base/head/manifest change invalidates affected evidence.

## STOP conditions

Stop on a new source class; any concrete aggregate formula, component, weight, threshold or scientific classification; security/retention/holdout/production/live-capital action; Guardian risk-reduction restriction; capital-authority widening; migration collision; semantic overlap with moving `main`; or an unfixable required gate.

## Rollback

Rollback is one revert PR of the squash commit. No destructive down migration, production SQL, deployment, credential operation, holdout access, release tag, or live operation is authorized.
