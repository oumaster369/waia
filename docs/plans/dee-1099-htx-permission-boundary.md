---
integrationIssue: DEE-1099
integrationTitle: "Fail closed on stored HTX permissions and explicit trade purpose"
branch: dee-1099-htx-permission-boundary
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, mocked-connector]
requiredValidation: [lint, typecheck, build, targeted-unit, mocked-connector, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1099
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementing
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Verify purpose-aware permissions and observe-only compatibility; integrate serially."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1099 — HTX credential purpose boundary

Audit D-04/P05: stored metadata parser rebuilt missing/false flags as true, ignored version/invalid scope shape, and resolver fabricated a safe-looking fallback after any parse failure. Fresh HTX validation correctly admits read-only observation; contrary to an earlier audit inference, it does not require trade. The live/effect consumers need a distinct trade requirement.

## Acceptance

Validate exact metadata version1, spot/account identity, known scope strings, verified read permission and literal forbidden flags. Missing/malformed/unknown/transfer/withdraw evidence denies; never synthesize safe permission evidence. Preserve verified metadata fields instead of filtering/rewriting them. Builder only accepts verified read/trade scopes; stored metadata remains a historical statement, not fresh venue authority.

Resolver purpose is explicit and runtime validated: read accepts safe read-only; trade requires read+trade. Both live consumers check stored metadata before decrypt/probe and explicitly request trade. Live connector also checks freshly validated account permissions so downgraded read-only cannot inherit stored trade. Existing place/cancel methods require trade in their validated fresh session before their existing network path; observation remains read-only capable. No new order/cancel entry point or policy grant.

## Tests / impact

Synthetic keys and mocked fetch only: invalid metadata matrix, null fallback denial, exact account, read/trade separation, no decrypt/probe on stored failure, fresh downgrade refusal and zero placement/cancellation fetch for read-only. Existing write/transport/reconciliation tests use explicitly read+trade fixtures so one-POST/no-retry/uncertainty behavior remains covered. Observe/connect tests retain read-only credentials. No real secret is read or exchanged.

Run targeted security/live/HTX/observation suites, lint/typecheck/build, both consumer graphs, canon/governance and authoritative exact-head PR CI. Refresh content seals only after reviewing actual source/consumer membership; preserve path counts and existing connector reference authority.

## Boundaries / review

This is a software security correction; DEE-176 final exact-tuple assurance remains open. Does not rotate/update stored credentials, allow withdrawal/transfer, activate live, change fees/risk/ADRs, or touch C3. Existing stale credential snapshots may now refuse live construction rather than fabricate authority. Do not automatically repair them; any later refresh requires fresh verified venue evidence for the exact key/account. The last verified stored snapshot for HTX73737331 was read-only. The user subsequently reported enabling Trade at the venue; this assertion requires fresh guarded exact-key/account evidence before updating metadata or admission. Observation remains permitted by verified read-only credentials.

Review negative metadata/unknown-purpose behavior, account binding, absence of plaintext reads on stored-policy denial, fresh downgrade, restriction before network calls and retained connector uncertainty semantics. Adversarial self-review is not independent or Human attestation. User delegates technical implementation, PR and merge after checks, and non-trading rollout. Real transactions/activation stay operator actions. Integrate after pending economics/bootstrap repairs; C3 code/mount remains pinned.

## Local verification — 2026-09-25

335 tests/10security-live-HTX-observation suites PASS, followed by85/3targeted suites including2additional composite-gate negatives (overlapping cases). Initial10 failures in existing write tests exposed their read-only fixture; only write cases now explicitly mock read+trade, without relaxing one-POST/uncertainty assertions. Read/observation fixtures remain read-only. Lint0errors/324existingwarnings, typecheck/build/canon/governance and Execution graph PASS. Reality inventory retains155sources/134consumers; one explicitly reviewed read-only getAccountInfo reference brings references25→26 (permission check of freshly validated session, no financial ingress); reviewed source members HTX connector +live connector and consumer members those two plus metadata parser/resolver have refreshed content seals. Recompute both seals after serial integration of previous packages. No production/C3 change.

## Combined-tree verification after PR662

Rebased onto fd892c2d7ec5834da917517b274e379ab15323ca after all31checks on PR662 passed.358 targeted tests/12files PASS, including observation/connect and Risk defaults compatibility. Combined source seal3a0ed6f1e9522f0579ffa8f4cc932ed70a6ea97323eb17f00fa3f80c41c1d3c8 and consumer seal7333265d09177a8e90cecf2f076b353660529841f2e9bbc08909fde550faa28a retain exact membership155/134 and the reviewed26references. Full exact-head PR CI remains the final integration check.
