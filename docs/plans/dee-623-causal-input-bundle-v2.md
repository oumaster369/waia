---
integrationIssue: DEE-623
integrationTitle: "Canonical Cycle Causal Input Bundle V2"
parentIssue: DEE-594
branch: dee-623-causal-input-bundle
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  - causal-collision-by-omission
  - deterministic-replay
  - postgres-persistence-parity
  - one-full-fresh-sqlite-suite
  - independent-exact-head-review
  - dee-653-exact-head-admission
approvalGates: [t3-scope-preauthorized, integration-ready, dee-653-exact-head-admission]
state:
  status: in-progress
  completedWorkPackages: [DEE-733, DEE-735]
  remainingWorkPackages: [DEE-734]
provenance:
  authoritativeBase: 8b8f0196e6c6338a77d991d8356ff3ab5d2d9006
---

# DEE-623 — Canonical cycle causal input bundle v2

## Frozen API and invariants

1. `CanonicalCycleCausalInputBundleV2` is the sole semantic input body for every newly built v2 intelligence-cycle envelope; `inputSemanticDigest` is exactly SHA-256 of its canonical JSON.
2. The bundle pins Reconstruction content/schema identity; exact Understanding derivation, profile, ISG receipt, claims, computation inputs and consumed Source/PIT Observation/trust/Measurement identities when applicable; Hypothesis construction/canonical causal lineage; and historical profile/matrix identities.
3. Run/cycle IDs, creation timestamps, worker identity, retry state and other operational metadata are excluded.
4. The same builder is used by replay and runtime. Any causally consumed identity mutation changes the digest; identical causal inputs reproduce byte-identical JSON and digest.
5. New v2 envelope rows persist and verify the canonical JSON. Historical v1 rows remain readable with null JSON and retain their original identity; no synthetic backfill is permitted.
6. No Forecast, Decision, Risk, source acquisition, scientific formula, holdout, security, production/live or capital semantics change.

## Integration train

- DEE-733: freeze and wire the canonical causal-input contract.
- DEE-735: persist it additively with v1 backward compatibility.
- DEE-734: close mutation, replay, migration, PostgreSQL and integration evidence.

## Validation

Focused collision-by-omission and fail-closed tests run continuously. After semantic freeze: one fresh migrated SQLite full suite, PostgreSQL parity, exact-head independent review zero P1/P2, authoritative CI and DEE-653 admission.

## Acceptance

- No `*_digest` field contains an ID surrogate; all digest-labelled identities are validated 64-hex content digests.
- Reconstruction, Understanding, Source/PIT Observation, trust revision, Measurement, profile/ISG or canonical Hypothesis lineage changes perturb the input digest when causally applicable.
- Operational metadata changes do not perturb it, and independent replay produces byte-identical identity.
- The persisted v2 envelope is self-verifying while legacy v1 rows remain backward compatible.
- Exact-head review, full validation, PostgreSQL, CI and DEE-653 are green before squash merge.

Rollback is one revert PR of the squash merge. The additive nullable column remains safe for historical v1 rows and can be removed only in a separately governed cleanup.
