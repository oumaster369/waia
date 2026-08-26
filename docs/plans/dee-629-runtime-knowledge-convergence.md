---
integrationIssue: DEE-629
integrationTitle: "Runtime Pattern / Evidence / Knowledge / Hypothesis Convergence"
parentIssue: DEE-601
branch: dee-629-runtime-knowledge-convergence
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  - exact-pit-authority-receipt
  - deterministic-replay-and-mutation
  - contradiction-invalidation-supersession
  - no-lookahead-and-scope-isolation
  - legacy-heuristic-capital-quarantine
  - one-full-fresh-sqlite-suite
  - postgres-parity
  - independent-exact-head-review
  - dee-653-exact-head-admission
approvalGates:
  - t3-scope-preauthorized
  - integration-ready
  - dee-653-exact-head-admission
state:
  status: in-progress
  completedWorkPackages: []
  remainingWorkPackages: [DEE-721, DEE-722, DEE-723, DEE-724]
provenance:
  authoritativeBase: 6f7a4a13920105af196ecefacb3781dae9bffb19
---

# DEE-629 — Runtime Knowledge convergence

## Frozen API and invariants

1. `RuntimeKnowledgeAuthorityV1` is the sole runtime authority for active hypotheses and opportunity eligibility.
2. The receipt binds organization, symbol, exact PIT anchor, Knowledge semantic digest, canonical Hypothesis identity/definition, exact supporting and contradicting Evidence, lifecycle, ordinal rank, invalidation and supersession.
3. Evidence whose event or ingest time is later than the PIT anchor is rejected before runtime evaluation.
4. Ranking is ordinal. It is never represented or consumed as probability. The legacy numeric confidence field is zero for canonical runtime hypotheses.
5. The fixed-delta reconstruction engine remains a visible `LEGACY_DIAGNOSTIC` projection only. Missing authority produces no active hypothesis and no opportunity regardless of repeated heuristic conviction.
6. `RETIRED`, `QUARANTINED` and superseded hypotheses cannot become active. Contradicting evidence remains explicit and is never silently netted.
7. Scope/digest mutation fails closed. Identical state replays identically.
8. Pattern recurrence alone creates no profitability, Forecast, Decision, Risk, Execution, production/live or capital authority.
9. DEE-626 owns downstream exact causal evidence propagation; DEE-629 does not invent Forecast lineage.

## A → B → C → D

- DEE-721 freezes the receipt and ordinal authority API.
- DEE-722 implements content-addressed PIT validation and deterministic replay.
- DEE-723 makes the canonical receipt the runtime authority and quarantines the legacy fixed-delta path.
- DEE-724 proves contradiction, lifecycle, supersession, mutation, isolation and persistence/runtime parity.

## Validation

Focused negative tests run after every wave. After semantic completion and preliminary review, run exactly one full test suite against freshly migrated SQLite, authoritative PostgreSQL parity, exact-head independent review with zero P1/P2, CI and DEE-653 before squash merge.

Rollback is one revert of the squash merge; this train adds no migration and makes no external durable data mutation.

## Acceptance

- The deterministic fold replays byte-identically; in-memory and PostgreSQL read ports enforce the same PIT cutoffs, and the actual PostgreSQL MI/MKB composition replays the same exact state/digest.
- Exact supporting and contradicting evidence, invalidation and supersession remain reconstructable.
- Future evidence/revisions, cross-org rows, missing lineage, terminal citations and digest mutation fail closed.
- Legacy fixed-delta hypotheses remain diagnostic and cannot authorize an opportunity.
- Production build, canonical/governance validation, frozen-head fresh-SQLite suite, PostgreSQL parity, independent review, CI and DEE-653 all pass before merge.
