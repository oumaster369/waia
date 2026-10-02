---
integrationIssue: DEE-1210
integrationTitle: "Stop presenting discovery trade-reference counts as volatility"
branch: dee-1210-discovery-count-band
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, lint, typecheck, build, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [issue-contract, independent-review, required-ci, no-production-data, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: [WP-1-plan-and-baseline, WP-2-versioned-trade-count-band, WP-3-readiness]
  remainingWorkPackages: [WP-3-rejection-context-wording, WP-4-review-and-ci]
  nextAction: "Implement and verify the bounded rejection-context wording extension, then obtain independent review and exact-head CI; do not claim scientific qualification."
provenance:
  createdFrom: "DEE-1210 Linear contract and root implementation contract"
  supersedes: null
---

# DEE-1210 — truthful discovery count bands

## Goal and scope

The dormant structure clusterer currently labels a band derived only from
`tradeRefs.length` as volatility. Make newly generated clusters explicitly
versioned V2 artifacts with a trade-reference count band, retain the existing
`<=1`, `<=5`, `>5` cutpoints, and mark measured volatility unavailable. Keep
the current regime grouping, trade-reference membership, aggregate trade
counts, and observation counts. Bind the new metric and key to a V2 schema and
content digest; the normal clusterer emits V2. New question generation accepts
only a validated V2 cluster and describes the count band accurately.

Preserve V1 types, bytes, keys, digests, and stored question text as immutable
legacy evidence. Do not infer a legacy V1 band as measured volatility or
rewrite historical artifacts. Carry each member observation's trade-reference
count in V2 so validation can check the band per member instead of deriving it
from the aggregate cluster count. Two members with three references each
remain `medium` individually even though their aggregate count is six.

## Change-set shape

This ten-file change is one reviewable contract boundary: the clusterer emits
V2, the question builder validates V2, and the existing registry appends it
without changing the V1 path or storage schema. The two focused test files and
this plan account for more than half the changed lines; the remaining code is
limited to the V2 type, digest, strict validator, producer, question boundary,
and existing registry adapter. No unrelated discovery workflow or authority
surface changed, so one revert cleanly removes the behavior.

## Non-goals

No measured volatility model or new thresholds, activity-rate claim, policy or
financial criteria, source/PIT issuance, empirical qualification, operational
discovery wiring, database migration, actual data, holdout/C3, production
release, or live trading. Do not change empty-regime behavior, no-reinforcement
rules, historical V1 artifacts, or question text already persisted.

## Work packages

- **WP-1 — baseline:** capture the current V1 serialized cluster bytes and
  content digest, plus a failing focused assertion showing the current normal
  producer exposes a trade-count band as `volBucket`. The captured producer
  source hash and canonical V1 fixture are in the DEE-1210 external audit
  receipt; the preserved digest is
  `35f80329f1d154ffc1a9d7aa8ac4fc9847253ba21ee59bb5ffd15edf38d7ea99`.
- **WP-2 — versioned count band:** add an additive V2 cluster type and
  serializer while leaving the V1 type/serializer unchanged. Use a
  version-prefixed signature key and include metric identity, per-member
  counts, counts/band, unavailable-volatility state, and canonical UTC
  `createdAt` in V2 content identity. V2 validation rejects noncanonical or
  normalizing timestamps.
  Emit V2 from the normal clusterer. Validate its schema, exact key, per-member
  count-band consistency, aggregate counts, memberships and digest before
  creating a question; reject V1 or malformed V2 input. New question text
  names the trade-reference count band and says measured volatility is
  unavailable. The existing organization-scoped registry retains its legacy
  V1 scalar-row insert and adds a V2 append path that validates and serializes
  the cluster into the existing opaque JSON column. Before insertion, V2 must
  resolve the referenced campaign by both ID and context organization and
  match its stored content digest and lifecycle state; the historical V1 raw
  row path is unchanged.
- **WP-3 — readiness:** passed 62 focused/adjacent unit tests across ten files.
  Coverage includes counts 0, 1, 2, 5, 6; 3+3 members with aggregate 6
  remaining `medium`; zero-trade regime preservation; exact V1 byte/digest
  preservation; detached caller inputs; createdAt digest and canonical UTC
  timestamp checks; V2 registry serialization and organization-owned campaign
  checks; malformed payload refusal; and question wording. Full ESLint passed
  with 0 errors and 331 repository warnings; typecheck, build, canonical docs,
  and both consumer graph validators passed. The pre-fix review RED is retained
  in `audit-ai-trader-2026-10-01/dee1210/review-fixes-red.json` and `.log`.
  No database or real market data was used. Independent review found that the
  V2 registry validated a caller-owned cluster, awaited campaign lookup, then
  reread mutable fields for insertion. The deferred-query RED is retained in
  `audit-ai-trader-2026-10-01/dee1210/caller-mutation-red.json` and `.log`.
  The registry now validates and detaches the complete canonical V2 artifact
  and copies `createdAt` before its first await. The focused registry/clusterer
  suites pass 38/38 after this correction; scoped lint, typecheck, and diff
  check pass. These 38 tests overlap the earlier 62-test batch and are not
  added to it. The final follow-up evidence is in
  `audit-ai-trader-2026-10-01/dee1210/caller-mutation-followup/`.
- **WP-3 follow-up — rejection-context regime wording (2026-10-02):** the
  validated V2 question builder still hardcodes `TREND_BEAR or STRESS` in its
  rejection-context branch. Use only the already-validated
  `cluster.signature.regimeLabel` in that branch so every supported regime,
  including `CHOP` and `RANGE`, is represented truthfully. Add synthetic
  counterexamples for those labels and controls for `TREND_BEAR`/`STRESS`, and
  verify the content digest over the resulting text. Preserve the count-band,
  question-kind/program selection, digest algorithm, all V1 bytes and stored
  text. No hypothesis-studio, executable mapping, financial rule, scoring or
  source/PIT behavior is included.
- **WP-4 — review and CI:** obtain independent review and pass exact-head CI
  before merge.

## Acceptance

1. Newly emitted V2 clusters expose a trade-reference count band and explicitly
   report measured volatility as unavailable; no `volBucket` is used to label
   the count.
2. Individual observation bands preserve the current cutpoints for counts 0,
   1, 2, 5, and 6. Aggregation never recalculates an individual member's band
   from the cluster aggregate; refs and no-trade known-regime membership are
   preserved.
3. V2 uses a distinct key/schema and content digest that binds canonical UTC
   `createdAt`. A valid legacy V1 fixture
   retains its exact serialized bytes and digest; V1 is not silently accepted
   as V2.
4. Invalid version, metric marker, key, digest, member count, aggregate count,
   band consistency, or noncanonical timestamp is refused before a new research
   question is emitted.
5. The existing registry appends validated V2 payloads through its current
   organization-scoped table path only when the campaign resolves in that org
   with matching stored digest/state, and inserts the exact validated snapshot
   even if caller-owned input is mutated while lookup is pending, while
   retaining legacy V1 insert behavior.
6. Rejection-context question text renders the validated cluster's exact
   `regimeLabel` for all tested regimes, including `CHOP`, `RANGE`,
   `TREND_BEAR`, and `STRESS`, and its canonical question digest matches that
   text. Previously persisted question text remains immutable.
7. Focused and adjacent checks, independent review, and required exact-head CI
   pass. This establishes artifact labeling/integrity only, not volatility
   measurement, provenance, scientific validity, or production use.

## Validation limits

Use synthetic observations only. The clusterer and legacy question builder have
no repository caller outside their definitions. This corrects a dormant
descriptive contract defect; it does not demonstrate production impact or
complete empirical discovery.
