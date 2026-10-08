---
integrationIssue: DEE-1233
integrationTitle: "Admit the existing financial manifest through the observer supervisor"
branch: dee-1233-observer-financial-manifest
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, lint, typecheck]
approvalGates: [independent-review, exact-runtime-admission]
state:
  status: in-progress
  currentWorkPackage: WP-OBSERVER-MANIFEST-ENVELOPE
  completedWorkPackages: []
  remainingWorkPackages: [WP-OBSERVER-MANIFEST-ENVELOPE]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 865254f23a9554e40b547b190ba9d43f158c0621
  lastValidationAt: "2026-10-08"
  blockedReason: null
  nextAction: "Finish focused validation and independent review; root owns publication and exact new observer image/runtime admission."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# Observer financial manifest admission

The collector already accepts assignment manifest v2 for an explicitly configured
financial-history scope, but the packaged supervisor rejected that schema before
starting the collector. Admit v1 and v2 at the supervisor envelope boundary, requiring
financial-history presence exactly for v2 as the collector does. Preserve the image,
runtime and manifest release equality, declared digest, bounded file, restricted
credential environment and role checks.

The collector validates strict fields, finite scope bounds, content digest and
configuration revisions before opening any pool. After opening the restricted
resources, it checks current database bindings before credential decryption and
venue access; those checks remain unchanged. An expired but structurally
valid optional scope still reaches the collector: financial unavailability must not
stop ordinary base observation. No enrollment, lease, request budget, pool, TLS,
secret, role, database, provider or production changes are part of this correction.

## Acceptance

Accept the source correction when v1 base observations and correctly sealed v2
financial manifests reach the strict collector, while malformed scope, digest,
release, configuration and forbidden-key cases fail closed. Complete the focused
validation and independent review before publication. Financial production
acceptance remains separate and keeps DEE-1233 open.

## Validation and release boundary

The focused regression invokes the real supervisor configuration parser and actual
collector entry for malformed scope/revision/content cases, with synthetic credentials
and resource-opening spies. It verifies v1 and v2 handoff, schema/scope mismatch,
digest/release/forbidden-key refusals, and no pool or venue request on invalid input.
The existing host service suite checks the unchanged lifecycle and environment.

Targeted tests passed 63/63 across the two affected host suites. Typecheck and scoped
lint passed. The final new regression file also passed 11/11 after a lint-only
fixture cleanup; the unchanged existing host suite is not rerun. No full build or unit campaign is repeated.
A newly built observer image from the eventual exact merged source remains required;
this source correction does not authorize finite financial scope or production use.
