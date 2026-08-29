---
integrationIssue: DEE-781
integrationTitle: "Deterministic FHV pause test harness"
parentIssue: DEE-755
branch: dee-781-fhv-deterministic-pause-harness
riskTier: T3
prPolicy: one-integration-pr
authoritativeBase: 0fefa5f71d1cf38e065419781c1e9971804487c2
executionSurfaces: [local, github-actions, linear, github-pr]
requiredValidation: [focused, negative, fresh-sqlite-full, lint, typecheck, build, canon, pr-governance, independent-exact-head-review, authoritative-pr-ci]
approvalGates: [user-authorized-test-harness-remediation, independent-exact-head-review, dee-653-exact-head-admission]
provenance:
  createdFrom: chat
  authorizedAt: "2026-08-28"
  authority: "Explicit user authorization for separately scoped deterministic FHV test-harness remediation and unpublished-history rebuild"
state: admitted
---

# DEE-781 — deterministic FHV pause test harness

## Frozen boundary

Add an explicit hermetic-test-only pause-cycle control from `runFhvRehearsalCampaign` to its existing internal `parityPauseAfterCycles` hook. Production callers omit the control and retain byte-for-byte equivalent runtime behavior.

## Invariants

- The control is accepted only under `NODE_ENV=test`; any non-test use fails closed.
- No test, assertion, replay cycle, deadline, checkpoint, or evidence verification is skipped.
- The timeout and cross-process negative tests pause deterministically after frontier progress; they retain resumed replay timeout, identity/tamper rejection and zero-replay restart behavior.
- No trading, scientific, retention, holdout, live, execution, or capital semantics change.

## Validation

Focused positive and negative harness tests, the affected timeout/resume tests, typecheck, scoped lint, one literal full fresh-migrated SQLite suite, exact-head independent review, authoritative CI and DEE-653 are required before squash merge.

## Acceptance

- The pause control is absent by default and cannot alter production behavior.
- Non-test, malformed, zero, and negative pause requests fail closed.
- Exactly the three admitted legacy external-pause test consumers use the deterministic boundary without weakening assertions.
- The affected tests are repeatable, and the literal full fresh-migrated SQLite suite passes without a hang.
- The exact published head has zero unresolved independent-review P1/P2 findings and passes every authoritative CI and DEE-653 gate before squash merge.
