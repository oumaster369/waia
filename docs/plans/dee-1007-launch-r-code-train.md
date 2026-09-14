---
integrationIssue: DEE-1007
integrationTitle: "Historical launch: integrate strict evidence, durable bootstrap, process truth, and terminal receipts"
branch: dee-1007-launch-r-code-train
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, linear, postgres-ci, github-pr]
executionLabel: backend
requiredValidation: [lint, typecheck, build, unit-targeted, integration-train, canon, pr-governance, independent-exact-head-review, authoritative-pr-ci]
approvalGates: [human-architect-train-authorization, pre-implementation-admission, integration-ready, independent-adversarial-review, dee-653-exact-head-admission, human-h1-squash]
includedIssues:
  - id: DEE-990
    role: process-truth
    completionPolicy: manual-after-exact-head-merge
    status: delivered
  - id: DEE-1004
    role: strict-dual-origin-resolver
    completionPolicy: manual-after-exact-head-merge
    status: delivered
  - id: DEE-1005
    role: durable-bootstrap-scheduler
    completionPolicy: manual-after-exact-head-merge
    status: delivered
  - id: DEE-1006
    role: terminal-receipts
    completionPolicy: manual-after-exact-head-merge
    status: delivered
deferredIssues: []
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP5
  completedWorkPackages: [WP0, WP1, WP2, WP3, WP4]
  remainingWorkPackages: [WP5]
  prNumber: 590
  prUrl: https://github.com/oumaster369/waia/pull/590
  lastValidatedGitSha: 6f7d2364b7edbb721e08e4463ca66b70e78957e3
  lastValidationAt: "2026-09-14T06:51:09Z"
  blockedReason: null
  nextAction: "Independent exact-head review of the first-cycle harness freeze, then one authoritative GitHub CI campaign on the new head; do not merge 585-588; do not merge 590 until that campaign is green plus Human H1-R."
provenance:
  createdFrom: human-architect-authorization
  gapRegistry: null
  supersedes: [DEE-1006-PR-585, DEE-990-PR-586, DEE-1004-PR-587, DEE-1005-PR-588]
humanApproval:
  authorizedAt: "2026-09-13"
  authorizedBaseMain: c6f79636b4aff2f0bf170b4357db7bb0d2abcb73
  previousLaunchExecutionBase: ffb2fd608a3d5496964d6c7d60e5e6f2463c58cc
  originalAuthorizedBaseMain: b45c64f0b3f53d9789ac78503317a7d14330b02e
  authority: "Human Architect authorized two integration boundaries: DEE-950 / PR 589 remains single-issue H1-P; DEE-990+1004+1005+1006 collapse into this Integration Train as H1-R. DEE-1008 / PR 591 Human squash-merged as NEW P; old P ffb2fd60 is superseded for launch execution only. Do not restart Build. Do not combine DEE-950 into this train. Human Architect 2026-09-14 admitted the first-cycle strict-resolver test harness."
  capturedChildHeads:
    DEE-990: 1778dd43e4406762d9b873fd8d641387e38378b1
    DEE-1004: 6c0dd74742c9f935ef907d9165f503a4b806c1bb
    DEE-1005: bfd5bce77afc312cf87fafee663211175d95f7d8
    DEE-1006: d4f4c2034e54d1ce68fca3e4400d16d934947372
---

# DEE-1007 — Historical launch R-code Integration Train

## Authority and boundary

This Integration Batch owns **no new scientific semantics**. It is the single
merge boundary for four already-built children whose original PRs must not merge
individually:

| Wave | Child | Original PR | Exact captured head |
|---|---|---|---|
| 1 | DEE-990 | #586 | `1778dd43e4406762d9b873fd8d641387e38378b1` |
| 2 | DEE-1004 | #587 | `6c0dd74742c9f935ef907d9165f503a4b806c1bb` |
| 3 | DEE-1005 | #588 | `bfd5bce77afc312cf87fafee663211175d95f7d8` |
| 4 | DEE-1006 | #585 | `d4f4c2034e54d1ce68fca3e4400d16d934947372` plus train-only 0208 FHV compatible-additive admission |

DEE-950 / PR #589 remains a separate single-issue producer PR (H1-P). It is not
included. Final R freeze requires both this train and DEE-950 on `main`. C3 does
not wait for this train.

## Overlap proof

Against original common base `b45c64f0b3f53d9789ac78503317a7d14330b02e`, the four child
changed-file inventories are pairwise disjoint (zero overlapping paths), including
the DEE-1006 FHV preflight files. Mechanical cherry-pick in the Architect order
is therefore admissible. Rebased onto exact NEW P `c6f79636b4aff2f0bf170b4357db7bb0d2abcb73` after Human squash-merge of PR #591. Child file blobs remain byte-exact versus captured original heads except `scripts/trader/scientific-checkpoint-store-v1.ts`, which is a documented semantic merge of the NEW P no-build reader with the DEE-1004 runtime identity parameter. Train-only 0208 FHV admission remains byte-exact versus the prior train. Old P `ffb2fd608a3d5496964d6c7d60e5e6f2463c58cc` is superseded for launch execution only and remains valid historical evidence. Any later semantic conflict is a STOP.

## Hard safety

- Do not alter B=10000, baseline family, or scientific gates.
- Do not use DEE-998 native results for admission.
- Do not deploy, apply migration 0208, or mutate the Execution Server.
- Do not touch AI-TWIN.
- Do not edit, force-push, or delete child branches.

## Acceptance

- Admitted → frozen Integration Train manifest validates on this branch.
- Combined tree contains every intended file from the four exact child heads, plus
  only the DEE-1006 FHV compatible-additive admission required for 0208 journal
  identity `1780000000208`.
- Independent exact-head review: unresolved findings = 0.
- One authoritative GitHub CI campaign on the frozen head after DEE-1008 /
  PR #591 NEW P base reconciliation.
- DEE-653 admission required before merge. Human squash-merge only.
