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
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  nextAction: "Complete the independent review of the rebased source and publish the bounded child for exact-head CI; keep the parent DEE-1159 open for the broader qualification path."
provenance:
  createdFrom: "2026-10-01 bounded DEE-1159 engineering decomposition"
  supersedes: null
---

# DEE-1200 — registered DEVELOPMENT training diagnostic

## Scope

This child extracts one bounded, registered DEVELOPMENT diagnostic stage from the broader DEE-1159 research-executable program. The slice includes the immutable experiment/attempt identities, bounded training input, isolated mock ledger, shared stop-sizing and lookback kernel, a private modeled stage loop, and one atomic actual-runner diagnostic with append-only trace. The staged source remains a non-qualifying engineering trace: it does not pick a family winner, score validation/walk-forward/blind partitions, establish scientific evidence, provide production readiness, or enable capital/live execution. The parent plan [DEE-1159](dee-1159-research-executable-identity.md) retains the broader same-executable train/validation/walk-forward/blind acceptance.

The current native evidence includes the retained original six-pass/one-fail RED, a seven-pass/zero-fail diagnostic run, and the UUID-case RED/GREEN. After rebasing onto merged DEE-1183, all eight native files, including the private modeled kernel, passed on a fresh local PostgreSQL 16.14 database: 89 assertions, zero failures and zero skips. The dedicated CI gate is implemented; exact published-head CI and independent review of the rebased source remain pending.

CI uses a fresh PostgreSQL 16 service database, applies the checked-in migration journal normally to that disposable database, and applies only the three unnumbered DEE-1159 draft SQL payloads needed by these tests. The draft payloads remain outside the canonical migration journal; this is not a production migration or rollout.

The runner must reject any non-CI, non-loopback, unexpected database, wrong PostgreSQL major, missing draft/test file, failed suite, skipped suite, empty suite, or incomplete report. It must emit a bounded receipt identifying the exact source manifest and suite counts without exposing database credentials. The blind-ingress suite is owned by the separate DEE-1183 work and is a dependency; this child must not copy or recreate that test.

## WP-1 — registered DEVELOPMENT diagnostic slice

Keep registration-before-execution, exact organization/attempt/trial scope, DEVELOPMENT-only source input, bounded records, and actual selected lookback execution bound to the real signal/evaluation and isolated mock-order accounting path. Persist the result atomically with orders, fills, events and economics; matching retries must verify the immutable committed trace, while failures leave no partial stage ledger. Preserve explicit `TRAINING_ENGINEERING_TRACE_ONLY`, `scientificQualified:false`, `capitalEligible:false`, requested executable/PIT/source digests unverified, and both full Guardian qualifications `UNQUALIFIED`.

The recorded old-code counterexample had six passing assertions and one failure; corrected native behavior passed seven assertions with zero failures/skips. Combined evidence must include all seven neighboring registry, input, ledger, blind-boundary and provenance suites as well as the diagnostic suite. This is engineering verification only.

The diagnostic request boundary canonicalizes the PostgreSQL UUID spelling before using it in the immutable stage identity. PostgreSQL returns UUID text in lowercase even when a syntactically valid uppercase UUID was supplied; accepting uppercase on the initial call but persisting that spelling in the trace made an identical uppercase retry disagree with the committed row. The public-runner native regression first reproduced `COMMITTED_SCOPE_MISMATCH` on an uppercase retry, then passed with uppercase initial, uppercase retry, and lowercase retry calls returning byte-equal traces, one diagnostic row, and ledger counts matching the trace. This is idempotency normalization only; it does not change registration identity or tenant scope.

### Private modeled loop within the same child

The bounded child also extracts the diagnostic's unchanged signal → sizing/D20/Risk → D5 order/fill → accounting loop into `research-modeled-stage-kernel-v1.ts`. The DEVELOPMENT owner retains its strict public request, registered source/policy checks, locked serializable transaction, complete ledger verification and atomic result insert. The internal kernel receives only that owner's executor, verified source, parsed identity and resolved policy/model; it is not a public arbitrary-bars, callback, stage-access or authority API. The current public reader remains DEVELOPMENT-only. A strict-request native case proves that caller-supplied bars, cycles, blind stage, scores, result, repository and policy are refused before any DB query. Same-executable validation, walk-forward, blind and full Guardian qualification remain parent DEE-1159 work.

Independent review caught and corrected a UUID-spelling difference introduced by extraction. The final loop retains the normalized identity from the owner. Rebased isolated PostgreSQL proof of the complete diagnostic file is nine passes, zero failures/skips. The subsequent fresh combined proof (`dee1200-kernel-combined-native`) passes all 89 assertions across eight exact files, zero failures/skips, on PostgreSQL 16.14. Its 536 captured source pins remained unchanged during execution. The earlier 88-assertion run remains historical; final documentation-only commit binding and published-head CI are separate evidence.

## WP-2 — required isolated PostgreSQL CI gate

Append a dedicated workflow job using a fresh PostgreSQL 16 service and a test-only database URL. Bootstrap the ordinary current-main schema through the repository auth prelude and official migrator, then apply the three exact staged SQL files directly to this ephemeral test database. Run the eight exact native suites serially with PostgreSQL integration enabled and validate Vitest JSON so every expected file executes, each has at least one passing assertion, and there are zero failed, skipped, or todo assertions. Preserve all behavioral assertions and production migration/journal files; the scoped-ledger test receives only the explicit CI target allowance described below.

The independent CI review found that the scoped-ledger suite's existing local-only database guard rejects the dedicated CI service tuple. Preserve that exact local allowance and add only the exact disposable CI tuple when both CI indicators and the paired database URLs match. Explicitly set the PostgreSQL backend for the proof job. A missing PR730 blind-ingress suite remains a refusal until the real base contains it.

## Acceptance

- The extracted diagnostic preserves its registered DEVELOPMENT scope, atomic ledger behavior, and explicit non-qualification limits; fresh rebased native evidence is 89/89 assertions across all eight files on PostgreSQL 16.14.
- The canonical plan and CI wiring clearly identify this as synthetic PostgreSQL-only proof, not scientific qualification or production readiness.
- A dedicated PostgreSQL 16 CI job runs the exact eight DEE-1159 suites on an isolated fresh database and fails closed on missing inputs, wrong endpoint/version, skips, failures, or empty reports.
- The three staged DDL payloads are applied only to the disposable CI test database; the canonical migration journal is untouched.
- Existing registered diagnostic behavior and assertions are unchanged; no live capability, holdout authority, financial policy, or claim of scientific qualification is added.
- The UUID normalization counterexample, corrected regression and rebased eight-suite native run are source-bound in the DEE-1200 readiness receipt. Independent review of the rebased changes and exact published-head CI remain pending.
