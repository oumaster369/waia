---
integrationIssue: DEE-781
integrationTitle: "Deterministic FHV pause test harness"
parentIssue: DEE-755
branch: dee-781-fhv-deterministic-pause-harness
riskTier: T3
prPolicy: one-integration-pr
authoritativeBase: 0fefa5f71d1cf38e065419781c1e9971804487c2
state: admitted
---

# DEE-781 — deterministic FHV pause test harness

## Frozen boundary

Add an explicit hermetic-test-only pause-cycle control from `runFhvRehearsalCampaign` to its existing internal `parityPauseAfterCycles` hook. Production callers omit the control and retain byte-for-byte equivalent runtime behavior.

## Invariants

- The control is accepted only under `NODE_ENV=test`; any non-test use fails closed.
- No test, assertion, replay cycle, deadline, checkpoint, or evidence verification is skipped.
- The timeout, cross-process negative and incremental-resume guard tests pause deterministically after frontier progress; they retain resumed replay timeout, identity/tamper rejection, canvas-restore rejection and zero-replay restart behavior.
- No trading, scientific, retention, holdout, live, execution, or capital semantics change.

## Validation

Focused positive and negative harness tests, the affected timeout/resume tests, typecheck, scoped lint, one literal full fresh-migrated SQLite suite, exact-head independent review, authoritative CI and DEE-653 are required before squash merge.
