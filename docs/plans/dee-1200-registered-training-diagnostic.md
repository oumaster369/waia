---
integrationIssue: DEE-1200
integrationTitle: "AI-TRADER: execute registered DEVELOPMENT training diagnostics safely"
parentIssue: DEE-1159
branch: dee-1200-registered-training-diagnostic
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation, no-production-migration]
state:
  status: in-progress
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2]
  nextAction: "Rebase onto merged DEE-1183, execute all eight native suites on a fresh database, bind final review and local readiness, then publish for exact-head CI."
provenance:
  createdFrom: "2026-10-01 bounded DEE-1159 engineering decomposition"
  supersedes: null
---

# DEE-1200 — registered DEVELOPMENT training diagnostic

## Scope

This child extracts one bounded, registered DEVELOPMENT diagnostic stage from the broader DEE-1159 research-executable program. The slice includes the immutable experiment/attempt identities, bounded training input, isolated mock ledger, shared stop-sizing and lookback kernel, and one atomic actual-runner diagnostic with append-only trace. The staged source remains a non-qualifying engineering trace: it does not pick a family winner, score validation/walk-forward/blind partitions, establish scientific evidence, provide production readiness, or enable capital/live execution. The parent plan [DEE-1159](dee-1159-research-executable-identity.md) retains the broader same-executable train/validation/walk-forward/blind acceptance.

The current native evidence includes a retained six-pass/one-fail RED and a corrected seven-pass/zero-fail diagnostic run. The eight-suite CI gate is implemented and independently source-reviewed; combined native execution on the integrated base and exact published-head CI are still pending; previous native receipts do not substitute for the final integrated run on the published head.

CI uses a fresh PostgreSQL 16 service database, applies the checked-in migration journal normally to that disposable database, and applies only the three unnumbered DEE-1159 draft SQL payloads needed by these tests. The draft payloads remain outside the canonical migration journal; this is not a production migration or rollout.

The runner must reject any non-CI, non-loopback, unexpected database, wrong PostgreSQL major, missing draft/test file, failed suite, skipped suite, empty suite, or incomplete report. It must emit a bounded receipt identifying the exact source manifest and suite counts without exposing database credentials. The blind-ingress suite is owned by the separate DEE-1183 work and is a dependency; this child must not copy or recreate that test.

## WP-1 — registered DEVELOPMENT diagnostic slice

Keep registration-before-execution, exact organization/attempt/trial scope, DEVELOPMENT-only source input, bounded records, and actual selected lookback execution bound to the real signal/evaluation and isolated mock-order accounting path. Persist the result atomically with orders, fills, events and economics; matching retries must verify the immutable committed trace, while failures leave no partial stage ledger. Preserve explicit `TRAINING_ENGINEERING_TRACE_ONLY`, `scientificQualified:false`, `capitalEligible:false`, requested executable/PIT/source digests unverified, and both full Guardian qualifications `UNQUALIFIED`.

The recorded old-code counterexample had six passing assertions and one failure; corrected native behavior passed seven assertions with zero failures/skips. Combined evidence must include all seven neighboring registry, input, ledger, blind-boundary and provenance suites as well as the diagnostic suite. This is engineering verification only.

## WP-2 — required isolated PostgreSQL CI gate

Append a dedicated workflow job using a fresh PostgreSQL 16 service and a test-only database URL. Bootstrap the ordinary current-main schema through the repository auth prelude and official migrator, then apply the three exact staged SQL files directly to this ephemeral test database. Run the eight exact native suites serially with PostgreSQL integration enabled and validate Vitest JSON so every expected file executes, each has at least one passing assertion, and there are zero failed, skipped, or todo assertions. Preserve all behavioral assertions and production migration/journal files; the scoped-ledger test receives only the explicit CI target allowance described below.

The independent CI review found that the scoped-ledger suite's existing local-only database guard rejects the dedicated CI service tuple. Preserve that exact local allowance and add only the exact disposable CI tuple when both CI indicators and the paired database URLs match. Explicitly set the PostgreSQL backend for the proof job. A missing PR730 blind-ingress suite remains a refusal until the real base contains it.

## Acceptance

- The extracted diagnostic preserves its registered DEVELOPMENT scope, atomic ledger behavior, and explicit non-qualification limits.
- The canonical plan and CI wiring clearly identify this as synthetic PostgreSQL-only proof, not scientific qualification or production readiness.
- A dedicated PostgreSQL 16 CI job runs the exact eight DEE-1159 suites on an isolated fresh database and fails closed on missing inputs, wrong endpoint/version, skips, failures, or empty reports.
- The three staged DDL payloads are applied only to the disposable CI test database; the canonical migration journal is untouched.
- Existing registered diagnostic behavior and assertions are unchanged; no live capability, holdout authority, financial policy, or claim of scientific qualification is added.
- Bounded diagnostic and CI source reviews are complete with findings corrected; final source binding, integrated native proof and published-head CI remain pending.
