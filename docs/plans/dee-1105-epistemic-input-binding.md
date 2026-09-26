---
integrationIssue: DEE-1105
integrationTitle: "Reject stale Navigator and unbound feedback at canonical epistemic composition"
parentIssue: DEE-639
branch: dee-1105-epistemic-input-binding
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Publish the verified bounded fix after serial integration with PR668 and require exact-head CI. No runtime activation."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1105 — Exact epistemic input binding

## Problem and goal

On main8297142e, `composeCanonicalEpistemicSpineV2` admits a Navigator receipt
from another PIT anchor, feedback altered under its original digest, and sealed
feedback referring to another future Navigator. A synthetic pure-function probe
reproduced all three admissions. No production trading effect is established.

Require the current PIT and canonical feedback body/bindings before entering the
Decision/Risk/Execution chain. This enforces DEE-639/772/773 existing contracts;
it creates no scientific or capital authority.

## WP-1 — Bounded consumer correction

- Match Navigator PIT to the current RuntimeContext.
- Check feedback schema, policy, authority, digest fields, canonical timestamps
  and the hash of its complete body.
- Bind feedback to the current future PIT; a nonzero effect must refer to the
  exact current Navigator and knowledge digest and a strictly earlier prior PIT.
- Preserve null feedback and correctly formed ZERO_EFFECT receipts. Rejected
  evidence intentionally retains prior Navigator/knowledge identities; do not
  force those zero-effect identities to equal a newly selected current receipt.
- Prove recurring refusal before Decision/Risk/Execution callbacks.

## Acceptance

Negative regressions fail before the fix and pass afterward. Valid deterministic
current-cycle composition and zero-effect refusal semantics remain intact. Run
targeted compose/recurring/Navigator/future-cycle/live/paper/research consumer
tests plus lint, typecheck, build, canon, PR governance, consumer graph validators
and rendered PR preflight. Full unit and required e2e gates run in PR CI.

Local evidence on the implementation tree: first regression run25failed/8passed
before the correction; final86tests/9files PASS, including32 input-boundary cases
and3 recurring refusal cases before any capital callback. The existing positive
compose fixture now uses the actual Navigator receipt digest instead of an unrelated
placeholder. Recurring capital adapters remain test doubles; no venue qualification
is claimed. Lint has0errors/324pre-existing warnings; typecheck/build/canon/governance
and both consumer graphs pass. Source/consumer inventories remain155/134/26 with
unchanged content seals. Self-review only; PR CI is separate.

## Boundaries and Human gate

No policy/rate/HWM/threshold/holdout change; no schema, provider, credential,
venue adapter, account binding, live activation, C3 or host mutation. Content
integrity is not durable outcome/source verification. The missing production
loaders, full recurring composition, scientific qualification and operator launch
remain separate gates. User explicitly authorized technical fixes and merge after
checks; self-review is disclosed and is not Human scientific attestation.
