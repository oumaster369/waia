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
state: { status: in-progress, currentWorkPackage: WP-1, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: null, nextAction: "Implement the approved inert lifecycle and experience foundation; no shared migration registration or runtime activation." }
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
