# ADR-0022: Content-Bound Operator Authorization & Idempotent Research Dataset Lifecycle

**Status:** Accepted (PR2 implementation)
**Date:** 2026-07-08
**Linear:** DEE-398

## Context

The Final Pre-M9 Architectural Readiness Audit identified two remaining Critical findings
after PR1 (DEE-397 / ADR-0021) landed deterministic research replay:

**Task B — Operator blind authorization bound labels, not content.**
`M9BlindAuthorizationScope` carried `datasetName` (a label) and an *optional*
`sidecarContentDigest` that could be `null`, absent, or a real digest — three distinct JSON
shapes that hash differently for the same underlying data. The operator's signed digest never
covered the sealed blind-split bar content (`research_dataset.blind_digest`) itself, so an
operator authorization was really "I authorize a run with this label" rather than "I authorize
this exact replay content." The orchestrator checked the operator digest against the campaign
script's constructed scope, but never re-verified that the *sealed* content at runtime still
matched what the operator saw — a time-of-check-to-time-of-use gap. `scripts/trader/m9-operator-digest.ts`
and `scripts/trader/m9-v2-research-campaign.ts` also built their blind scopes independently,
and diverged (the digest helper omitted `sidecarContentDigest` entirely), so a scope reviewed
by an operator via the digest helper was not provably the same scope the campaign would use.

**Task C — Dataset creation was an unconditional insert.**
`insertResearchDatasetPostgres` always performed a plain `INSERT`. `research_dataset` has a
unique index on `(organization_id, name)` only — no content-based key. Re-running a campaign
under the same `--dataset-name` (e.g. a retried Repeat M9 attempt) would raise a raw unique
violation instead of failing closed with a clear governance reason, and there was no way to
distinguish "this is the same run, safe to reuse" from "this is different content trying to
reuse a name" before the violation occurred.

## Decision

**Invariant:** An operator's blind authorization digest must bind the actual sealed replay
content that will execute — not a label or an incomplete/ambiguous representation of it — and
the orchestrator must re-verify that binding against freshly sealed content before any dataset
persistence or backtest work runs. Dataset creation under a given `(organization_id, name)`
must be idempotent for identical content and must fail closed — never silently overwrite — for
divergent content.

### Task B — content-bound, versioned blind authorization

1. **`M9BlindAuthorizationScopeV2`** (`lib/trader/research/m9-operator-authorization.ts`) adds
   `blindDigest: string` (the sealed blind-split content digest) and makes
   `sidecarContentDigest: string` non-optional, always either a real digest or the
   `M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE` (`"none"`) sentinel — eliminating the
   null-vs-absent divergence. The legacy `M9BlindAuthorizationScopeV1` (label-only, optional
   nullable sidecar digest) is retained only for backward compatibility with any previously
   recorded v1 digests; `computeM9BlindAuthorizationDigest` dispatches on scope shape
   (`m9_blind_authorization_v1` vs `m9_blind_authorization_v2` hash `kind`) so old digests
   remain reproducible. `datasetName` remains present in the v2 scope for provenance/audit
   only — it is not the integrity anchor; `blindDigest` is.
2. **Single canonical scope builder** — `buildM9BlindAuthorizationScope()` is the only place
   the blind scope shape is constructed. Both `scripts/trader/m9-v2-research-campaign.ts` and
   `scripts/trader/m9-operator-digest.ts` call it with the same inputs (campaign scope, dataset
   name, sealed `blindDigest`, sidecar digest); the digest helper resolves `blindDigest` via a
   read-only Postgres bar lookup (`computeM9DatasetSealPreviewPostgres`) so the digest it prints
   is provably the one the campaign will authorize.
3. **Runtime re-verification** — `runResearchPipelinePostgres` seals the dataset, then
   immediately (before dataset persistence, before any backtest work) calls
   `assertM9BlindAuthorizationV2` and independently compares `sealed.blindDigest` and the
   runtime provider-sidecar digest against the authorized scope's values. Any mismatch throws
   `ResearchOrchestratorError("M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH", …)` — fail closed,
   before any side effect.
4. **No silent v1 fallback for Repeat M9 v0.1.7** — `assertM9BlindAuthorizationV2` rejects a
   scope that lacks `blindDigest` (`isM9BlindAuthorizationScopeV2` returns `false`) with an
   explicit error. The orchestrator's operator-authorization gate always calls this v2 assertion,
   so an incomplete v1 scope can never be silently accepted on the M9 v0.1.7 run path.
5. **Repeat M9 v0.1.7 run profile** — `assertM9V017RunProfile()`
   (`lib/trader/research/m9-campaign-flags.ts`) requires `--require-provider-fusion=1`,
   `--enable-guardian-exits=1`, and a v2 provider sidecar to all be present before the campaign
   script does any file or database write. An authorized run can no longer silently omit any of
   these three gates by forgetting a flag.

### Task C — idempotent, content-addressed dataset lifecycle

`lib/trader/research/m9-dataset-preflight.ts` introduces a pure CREATE / REUSE / CONFLICT
decision (`decideM9DatasetPreflight`) and a Postgres-wired resolver
(`resolveM9ResearchDatasetPostgres`) that looks up the existing row by
`(organization_id, name)` (`getResearchDatasetByNamePostgres`) before deciding:

- **CREATE** — no existing row for this `(organization_id, name)`: insert as before.
- **REUSE** — an existing row has matching `symbol`, `interval`, and all three split digests
  and bar counts: return the existing dataset unchanged, no insert.
- **CONFLICT** — an existing row has the same `(organization_id, name)` but *different*
  content: throw `M9DatasetContentConflictError` (`M9_DATASET_CONTENT_CONFLICT`) — fail closed,
  never overwrite, never pick a side.

The orchestrator now calls `resolveM9ResearchDatasetPostgres` instead of an unconditional
insert. No schema change was required — the existing `research_dataset_org_name_unique` index
is sufficient; the preflight is purely an application-level read-before-write guard.

### Ordering

The pipeline now runs: **preflight seal → content-bound authorization verification → dataset
reuse/create → validation → walk-forward → blind gate (single-use lockout,
`markStrategyCandidateBlindUsedPostgres`) → blind holdout.** No authorization record (CLI) or
dataset/candidate row (orchestrator) is written before all fail-fast preflight checks
(run profile, campaign/blind authorization + content match, candidate slot availability) pass.

## Consequences

- An operator's blind authorization now provably covers the exact sealed content and provider
  sidecar that will execute — not a label — and any content drift between authorization time
  and execution time fails closed with a clear governance error instead of silently proceeding.
- Repeat M9 attempts under the same dataset name with identical stored bars reuse the existing
  dataset deterministically; attempts with divergent content under the same name fail closed
  instead of raising a raw Postgres unique-violation or silently overwriting.
- `scripts/trader/m9-operator-digest.ts` now performs a read-only Postgres bar lookup (it
  previously had no database dependency) — still writes nothing and executes no campaign/blind
  logic; this is required to make its printed digest provably identical to what the campaign
  will authorize.
- Digest changes are additive: `M9BlindAuthorizationScopeV1`/`v1` hashing is unchanged and
  remains reproducible for any previously recorded digests; new Repeat M9 v0.1.7+ runs always
  produce a `v2` scope and digest.
- No database migration — `research_dataset_org_name_unique` already provides the key the
  preflight reads against.
- Out of scope for this PR (deferred, unchanged): Postgres CI coverage, Playwright robustness,
  Worker fail-closed changes, ADR-0017 cleanup, discovery wiring, new providers, Repeat M9
  execution itself.

## References

- Implementation: `lib/trader/research/m9-operator-authorization.ts`,
  `lib/trader/research/m9-dataset-preflight.ts`,
  `lib/trader/research/m9-dataset-seal-preview.ts`,
  `lib/trader/research/research-orchestrator.ts`,
  `lib/trader/research/m9-campaign-flags.ts`,
  `lib/trader/market-data/research-dataset-repository-postgres.ts`,
  `scripts/trader/m9-v2-research-campaign.ts`, `scripts/trader/m9-operator-digest.ts`
- Tests: `tests/unit/trader-research-m9-operator-authorization.test.ts`,
  `tests/unit/trader-research-m9-operator-digest.test.ts`,
  `tests/unit/trader-research-m9-dataset-preflight.test.ts`,
  `tests/integration/postgres-research-intelligence-parity.test.ts` (opt-in,
  `WAIA_PG_INTEGRATION=1`)
- Related: ADR-0011 (Single Operator Governance Model — unchanged, this ADR strengthens what
  the operator's authorization binds to, not who authorizes), ADR-0018 (Research Intelligence
  Layer & Market Knowledge Base — unchanged), ADR-0021 (Deterministic Research Replay Clock &
  State Isolation — PR1; this ADR builds on its determinism guarantee, since content-bound
  authorization is only meaningful if replay content is reproducible)
