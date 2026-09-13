---
integrationIssue: DEE-1002
integrationTitle: "CI — preserve complete unit-suite coverage with isolated bounded shards"
branch: dee-1002-unit-shards
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, unit, build, canonical-plan, independent-review, exact-head-ci]
approvalGates: [plan-approved, integration-ready, root-publication, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-13T01:33:30Z"
  blockedReason: null
  nextAction: "Root publication after local integration-ready checks; full exact-head CI remains pending."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Scope and approval

DEE-1002 (`93a8229b-2250-40cb-b26e-39fe1eaf8b02`) authorizes this isolated infra
implementation after PR582 hit the unchanged3600s unit watchdog twice. Root
delegated local implementation on2026-09-13 under the user's necessary-engineering
authority. Base is freshly fetched `origin/main`7e0498f7a7e922d35a5c1ca6d61e1bf995e1c76d.
No third blind full-suite rerun. RiskT3 concerns CI acceptance aggregation, not
deployment topology; root retains publication/integration and independent review.

## WP-1 — isolated execution and complete evidence

Change only `.github/workflows/ci.yml`, a minimal `scripts/github` shard-evidence
helper and focused `tests/unit` regressions, plus this plan. Use installed
Vitest2.1.9 native two-way sharding and blob reports, same Node22/pnpm10/config,
full Git history, fresh runner-local SQLite migrations and existing sequential
file execution/isolation. Matrix fail-fast is false; no shared writable fixture
artifacts. Retain70-minute job bound and3600-second existing subprocess watchdog.

Keep job ID `test` and required check name `unit tests` as an `always()` aggregate.
Require every shard success plus both fresh source/run/attempt-bound reports.
Compare exact full file discovery with disjoint shard discovery and actual report
file coverage; missing, duplicate, extra, stale, malformed, failed, cancelled or
skipped shard evidence refuses. Existing intentional skipped tests remain skips
and represented in coverage, never reclassified as executed passing tests.
Preserve complete shard logs and reports without secrets. No report content from
another workflow run/attempt may satisfy this run. Existing build/E2E dependencies
on `test` and all other gates remain unchanged.

## WP-2 — validation and handoff

Inspect actual installed CLI discovery/sharding/blob/merge behavior without running
repository fixtures. Prove the complete discovery partition locally and exercise
bounded synthetic passing/failing/skipped fixtures through actual two-shard/report
CLI paths. Focused regressions must reject inventory/report omissions, duplicates,
extras, stale identities and non-success shard outcomes. Run affected unit tests,
full typecheck, scoped lint and plan checks. Root owns full lint/build and later
publication; exact-head GitHub full-unit/PG/build/E2E/all-required gates and final
independent diff review remain mandatory. No guaranteed duration claim.

## Do not change

No tests removed, skipped or weakened; no pool, isolation, assertion, scientific,
application, schema, dependency, timeout or branch-protection change. No
continue-on-error, retry-on-failure, production/server actions, original data,
main push, PR or merge by this implementation agent. Preserve timeout logs and
all other worktrees/WIP. Rollback is this single isolated CI change, no data repair.

## Validation evidence

Approved plan was committed before implementation at904bc980. Applicable repository
AGENTS, execution contract, lifecycle, risk tiers and canonical plan rules and full
Linear issue were read. Implementation is confined to this plan, workflow,
`scripts/github/unit-shard-evidence.mjs` and `tests/unit/ci-unit-shards.test.ts`.

Actual installed Vitest2.1.9 discovery confirmed `list --filesOnly --shard=1/2`
still returns the FULL list. The helper therefore uses the same non-collecting
`listFiles()` path and exported native `BaseSequencer.shard`, with resolved
single-pool/default-sequencer/isolation/sequential-config checks. Repository
files-only discovery at current working tree:1181 files;591+590 disjoint complete
native partition, digest66b0315115bf813f39c180991c0f11223df8576183fb0a35aa64f25f9bd55be8.
No repository fixture was collected or executed for discovery.

Final local focused13tests PASS/0skips (3.29s); actual bounded synthetic CLI shards
and native blob merge prove pass/skip/todo preservation, failed-shard refusal and
missing/duplicate actual report coverage. Side-effect markers prove discovery and
native merge do not execute fixtures. Additional regressions cover stale run/SHA/
attempt, malformed/extra/altered/missing evidence, non-success outcomes and pnpm
hard-linked dependency metadata. An initial root review caught the dependency
hard-link assumption; version lookup is now separate from strict artifact reads.
Full typecheck, scoped lint, existing watchdog regression and canonical docs PASS.
Logs: `/private/tmp/waia-dee1002-{focused,typecheck,scoped-lint,watchdog,discovery,plan}.log`.
These are working-tree validations, not a claim that904bc980 contains the code;
`lastValidatedGitSha` stays null until the implementation freeze.

Root separately reports default build PASS on this isolated base/dependency copy
and full lint PASS with307 existing warnings on the CI/helper/test working tree.
No application/config/dependency/lockfile changed; later edits received focused
checks. Full GitHub unit/PG/build/E2E/required gates, final independent review and
PR governance/publication remain pending. Do not repeat a full local unit suite.

## Failure and retry evidence

Each shard retains the unchanged3600s watchdog and70-minute outer bound, and
uploads its full log plus native blob, merged file report and run/SHA/config/lock/
attempt-bound receipts. The existing `test`/`unit tests` aggregate runs `always()`
and rejects non-success matrix state BEFORE checkout/download; downloaded evidence
must then have exactly both expected shard directories and complete hash-bound
file inventory (CI job/source trust, not cryptographic job attestation).
Actual per-shard and combined native merge coverage must agree with fresh discovery.
Intentional skips remain explicit skipped/todo counts, not passed tests.

**Retry policy: rerun ALL jobs in a new workflow attempt.** GitHub's failed-jobs-only
retry may retain an earlier successful shard, but its earlier-attempt artifact
cannot satisfy the fresh attempt. This refuses safely; no automatic rerun or stale
artifact fallback is introduced. Original PR582 timeout evidence is retained by
root (run34723058921 attempts1/2); no third blind rerun was performed here.

## Independent review and publication readiness

Independent reviewer completed the frozen implementation diff with no unresolved
P1/P2. A separate exact main-CLI prepare → actual two-shard dot/blob execution →
seal → aggregate experiment passed: four files, two passed tests, one skipped and
one todo. Wrong attempt, wrong SHA, failed aggregate and reused output were refused;
markers confirmed no fixture execution during discovery or merge. Review log SHA256:
14112eb0ded0627bc0df523457438c701e80bb07ab56ed1b4b4f5d31c2876516.
All sixteen pre-existing non-test job blocks are byte-identical; build dependencies,
watchdog, Vitest configuration, setup and lockfile are unchanged. Root PR preflight
and the complete `validate:pr-governance` regression command passed. This local
review does not claim hosted artifact transport or authoritative full CI PASS.
