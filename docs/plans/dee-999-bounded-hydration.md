---
integrationIssue: DEE-999
integrationTitle: "Byte-exact bounded hydration acceleration"
branch: dee-999-bounded-hydration
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Synchronize final base and publish the independently reviewed local implementation after PR governance; exact-head CI remains required. No original-corpus execution."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-999 — bounded private hydration validation

## Authority and evidence

The user resumed autonomous historical readiness work on2026-09-12, after
authorizing necessary local fixes and decision-making. This plan exercises that
engineering scope, not a new scientific/production/Human-ratification authority.
Root prepared a draft and created this isolated branch before code changes.
Base5edd55114f088a5adea00866c337d4273f702c2a. One issue, plan, branch and future PR.

Full original BTC30 package hydration reached its3600s diagnostic limit without
a report. It was not restarted. Local unchanged-code CPU profiles found repeated
component quantization and decoding dominant, not proven O(n²) or a deadlock.
A separate bounded immutable-snapshot suffix prototype matched reference bytes:
18 tests PASS. At syntheticN1000/K50, original pool-only validation median247.31ms
versus26.49ms end-to-end prototype including snapshot/allocation/cleanup,4 trials.
This is not full hydration or production speed/ETA. Original code remained unchanged.

## Goal and non-goals

Remove repeated source-anchor suffix serialization in private hydration validation
while retaining every source/draw/chunk/manifest/content/pool verification. Preserve
canonical bytes, numerical laws, quantizer, headers, ordinals and mutable public
pool-digest semantics. No package encoding or sampling change, new score protocol,
dataset/capacity reduction, skip-on-error, new admission flag or forged receipt.

No migrations, application deployment, checkpoint writes, full-corpus retry,
Forecast/bootstrap, scientific evaluation, private credentials, live/capital,
blind holdout or Human-gate changes. Brier/Cody and native bootstrap integration
are separate issues. This optimization does not authorize old artifacts in a new
release; explicit original-provenance reuse admission remains DEE991 work.

## Work packages and files

- WP-1: private decoded-package ownership boundary and bounded suffix byte reuse
  in lib/trader/intelligence/forecast-v2/predictive-package-codec-v1.ts; at most
  one adjacent helper and focused tests. Keep original pool-semantic-digest-v1.ts
  untouched when feasible; any necessary refactor must preserve its public API
  and all original byte behavior. No caller-supplied cache/digest bytes.
- WP-2: original codec/digest/quantizer and new differential/negative tests,
  end-to-end bounded synthetic hydration benchmark, lint/typecheck/build and
  independent exact-diff review before publication. Root owns integration/PR.

## Ownership, memory and fallback contract

Only a single synchronous final-validation operation over a privately assembled
decoded package may share bytes across pools. No global cache or reuse across
hydration calls. Do not mutate or freeze original returned package objects.
If private ownership cannot be demonstrated, use owned snapshot isolation rather
than assume mutable caller data is immutable. Both sync and async hydration retain
their original verification stages; no new public trust/skip switch.

Use an explicit finite arena/index backing cap and scoped cleanup; account for
object/index-map overhead separately. A backing cap is not a total heap guarantee.
Capacity exhaustion or unsupported optimization size/shape falls back to original
full validation, not reduced checks or rejection of otherwise valid packages.
No environment knobs, dependencies or changes to scientific identity fields.

## Acceptance

Reference exact-stream/digest equality including repeated anchors/K50, all states,
shuffled/duplicate ordinals, binary64 extrema/subnormals/signed zero and rounding
boundaries, cap0/partial/full, independent lifetimes and alias/mutation safety.
All original malformed source/draw/chunk/manifest/pool digest refusals remain.
Full codec round trips prove the integration; pool-only prototype tests do not.
End-to-end timing includes ownership setup, allocation, all checks and cleanup.
Measured memory and finite cap/fallback behavior recorded honestly, no production
speed guarantee. Lint/typecheck/build/targeted tests and required exact-head CI,
independent review with no P1/P2, base freshness required before merge.

## Rollback

Revert the isolated optimization to original full verification, without data or
checkpoint changes. No scientific receipt may be relabeled or downgraded. A failed
benchmark or review keeps the patch local; no production retry to obtain a PASS.

## Local implementation evidence (2026-09-12)

WP-1 changes only the codec and one adjacent internal helper. The original
`pool-semantic-digest-v1.ts` and quantizer remain untouched. Encoding still invokes
the original public mutable digest implementation; no hydrate signature, caller
trust switch, environment option, scientific identity or serialized record changed.

### Ownership proof and unchanged checks

`unpack` constructs fresh plain objects/arrays from parsed chunk text. The common
assembler consumes all records, constructs pools referring only to its own corpus,
and checks the expected package identity before final validation. Its final call is
synchronous in both sync and async hydration: no await, source iterator or caller
callback runs between pool checks. No decoded source/package reference is published
until this scope closes. The async transport's later awaited cursor cleanup occurs
after the cache has already been released. Returned objects are neither frozen nor
modified, and no cache is attached to them.

The existing validator retains its source/order/count/family/generation checks,
every pool count/ordinal/coverage/digest check, replica digest, package content and
target-grid checks. Only the private pool-digest computation is substituted.
Headers and per-observation ordinals are emitted on every call. Canonical anchor
suffixes may be reused only during this one uninterrupted validation operation.

### Fixed resource policy and complete fallback

Arena plus two Uint32 backing tables are capped at64MiB, and the object-index Map
at262144 entries. For small packages, the tables take8N bytes and the arena budget
is512N bytes (subject to both caps), not64MiB per call. Grouping is limited to
ordinary source fields up to256 characters and an8KiB finite-number suffix.
Unusual valid source text takes the original field emission path. Insufficient
capacity computes/emits every uncached suffix with the unchanged quantizer;
allocation failure delegates to the complete original pool-digest function.
Finally cleanup clears the index Map and releases arena/tables on success or error.

This is a backing-store cap, not a total heap guarantee. Object-index Map entries,
Buffer wrappers, sorted observation arrays, temporary suffixes and crypto state
have additional runtime-dependent overhead. The262144 entry limit is below the
original approximately1.58M source corpus: this policy does not cache the entire
original dataset and is not evidence that it solves the3600s hydration limit.

### Completed local validation

-23 new focused tests plus37 unchanged codec,15 unchanged pool-streaming and15
 unchanged quantizer tests:90/90 PASS. Existing codec fixture sampling remained
 bounded synthetic regression testing; no original corpus or server was used.
- Full byte-stream and digest differentials; K2/K50 complete sync+async equality
 against the original full validator; exact encode/round-trip parity; mutable
 returned records; all finite binary64 adversaries, partial/zero/full cache
 coverage, proportional/max allocation, allocation failure and scope cleanup.
- Malformed source/vector/draw/ordinal/pool-count/pool-digest/chunk failures retain
 identical rejection messages against uncached validation. Original manifest,
 async cleanup and transport failure tests remain green.
- K2 and K50 instrumented hydration tests retain the full package result while
 proving13N pool-component quantizations plus6 grid quantizations, not13NK.
- Path-scoped ESLint, full project no-emit TypeScript and diff whitespace checks PASS.
 Application build, independent review and exact-head integration/CI gates remain
 WP-2/root work; no PR/commit/deployment was performed by the implementation agent.

### Bounded full-codec benchmark

The local artifact `trader-hydration-integration-benchmark-2026-09-12` records source
hashes and all timings. It compares the unchanged codec with the new codec using
the preceding data-only synthetic fixture, without Forecast/bootstrap/package
producer calls. Timing includes complete synchronous hydration: parsing, all
checks, private ownership, allocation and cleanup. Each result is deep-equal to
the original package. No cloning is needed inside the proven private phase.

Apple M5/Darwin arm64/Node22.22.3 measured medians (original→optimized):

| N / K | Trials | Full hydration median | Local ratio |
|---|---:|---:|---:|
|1000 /2|8|18.42→13.49ms|1.37×|
|2000 /2|8|36.81→24.98ms|1.47×|
|1000 /4|8|30.39→15.15ms|2.01×|
|1000 /50|4|291.46→62.39ms|4.67×|

Every case was externally capped at55seconds and512MiB V8 old-space. Observed
whole-process maximum RSS including fixture and both implementations was about
94.4/106.9/94.9/123.1MiB. The cache backing allocation for these small cases is
520000/1040000/520000/520000 bytes. No production speedup, full-corpus coverage,
reuse admission or recovery completion time is inferred from these measurements.

### Root acceptance checkpoint

The root integrator additionally ran the8 Reality V2 consumer-graph tests: PASS,
without changing the pinned graph. Full project ESLint passed with0errors and307
existing warnings. The unchanged `pnpm build` completed successfully using a new
private local SQLite build fixture and this worktree's isolated dependencies.
No PostgreSQL/production migration or deployment was run for this change.

Two local setup failures are preserved rather than counted as code passes: the
shared dependency directory initially lacked the pinned better-sqlite3 native
binary; after installing that dependency's existing prebuild, Turbopack rejected
the root-created cross-worktree node_modules symlink. Root preserved that symlink
in the private fixture directory and cloned the dependencies locally. The actual
default Turbopack build then passed; no source/config/lockfile, bundler switch,
typecheck suppression or validation gate was altered to obtain the result.

An independent read-only review found no P1/P2 in codec/helper/focused tests. It
verified fresh unpublished ownership, synchronous scope, original header/ordinal/
suffix byte parity, bounded backing/index, complete fallback and cleanup. It did
not execute the original corpus and explicitly rejected full-corpus performance
extrapolation. Reviewed source SHA256 values:

- codec: f6b9d789997846db79bb713c29438aad270e50755a6d1e2f332cbfdcba5d73e7
- helper: 3df1683ba397d0e9470708408f54d34d00dfc9d3be670701bf144a6ef01418ed
- focused tests: 6255b58ed22031a2677395abbe8237ce90a9ead00e6b99788a646cd2027e8031

Logs retained locally: `/private/tmp/waia-dee999-full-lint.log`,
`/private/tmp/waia-dee999-consumer-graph2.log`,
`/private/tmp/waia-dee999-build-local-deps.log` and the earlier failed setup logs.
Exact-head GitHub CI and final base freshness are still pending at this checkpoint.
