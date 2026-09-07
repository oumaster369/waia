# DEE-954 — Stable identity for new historical dataset registrations

Local engineering scope under overnight delegation; no publication, merge, rollout or Human ratification.
Linear: DEE-954. Base: b5c17263465fc525dd46eab8c8a076b1abde1a69.

## Reproduced cause

Same-authority A/B75eb4f45 retains identical proposal/ratification/extent and source content. After the
pre-execution seed,273 new registration rows per side differ only in random database IDs and registration
time. Actual `buildHistoricalDatasetTrustAuthorityV2` applied to all20 issuance cycles proves that changing
only datasetAuthorityId reproduces the other side's trust digest exactly. No persisted evidence is rewritten.
That authority lineage propagates to calibration and final knowledge hashes. Both13-test suites pass,
but cross-run semantic identity is not PASS. Retained diagnostic: dataset-id-causal-reproduction.json.

## Minimal design

Compute a namespace-separated deterministic UUID for a NEW registration from validated organization,
run, cycle and full authority-content digest. Use the repository's existing SHA256-derived UUID layout
(version/variant bits); the full256-bit authority digest remains independently stored and checked.
Add the explicit ID to the existing INSERT. Keep ON CONFLICT on natural scope and exact full-content
lookup unchanged: an existing row returns its existing ID, including legacy random IDs. Changed scope
or payload cannot inherit authority. No migration, old-row rewrite, removed identity binding, new caller
authority, changed scientific formula or altered Human approval.

## Validation / remaining gates

- Pure identity equality, scope/content separation, malformed input rejection and stable vector.
- Actual PostgreSQL insertion, legacy retry and conflicting payload protection.
- Full TypeScript/lint/build; cumulative same-authority execution comparison with all raw fields retained.
- Final exact-head review; publication/merge/deployment remain separately gated.

This fixes one implementation source of replay identity drift, not all remaining readiness gaps.

## Local evidence — 2026-09-07 01:49 UTC

17 focused unit tests, full TypeScript, full eslint and Next build pass. Three actual PostgreSQL17
tests against two NEW synthetic seed-restored stores pass: identical new registration/retry IDs,
legacy random ID and complete immutable row preservation, conflicting authority rejection without
overwrite. The service and source loader are real; the upstream dataset is explicitly synthetic.
Initial test collection failed due to a TypeScript test annotation syntax error before execution;
the annotation was corrected and the bounded test rerun passed. No production writes or RLS changes.
Independent fullgraph comparison after this change remains pending; no readiness or publication claim.
