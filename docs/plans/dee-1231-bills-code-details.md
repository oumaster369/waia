---
integrationIssue: DEE-1231
integrationTitle: "Diagnose rejected account financial-history reads"
branch: dee-1231-bills-code-details
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, lint, typecheck, build, ci]
approvalGates: [independent-review, exact-runtime-admission]
state:
  status: in-progress
  currentWorkPackage: WP-BILLS-CODE-DETAILS
  completedWorkPackages: []
  remainingWorkPackages: [WP-BILLS-CODE-DETAILS]
  prNumber: 776
  prUrl: https://github.com/oumaster369/waia/pull/776
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-09"
  blockedReason: null
  nextAction: "Complete exact-head CI; native diagnostic artifact and finite admission remain separate."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1231 — bounded bills code details

The financial-history reader currently collapses transport, payload validation,
time-window, and arithmetic failures into `INVALID_RESPONSE`. This prevents a
bounded native acceptance check from identifying which existing check rejected
the response. Ordinary account reading remains available.

## Scope

Add an optional, module-owned diagnostic token that retains only the first fixed
failure code. For `BILLS_CODE_INVALID` only, it may additionally retain the
observed HTTP status, a fixed JSON primitive-type label for the top-level
`code`, and a 1–6 digit decimal token when the code is a string or number. The
token must not invoke caller callbacks, inspect arbitrary properties, retain
provider data, or change the accepted response contract. No response bodies,
other values, identifiers, hashes, error messages, or stacks belong in
diagnostics.

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
- `BILLS_CODE_INVALID` fixtures cover missing, wrong-type, non-decimal and
  oversized codes; only a bounded decimal token may be retained. HTTP 200 is
  attached only when observed by the existing transport, and non-200 behavior
  remains unchanged.
- Compare successful and failing results and request counts with diagnostics on
  and off; retain expiry, cancellation and identity regression coverage.
- Run focused parser/reader/financial-ingestion tests, typecheck, lint and build.
  The full unit suite runs in PR CI only.
- Independent review must verify the final delta and the absence of changes to
  acceptance rules, budgets, credentials, configuration revisions or storage.

## Delivery boundary

This is backend diagnostic source preparation under DEE-1231, supporting the
separate DEE-1233 frontend acceptance work. It does not establish financial-history
qualification or a production rollout. Live use requires an independently
qualified diagnostic artifact, fresh exact scope and binding admission, and a
separately bounded operation. Previous failed attempts remain spent. No trading,
Grok changes, migrations, runtime activation or automatic scope renewal is part
of this change. Both issues stay open until their respective acceptance criteria are met.

Risk: T3 (a bounded diagnostic in the guarded financial reader; no API or
persistence contract change).
The user has authorized autonomous implementation and verification while
explicitly prohibiting trading actions.

## Current source qualification

85 focused diagnostic and bills-contract tests, typecheck, full lint (zero errors;
337 existing warnings), and a fresh Next.js build passed. An independent review
approved the runtime and test bytes. Exact-head CI and final merge admission are
still required. The preceding diagnostic campaign failed, was fully inverted,
and the original readers recovered. That campaign is spent; a new diagnostic
consumer and runtime admission remain separate work.

## CI content-pin repair

The first PR776 CI run found one stale Reality V2 consumer-content hash for the
reviewed transport file. Update only that hash to the exact reviewed file bytes;
keep discovery paths, rules, guard logic and tests unchanged. Run the affected
graph tests and graph validators before publishing the repair. The previous CI
failure is retained; runtime, SQL, workflows and migrations do not change.
