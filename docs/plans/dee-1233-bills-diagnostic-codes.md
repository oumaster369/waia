---
integrationIssue: DEE-1233
integrationTitle: "Diagnose rejected account financial-history reads"
branch: dee-1233-bills-diagnostic-codes
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, lint, typecheck, build, ci]
approvalGates: [independent-review, exact-runtime-admission]
state:
  status: in-progress
  currentWorkPackage: WP-BILLS-DIAGNOSTICS
  completedWorkPackages: []
  remainingWorkPackages: [WP-BILLS-DIAGNOSTICS]
  prNumber: 775
  prUrl: https://github.com/oumaster369/waia/pull/775
  lastValidatedGitSha: db6bf813cebd505aa4a3764f8c78835d66c4142c
  lastValidationAt: "2026-10-09"
  blockedReason: null
  nextAction: "Complete exact-head CI; native diagnostic artifact and finite admission remain separate."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1233 — bounded bills failure diagnostics

The financial-history reader currently collapses transport, payload validation,
time-window, and arithmetic failures into `INVALID_RESPONSE`. This prevents a
bounded native acceptance check from identifying which existing check rejected
the response. Ordinary account reading remains available.

## Scope

Add an optional, module-owned diagnostic token that retains only the first fixed
failure code. Instrument the existing bills validation sites and reader stages.
The token must not invoke caller callbacks, inspect arbitrary properties, retain
provider data, or change the accepted response contract. No response bodies,
identifiers, values, hashes, error messages, or stacks belong in diagnostics.

Preserve request count, destinations, read-only permissions, current binding and
credential checks, finite financial scope, cancellation, deadlines, cleanup and
all existing result/error semantics. No duplicate parser or response-stream copy.
Normal callers omit the token and retain their existing behavior.

Transport reasons remain pending until the terminal error is known. A later
identity, permission, cancellation or scope-expiry failure discards an earlier
body diagnostic. The reader exposes a reason only for a returned bills
`INVALID_RESPONSE`; it discards diagnostics on any terminal rejection.

## Acceptance

- Synthetic tests distinguish the existing failure stages and fields, retain the
  first failure, reject forged tokens safely, and never expose a secret canary.
- Compare successful and failing results and request counts with diagnostics on
  and off; retain expiry, cancellation and identity regression coverage.
- Run focused parser/reader/financial-ingestion tests, typecheck, lint and build.
  The full unit suite runs in PR CI only.
- Independent review must verify the final delta and the absence of changes to
  acceptance rules, budgets, credentials, configuration revisions or storage.

## Delivery boundary

This is diagnostic source preparation for DEE-1233, not financial-history
qualification or a production rollout. Live use requires an independently
qualified diagnostic artifact, fresh exact scope and binding admission, and a
separately bounded operation. Previous failed attempts remain spent. No trading,
Grok changes, migrations, runtime activation or automatic scope renewal is part
of this change. DEE-1233 stays open until its full acceptance criteria are met.

Risk: T2 (optional reader diagnostics; no API or persistence contract change).
The user has authorized autonomous implementation and verification while
explicitly prohibiting trading actions.
