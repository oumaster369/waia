---
integrationIssue: DEE-1251
integrationTitle: "Restore reproducible frozen dependency installation"
branch: dee-1251-pin-pnpm-build-toolchain
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [offline-frozen-lock, pnpm-delegation, workflow-version-parity, canonical-plan, pr-governance, current-head-ci]
approvalGates: [independent-source-review, current-head-ci, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: publication
  completedWorkPackages: [reproduce, minimal-fix, targeted-validation, independent-source-review]
  remainingWorkPackages: [draft-pr, current-head-ci, provider-build-verification]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-18"
  blockedReason: null
  nextAction: "Publish one draft PR, observe current-head CI, and retain the provider build gate until actual evidence exists."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1251 — pin the dependency-install toolchain

## Context

The supplied Cloudflare build f9196e1d-3f06-4519-8d1b-80120b878eda for PR 791/head 0558183 reports pnpm 9.10.0 and Node 24.21.0. Its automatic frozen install fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` for `patchedDependencies`, before the build command. Earlier pnpm 10 checks did not reproduce this exact provider version.

The unchanged package, lockfile and PostgreSQL patch reproduce the error with pnpm 9.10.0. That version calculates patch hashes using base32 MD5; the pnpm 10 lockfile contains SHA-256 hex. The patch itself matches the committed hash. pnpm 10.34.1 is also the version recorded in the existing local dependency installation.

## Scope

Pin `packageManager` to `pnpm@10.34.1`, enable pnpm's package-manager version delegation for a pnpm 9 bootstrap, and align the 35 existing GitHub Actions pnpm version declarations. `pnpm/action-setup@v4` rejects conflicting explicit and packageManager versions, including a major-only `10` beside an exact pin.

Keep dependency versions, lockfile, PostgreSQL settlement patch, frozen-install requirements, Node settings and provider settings unchanged. No runtime activation, paid infrastructure, trading or Grok access is included.

## Acceptance

- Original pnpm 9.10.0 reproduces the exact mismatch on unchanged source.
- Original pnpm 10.34.1 accepts frozen lockfile validation.
- Fixed pnpm 9 bootstrap delegates to 10.34.1 and accepts the same frozen validation.
- All 35 action versions match the packageManager pin; lockfile and patch remain byte-identical.
- Current-head CI and an actual provider build remain external gates; local checks do not establish build/upload success.

## Validation

Completed isolated `install --frozen-lockfile --lockfile-only --offline --ignore-scripts` checks under Node 22.22.3. Exact integrity-verified pnpm tarballs were used; the delegation test preseeded only the isolated manager cache. No project node_modules, lifecycle scripts or dependency downloads were needed. The provider's Node 24.21.0 and cold manager download were not exercised locally.

YAML parsing verified all 35 version declarations; `git diff --check` passed. Independent source review approved the seven-file implementation diff. Full local lint/typecheck/unit/build and provider API/browser retries were excluded by the task's bounded validation instruction; this PR remains draft pending current CI and provider evidence.

## Rollout

Review and merge through the ordinary human gate. This change affects the next dependency installation; it does not mutate live configuration or traffic. A rejected frozen lockfile remains a failure and must not be bypassed.

## Current-head CI follow-up

PR 793/head 342c3efe passed the external Workers Builds check and the GitHub OpenNext bundle. The preview deployment job skipped upload because its secrets were unavailable. The account-observation CI contract failed because it deliberately hashes the complete historical `integration` and `historical-postgres17` jobs. For each block, exact comparison against the base proves the only change is `version: 10` to `version: 10.34.1`; update the two expected hashes without weakening that complete-job contract. The remaining current-head checks and independent review of this follow-up remain required.
