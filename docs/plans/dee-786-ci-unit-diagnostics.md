---
integrationIssue: DEE-786
integrationTitle: "Bounded CI diagnostics and deterministic unit negatives"
parentIssue: DEE-755
branch: dee-786-ci-unit-diagnostics
riskTier: T3
prPolicy: one-integration-pr
authoritativeBase: cf060b86353a62eab714dbd06625bb6844a90c1f
executionSurfaces: [local, github-actions, linear, github-pr]
requiredValidation: [focused, negative, lint, typecheck, build, canon, pr-governance, independent-exact-head-review, authoritative-pr-ci]
approvalGates: [controller-authorized-diagnostic-remediation, independent-exact-head-review, dee-653-exact-head-admission]
provenance:
  createdFrom: chat
  authorizedAt: "2026-08-28"
  authority: "Program Controller authorization for a separate diagnostic-only CI Integration Train"
state: admitted
---

# DEE-786 — bounded CI unit-test diagnostics

## Frozen boundary

Harden only the authoritative GitHub unit-test job diagnostics and its deterministic test-only evidence: an explicit job timeout, periodic compact progress derived from the already complete captured log, termination-safe log preservation with the original test exit status, and a significant-byte HMAC tamper fixture that cannot decode to the original signature. The runtime verifier, test command, test set and security assertions remain unchanged.

## Invariants

- No product, production, scientific, security, holdout, live, execution or capital semantics change.
- No test skip, retry, sharding, filtering or acceptance weakening.
- Complete stdout/stderr remains captured; success output stays compact and failures expose the complete log.
- TERM/INT/EXIT paths preserve actionable bounded diagnostics and the original nonzero result.
- Diagnostic output must not expose environment values or secrets.
- The Finance Assistant negative must alter significant decoded signature bytes and must not rely on non-significant trailing base64url bits.
- `lib/waia-core/finance-assistant/confirmation.ts` and every runtime/security surface are forbidden.

## Acceptance

- The wrapper reports bounded progress while a long test process is alive.
- Success prints the compact tail and exits zero.
- Failure and termination print the complete captured log and preserve a nonzero status.
- The workflow has an explicit bounded timeout and invokes only the admitted wrapper.
- The Finance Assistant tamper negative proves the mutated signature bytes differ and the unchanged verifier rejects them.
- Exact-head independent review reports P1=0/P2=0 and authoritative CI passes before squash merge.

## Validation

Run focused shell positives/negatives/termination proof, the deterministic Finance Assistant tamper negative, a literal full fresh-SQLite suite, syntax checks, repository lint/typecheck/build/canonical/governance checks, exact-head independent review, authoritative CI and DEE-653.
