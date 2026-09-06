---
integrationIssue: DEE-940
integrationTitle: "Bound pool-digest memory without changing scientific outputs"
branch: dee-940-streaming-pool-digest
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge, human-production]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 220cbd25cb3ba257e504a4504f1ac033f325179b
  lastValidationAt: "2026-09-06T09:31:00Z"
  blockedReason: null
  nextAction: "Open the single PR, monitor exact-head CI, and preserve merge/production gates"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Approved bounded scope

DEE-940 authorizes incremental pool semantic hashing and focused regression tests.
The root integrator approved this canonical plan within that existing contract.
Exact base: `ea765a999b5818ffab84ea32024809b0098fdf74`.

Change only `pool-semantic-digest-v1.ts`, focused unit tests, and this required plan.
Keep the public canonical-stream builder API, canonical byte order, stable sorting,
validation order and errors, quantization, identities and scientific outputs.
No source-corpus, K/M, anchor, cycle, model, sampling, PIT, permission, migration,
Human ratification, live/capital or blind-holdout changes. No push, PR, merge,
deployment or Linear mutation by the delegated implementation worker.

## Work packages

WP-1: Share the existing canonical chunk emission between the compatibility stream
builder and an incremental SHA-256 sink. The digest path must not retain the field
Buffer array or concatenate the complete serialized pool. Ordered observation
references remain O(N); this task does not eliminate retained replica storage.

WP-2: Compare incremental SHA-256 with the canonical builder and a frozen legacy
oracle for both horizons, all states, shuffled inputs, duplicate ordinals and
invalid inputs. Retain known-answer digests and targeted replica/package/forecast
replay tests. Measure bounded local allocation behavior separately from production.
Root integrator owns normal PR gates and independent exact-head review.

WP-3: Complete root-owned repository validation, independent exact-head review,
PR governance preflight and one PR to main. Merge and production rollout remain
separate gates; this local allocation fix does not authorize either.

## Acceptance and evidentiary limits

- SHA-256 bytes and error class/message remain identical to the base implementation.
- The digest-only path never concatenates the complete pool byte stream.
- Known-answer and targeted model identity/replay regressions pass.
- Bounded memory measurements explicitly identify machine and input scale.
- No historical rehearsal PASS, runtime readiness or economic validity is inferred.

The stopped production preparation exited nonzero without preserved primary stderr;
this separately demonstrated allocation defect is not claimed as its proven cause.
Remaining O(K*N) replica storage and whole-corpus processing are outside this patch.
Rollback is a single code revert through the ordinary release process.

## Local validation evidence

- Four focused unit files passed: 27 tests, no skips. These cover the new legacy
  stream oracle, both horizons/all states, empty/shuffled pools, duplicate-ordinal
  stability, error parity, a 10k-observation no-concat regression, frozen identity
  known answers, empirical-joint replica replay and qualified historical packages.
- Changed code/test lint and repository typecheck (`--incremental false`) passed.
- Isolated local Node v22.22.3/arm64 diagnostics sampled heap usage every 512
  Buffer constructions and at concatenation boundaries after an initial GC.
  At N=1k/5k/10k, legacy sampled heap increases were 5,054,704 / 23,699,040 /
  33,272,176 bytes; incremental increases were 4,058,576 / 4,424,272 / 8,840,240.
  Digests matched at each size. Legacy concatenation retained 18,013 / 90,013 /
  180,013 chunks; incremental used no concatenation. Heap samples depend on GC
  and are not peak-RSS guarantees or production measurements. The change removes
  retained field buffers, not the O(N) sorted-reference array or O(K*N) replicas.
- An initial invalid-input test incorrectly treated a negative integer ordinal as
  forbidden; the canonical validator permits it. The test was corrected to use a
  noninteger ordinal. No production validation rule was changed.

Root repository lint passed with zero errors and 308 existing warnings. Production
Next.js build passed, including TypeScript and 24/24 static pages. The initial
build environment required loopback permission and an isolated frozen-lockfile
dependency installation instead of a cross-worktree node_modules symlink. No
lockfile or application configuration changed.

Independent review of implementation head
`220cbd25cb3ba257e504a4504f1ac033f325179b` found P1=0/P2=0 in the scoped diff;
the reviewer independently ran 21/21 parity/known-answer tests. Root PR governance
regressions and rendered-body preflight passed. Full exact-head PR CI remains
pending; the review does not assert historical or production readiness.
