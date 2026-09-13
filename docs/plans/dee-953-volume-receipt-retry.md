---
integrationIssue: DEE-953
integrationTitle: "HTX volume receipt JSONB retry equality"
branch: dee-953-volume-receipt-retry
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, build, targeted-unit, targeted-postgres]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-VALIDATION
  completedWorkPackages: [WP-RETRY]
  remainingWorkPackages: [WP-VALIDATION]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Publish the minimal reviewed diff after governance preflight; require exact-head GitHub CI before integration."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-953 — bounded persistence correction

The overnight engineering delegation authorizes minimal proven launch-defect corrections. This separate issue/branch avoids expanding DEE-946's package wire scope. Base is origin/main b5c17263465fc525dd46eab8c8a076b1abde1a69. No merge/deployment/production data or exchange access is included in this work package.

## Defect and correction

An identical persisted HTX volume receipt fails retry because PostgreSQL JSONB changes object key order while persistence compares JSON.stringify strings. The existing versioned receipt reader already reconstructs canonical field order for its unchanged digest. Compare complete persisted JSON values independent of object key order; preserve all actual fields, array order and genuine value conflicts. Normalize only the incoming JSON persistence boundary, not the receipt digest/version. No authority, RLS, schema, qualification law or existing receipt rewrite changes.

## Acceptance

An identical receipt reloaded through PostgreSQL JSONB must return its original
record ID and inserted=false. Genuine payload conflicts and invalid digests must
still fail. Identical digests in different organizations must remain independent.
Receipt versions, all persisted fields, array ordering, qualification law, existing
data and authority boundaries must remain unchanged.

## Validation

First reproduce with a real qualified receipt and a reordered persisted object. Then require same record ID/inserted=false after real PostgreSQL JSONB reload, invalid digest and genuine payload-conflict refusal, same digest independent across two tenants, and unchanged unit qualification tests. Use a guarded local PostgreSQL database, new synthetic orgs and rollback-only transactions, no trigger/RLS disabling. Run lint/typecheck/build and normal PR governance/CI before integration readiness.

### Local evidence — 2026-09-06 20:37 UTC

- Before correction: the new reordered-JSON unit regression failed with `HTX_VOLUME_QUALIFICATION_CONFLICT`; both negative cases passed.
- After correction: 8 focused unit tests pass (3 retry + 5 unchanged qualification).
- Actual isolated PostgreSQL 17: one rollback-only integration test passes (68 ms), covering durable same-ID retry, cross-tenant independent records, changed extra field refusal and invalid digest refusal. No production database was accessed.
- Full repository lint, typecheck and Next production build pass. Existing lint warnings remain; no claim of warning-free code. This is not a Cloudflare deployment.
- The PostgreSQL CI workflow now includes the retry test and both trigger paths; its existing PostgreSQL 16 version is unchanged. Remote CI and independent review remain pending.

### CI inventory correction — 2026-09-07

At head 61df96e2, PostgreSQL CI passed; the unit gate had one failure:
Reality V2 source content inventory drift (5,855 tests passed, 492 skipped).
The focused test reproduced the same failure locally. The 154 source paths and
path digest are unchanged. Recomputing from exact base b5c1726 reproduces the old
content digest; the only changed source is this issue's receipt persistence file.
After reviewing that change, refresh only sourceDiscovery.sortedContentDigestHex
to bind the reviewed implementation. Keep the validator, rules, counts, consumer
digest, connector checks and all assertions unchanged. This is an inventory
maintenance correction, not a waiver or a change to Reality admission.
