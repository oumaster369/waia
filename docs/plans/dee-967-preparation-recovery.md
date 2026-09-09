---
integrationIssue: DEE-967
integrationTitle: "Historical preparation: journal scheduling and reusable checkpoints"
branch: dee-967-preparation-recovery
riskTier: T3
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit, interruption-resume-parity, tenant-isolation, lint, typecheck, build, canon, independent-exact-head-review]
approvalGates: [human-merge, human-production-rollout]
state:
  status: in-progress
  prNumber: null
  prUrl: null
  blockedReason: null
provenance:
  authoritativeBase: 40669e6bea60ecb8fb0709c4bb72794d0b36157b
  createdFrom: user-approved-recovery-plan-2026-09-08
---

# DEE-967 — Recoverable historical preparation

## Context / intent

Exact8023 preparation failed after long CPU work with PREPARATION_JOURNAL_WRITE_TIMEOUT.
Checked production stores contain no committed reusable results. No original result recovery claim.
User approved targeted diagnosis, correction, reusable checkpoints, interruption/restart proof,
then a verified PR. No full-data rerun until those acceptance gates pass.

## Work packages

1. Reproduce journal I/O starvation using the actual journal and a short controlled scheduling test.
   Inspect trigger/session locks separately; do not call simulated reproduction sole production cause.
2. Ensure pending journal I/O is drained before CPU-bound stages; preserve actual I/O deadline,
   failures, redaction, bounded progress and no authority from diagnostics.
3. Reuse validated immutable scientific computation artifacts across failed attempts. Content-addressed
   identity includes organization, dataset/config/scientific implementation identity. No blind holdout.
   Checkpoint publication must be independently durable and atomic; incomplete/tampered states refuse.
   Preserve final admission transaction and Human gates; intermediate compute artifacts are NOT authority.
4. Eliminate redundant package building where exact verified artifact reuse is equivalent.
5. Prove interrupted/resumed output parity and non-recomputation with fault injection; run focused,
   role/isolation and ordinary readiness gates. Freeze exact head for review and CI.

## Files / boundaries

Historical journal, observer, CLI and scientific composition; existing predictive package codec/storage
where useful; focused unit/integration tests. No application UI, HTX, credentials, live, capital,
deployment or production migration changes. No corpus thinning, reduced K/M/B, relaxed statistical gates
or timeout-only fix. Preserve all other worktrees and AI-TWIN work.

## Acceptance / execution state

- [x] Short failure reproduced before correction (controlled actual-journal scheduling regression).
- [x] Journal correction passes true-timeout and invalid-scope regressions.
- [x] Independently durable checkpoints integrated with exact scope/digest rejection.
- [x] Crash/resume parity and no recompute proof (real package in killed subprocess and KM32+2).
- [ ] Production path package reuse verified without scientific substitution.
- [ ] Local readiness, exact-head CI and independent review.

Only completed checkboxes with actual evidence constitute delivery. This plan is not launch readiness.

## Local evidence — 2026-09-08

- Combined targeted run: 20 files / 190 tests passed, 31.57 seconds.
- Full lint: zero errors, 307 pre-existing repository warnings; no broad warning cleanup in scope.
- TypeScript noEmit passed. Next production build and OpenNext Cloudflare bundle passed.
- Local dependency symlink was replaced by a private worktree copy because Turbopack refuses
  an out-of-root dependency symlink; no build setting or production environment was changed.
- Real SIGKILL test preserves a completed package across a new process; killing before rename
  preserves only partial evidence and forces recomputation of that unfinished artifact.
- Real KM evaluator interruption after 32 of 34 anchors: resume computes only the last two,
  with output equal to uninterrupted calculation. Final statistical criteria remain unchanged.
- No full production corpus has run with this change. PG17 final admission/tenant isolation,
  exact-head CI and independent review remain required, not inferred from the small fixtures.
