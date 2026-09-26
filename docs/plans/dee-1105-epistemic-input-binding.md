---
integrationIssue: DEE-1105
integrationTitle: "Bind canonical knowledge and Forecast inputs to the current cycle"
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

# DEE-1105 — Exact knowledge and Forecast input binding

## Problem and goal

On main8297142e, `composeCanonicalEpistemicSpineV2` admits a Navigator receipt
from another PIT anchor, feedback altered under its original digest, and sealed
feedback referring to another future Navigator. A synthetic pure-function probe
reproduced all three admissions. A second probe on main3e15dc8c, using real
Forecast issuance and replay validation, reached Decision with a Forecast from
another PIT or package than the RuntimeContext assignment. Its Decision adapter
deliberately abstained; Risk/Execution were never called. No production trading
effect or scientific qualification is established.

Require the current PIT, canonical feedback body/bindings and exact Forecast
PIT/package before entering the Decision/Risk/Execution chain. This enforces
DEE-639/772/773 existing contracts; it creates no scientific or capital authority.

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
- Bind an authorized Forecast's anchor and predictive-package digest to the
  current RuntimeContext before Decision. Keep full Forecast replay validation
  in its existing downstream validator; preserve NON_ACTIONABLE outcomes.
- Include canonical runtime and Navigator changes in the existing Postgres CI
  path filter, keeping all eight mandatory executed capital suites unchanged.

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

Subsequent serial rebase onto accepted PR668 passed95 tests/10files and local
readiness. The added Forecast boundary cases then failed3/passed3 before its
guard (50 unrelated cases excluded by the focused name filter). They use the
real Forecast issuance/replay implementation with synthetic package/receipt
fixtures, not a mocked Forecast validator. Only Decision is deliberately
non-actionable, with throwing Risk/Execution adapters. Existing mocked
recurring/live/paper fixtures now carry their matching PIT/package fields.
The updated combined result and exact-head CI are recorded in the PR body.

Combined correction passes176 targeted tests/15files and168 actual-PG tests across
all8 mandatory capital suites, zero skips. The real Forecast regression additions
are6 cases. Reality inventory requires a content-seal refresh because the existing
canonical recurring consumer gained the19-line refusal guard: count134/path digest,
155 sources and26 connector references remain unchanged; no rule, disposition or
admitted boundary changed. Reviewed sole changed inventoried consumer:
`lib/trader/runtime-v2/canonical-recurring-cycle-v2.ts`. Consumer content seal is
`d6e2be009c3e6a4b9f3f19d6e0dc79fae6089ebfcc3d2df5a410eec2622a1210`.

## Boundaries and Human gate

No policy/rate/HWM/threshold/holdout change; no schema, provider, credential,
venue adapter, account binding, live activation, C3 or host mutation. Content
integrity is not durable outcome/source verification. The missing production
loaders, full recurring composition, scientific qualification and operator launch
remain separate gates. User explicitly authorized technical fixes and merge after
checks; self-review is disclosed and is not Human scientific attestation.
