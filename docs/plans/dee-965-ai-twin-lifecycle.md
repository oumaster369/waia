---
integrationIssue: DEE-965
integrationTitle: "AI-TWIN — ratified retention and inheritable experience lifecycle foundation"
branch: dee-965-ai-twin-lifecycle
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, build, unit, canon, pr-governance]
approvalGates: [plan-approved, human-merge]
includedIssues: []
state: { status: in-review, currentWorkPackage: WP-2, completedWorkPackages: [WP-1], remainingWorkPackages: [WP-2], prNumber: null, prUrl: null, lastValidatedGitSha: 639cba7bc3dc994328c8100dc4ebdee9de05a061, lastValidationAt: "2026-09-08T11:16:00Z", blockedReason: null, nextAction: "Follow required exact-head CI, then normal Human-delegated squash and scoped closeout on DEE-965; no shared migration or runtime activation. PR linkage and final receipts belong in Linear, not a second post-merge PR." }
provenance: { createdFrom: DEE-871, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-965 — Retention and inheritable experience foundation

## Admission and boundary

The Human approved the numeric retention recommendation and three-layer experience proposal in the current AI-TWIN task on 2026-09-08, preserving conditional receipt retention and separate inheritance-release gates. This integrates the approved policy into the existing canon, not a competing main document. Approval is product authority, not proof of deployed compliance.

Verified base: 40669e6bea60ecb8fb0709c4bb72794d0b36157b (merged PR563). Separate worktree waia-twin-persistence-20260908, now primary branch dee-965-ai-twin-lifecycle. The old DEE-871 worktree/history is preserved unchanged. One integrator owns all admitted files; the independent reviewer is read-only.

Actual migration conflict: lib/trader/observability/fhv-v2-postgres-schema-preflight.ts fixes the maximum at 204 and rejects every unknown applied hash; its unit fixture reads the complete shared journal. Adding a Twin journal entry would invalidate that contract. No Trader code/test/journal fix is admitted. Full DEE-871 persistence remains gated by separately coordinated compatibility and privacy/migration proof.

This is a distinct reversible T1 policy/reference integration, not a T3 persistence PR or a partial claim of DEE-871 completion. The split is justified by the demonstrated shared-migration boundary and different admission gates. It delivers one complete lifecycle function and Human-controlled private experience format; no further per-file or per-test PR. Human's existing task-creation and normal self-managed merge authority applies only to this Twin scope.

## WP-1 — Canon and deterministic lifecycle

Update Canonical Algorithm with working/personal/legacy layers, explicit approved TTL anchors, removal overriding ordinary append history, independent purposes and conditional receipts. Record durable rationale in ADR-0033 and reconcile only the existing Twin ADR index row. Preserve previous Proposed packet as dated history in DEE-871.

Implement lib/ai-twin/model/lifecycle.ts, without I/O, environment, logging, runtime imports or implicit clock. Trusted server-adapter inputs are not an authentication implementation. Inputs identify exact scope, record class, source eligibility, purpose authorization and applicable explicit time anchors. Output is a plan, never deletion evidence. Retention does not confer modelling or disclosure rights. Archive has no automatic TTL only when independently Human-authorized; deletion or ended purpose still wins. Model reviews do not refresh evidence; hypotheses require substantial-evidence timestamps. Receipt extension is unavailable without an explicit reviewed limit/basis; no built-in 12-month extension.

Private experience composition separates context, intention/options, decision/reasons, expected and observed outcomes, Human lessons and reinterpretations. Use versioned explicit Human approval bound to one record/revision/scope and authorized provenance. Unknown outcomes remain unknown. Composition cannot preserve a deleted source automatically or create transfer rights; lifetime/postmortem/common-knowledge permissions remain distinct future protocols.

First synthetic scenario: a dialogue expires at 90 days; a separately Human-approved experience record does not inherit the dialogue TTL, but cannot be promoted automatically, cannot depend on a deleted-only source, and is excluded immediately upon its own removal request. RED tests precede implementation.

## WP-2 — Qualification and one integration

Focused tests: tests/unit/ai-twin-model-lifecycle.test.ts and existing tests/unit/ai-twin-model-ledger.test.ts. Cover exact expiry boundaries, invalid/future dates, missing authorization, source ineligibility, both tenant dimensions, revision-bound archive approval, stale evidence, no implied inheritance, 7/30-day erasure targets from the same request and conditional receipt expiry. Run lint/typecheck/build/canon and PR governance; independent read-only code review, all required exact-head PR checks, then normal scoped squash under Human delegation. No redundant full local unit suite; no UI or DB qualification claim.

Before publication and merge: refresh main, inspect open priority Trader PRs and overlap; do not invalidate an active priority integration. No deployment; check optional preview side effects before push. Full persistence, backup/processor erasure feasibility, account-deletion legacy handling, identity/recipient verification, jurisdiction-specific inheritance release and historical consent remain explicit unfinished gates.

## Exclusive file inventory

- This plan and docs/plans/dee-871-ai-twin-epistemic-ledger.md.
- docs/ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md.
- docs/adr/0033-ai-twin-memory-retention-and-experience-legacy.md and docs/adr/README.md.
- lib/ai-twin/model/lifecycle.ts.
- tests/unit/ai-twin-model-lifecycle.test.ts.

No shared authentication/database/migrations/Gateway/runtime/UI/configuration/CI changes. No production data, secrets, external services, biometric processing, real-world actions or automation. Do not operate Trader resources or edit its Linear records. DEE-871 and downstream full prerequisites stay open.

## Local evidence — 2026-09-08

- Plan admission 37088e5b87ab802f192fa811fe4aee5998f2fc2a preceded implementation. Initial RED was a missing-module import failure (zero executed assertions), not a behavioral test pass/fail claim.
- First implementation passed 65 focused cases. Independent review reproduced composition ignoring a current removal request and relying on historical source eligibility; integrator also identified undeclared payload-field acceptance. Two new behavioral regressions failed before the fix (30 pass / 2 fail). Composition now requires identity-bound current lifecycle and independently current source eligibility, exact payload fields and immutable approved output.
- Final local focused run: 70/70 (35 existing ledger + 35 lifecycle). Covers both tenant dimensions, current permission/source denial, revision/content binding, immediate exclusion, exact TTLs and common-request 7/30 targets. These are inert synthetic proofs, not storage/auth/RLS/backup/deletion integration evidence.
- Typecheck/build pass; build generated 16 static items. Lint passes with zero errors and 307 existing warnings outside this batch; scoped new-module lint has no findings. Canon validator regression, 149 tracked canonical files and release identity checks pass; PR-governance regression passes. No production import of the module was found; no UI changed.
- Cloudflare skill-guided read-only check around 11:13 UTC: production and branch commands remain versions upload, not traffic deployment. GitHub repository secret-name inventory contains only LINEAR_API_KEY, so the optional preview deploy is credential-gated off; verify skipped steps on the actual run. No settings/credentials changed. [Cloudflare version/deployment distinction](https://developers.cloudflare.com/workers/versions-and-deployments/) is not a claim that an upload serves production traffic.
- Linear DEE-871 preserves old history with a later decision/compatibility addendum; DEE-894 records future LegacyDirective specification, not transfer activation. No new duplicate legacy epic or cross-program dependency was introduced.

Reviewability exception: seven scoped files, approximately 870 lines including synthetic negative fixtures and canonical decision history. Keep the tightly related lifecycle/approval contract and its regressions together; splitting code from the ratified rules or per fixture would reduce reviewability and increase PR count. No unrelated refactor, database or platform edit.

Independent read-only review accepted implementation head 639cba7bc3dc994328c8100dc4ebdee9de05a061 against unchanged main40669e6b: 70/70 tests independently pass, prior concrete findings resolved, no remaining findings within the inert scope. Subsequent change is this integration receipt only. All seven required exact-head PR checks and normal fresh-head merge remain mandatory; no administrator bypass or auto-merge. No open priority Trader PR was found before publication. DEE-872 and DEE-885 now carry scoped composition/privacy qualification addenda; Backlog and dependencies are preserved.
