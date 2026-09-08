---
integrationIssue: DEE-963
integrationTitle: "AI-TWIN — isolated epistemic correction kernel integration"
branch: dee-963-ai-twin-epistemic-kernel
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, build, unit, canon, pr-governance]
approvalGates: [plan-approved, human-merge]
includedIssues: []
state: { status: in-progress, currentWorkPackage: WP-1, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: null, nextAction: "Reuse the admitted inert kernel, reproduce purpose isolation defects, validate and independently review one complete integration." }
provenance: { createdFrom: DEE-871, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-963 — Isolated epistemic correction kernel

## Admission and integration boundary

The Human explicitly resumed autonomous AI-TWIN implementation and normal self-managed PR/merge on 2026-09-08, retaining strict AI-TRADER and production exclusion. One integrator owns all five scoped files in a new worktree from origin/main 8023bb1980d9f02e61db4024f725aa16161c32dd. Existing worktrees and unpushed DEE-871 history remain intact.

This distinct T1 integration reuses DEE-871 WP-1a commit b1b62b058a754bfa7b2f729fd02458c582cade68. It does not restart the program or complete DEE-871. The split has independent reversible value (tested deterministic reference semantics) and different risk/privacy gates from T3 persistence, as permitted by INTEGRATION-BOUNDARY-POLICY. No runtime callers, I/O or storage are introduced. One issue, plan, branch, PR and squash for the complete kernel; no per-test PRs.

Sources: Human resumption and merge delegation in the current WAIA task; Canonical Algorithm sections 2–3 and 6; merged DEE-130; DEE-871 issue and four comments read 2026-09-08. Prior audit source limitations remain in the existing evidence baseline; this admission does not claim all chats were reread.

## WP-1 — Reuse and harden

Synthetic self-report -> model interpretation -> explicit Human correction -> current projection. Preserve original evidence, prior versions, uncertainty, source, consent and purpose. Human endorsement is not factual verification. Add failing regression tests before fixes for confirmed purpose/input boundary defects. Scope strings and current grants are trusted adapter inputs, not authentication proof.

Acceptance: explicit correction changes the projection without overwriting history; model cannot ratify for the Human; scope, purpose, current consent, dense evidence arrays, strict input shape, idempotent retries and optimistic revisions fail closed. Revocation/expiry filters use, not physical deletion. No numerical or indefinite retention policy is invented.

## WP-2 — Integration proof

Run focused kernel tests, lint, typecheck, build, canonical validation and PR governance; independent read-only exact-head review. Full unit and all required checks are authoritative on GitHub PR CI; no redundant full local suite. No UI change, therefore no additional browser scenario is claimed. Refresh main before publication/merge, inspect overlap, use normal squash with exact head, verify squash containment and close only DEE-963.

## Files and excluded surfaces

- lib/ai-twin/model/contracts.ts
- lib/ai-twin/model/ledger.ts
- tests/unit/ai-twin-model-ledger.test.ts
- This plan and DEE-871 plan (historical handoff only).

No shared auth, database/schema/migrations, AI Gateway, runtime API/UI, external provider, sensor, biometric content, real personal data, logging, environment/secret/configuration change, production or automation. No AI-TRADER issue/PR/worktree/process/server/data operation. Verify no production imports. Full DEE-871 and dependent DEE-874/875/876 remain incomplete; purpose filtering is not consent-storage or RLS qualification.

## Remaining Human/persistence gates

DEE-871 WP-1b still requires reviewed raw/derived/corrections-consent/audit/export-index/backup retention, rights propagation, historical consent and access policy. All new policy proposals remain Proposed, not Ratified. A merged inert kernel cannot waive these gates. Deployment and production migration require separate permission.

## Validation receipt

Implementation sequence: admitted local kernel b1b62b058a754bfa7b2f729fd02458c582cade68 reused as ba34f82a; purpose/input hardening 92cfdf59331c348b596b83e2337b37f5e50d7a7c; array-boundary fix c374aceb627ee9d7f354b5c71766f3d909174805 plus explicit undefined return in the synthetic iterator fixture.

- Purpose provenance and null/undefined input tests initially produced 4 failures out of 29; fixes passed 29/29.
- Independent read-only review at 92cfdf59 reproduced an array-shape defect: extra content was stored but not fingerprinted; a custom iterator could disguise a missing evidence element. Two additional regressions failed before the fix. Dense ordinary arrays with only own data indices are now required; a third custom-iterator regression covers the stronger evidence-free scenario.
- Final focused suite: 32/32 pass. Typecheck passes after correcting the synthetic iterator return type. Lint passes with zero errors and 307 existing warnings outside this batch; scoped kernel lint has no findings. Local build passes (16 static generation items). Initial sandbox build failed on localhost EPERM; only the local build was retried with the necessary permission.
- Canonical validator regression and 147 tracked canonical files pass; PR-governance regression passes. Revalidate changed plans before publication. No runtime imports found outside the kernel/test. No browser qualification is claimed for this inert module.
- Fresh origin/main on 2026-09-08 remains 8023bb1980d9f02e61db4024f725aa16161c32dd. Open Trader PR561 is read-only context, not controlled by this batch.
- Cloudflare skill-guided read-only check at 08:19 UTC: both main and branch commands use versions upload, not traffic deployment; no settings edited. GitHub optional preview deployment must be prevented for this PR only; required CI protections are not weakened. [Cloudflare version/deployment semantics](https://developers.cloudflare.com/workers/versions-and-deployments/) distinguish upload from active traffic.

Reviewability exception: five scoped files, approximately 1,000 added lines, including two contract/history plans and synthetic negative fixtures. The three implementation/test files form one small invariant-bound kernel; splitting per test or file would remove meaningful review context. No unrelated refactor or platform change is included.

Final exact-head independent re-review, required PR CI, squash identity/containment and scoped Linear closeout remain integration gates. Record their receipts on the single PR and DEE-963; no status-only post-merge PR.
