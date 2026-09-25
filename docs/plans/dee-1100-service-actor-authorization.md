---
integrationIssue: DEE-1100
integrationTitle: "Preserve actor identity at service authorization boundaries"
branch: dee-1100-service-actor-authorization
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1100
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
  nextAction: "Verify actor authorization and admin composition; integrate after DEE-1099."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1100 — actor-preserving service authorization

## Context and verified scope

Full audit D-05 / P06 found 18 services dropping userId while normalizing org scope. Risk limits is the separate DEE-1098 change. This package repairs the other17 services: balance/position/trade-history snapshots, credentials, four billing services, nine MI services. Review additionally reproduced the same loss in billing-period-close-orchestrator; it is included because otherwise the corrected child services still receive an identity-free scope.

The first79 public-operation outsider tests all failed on baseline a4c2f777. After correction all81 affected public operations (including both orchestrator methods) reject an outsider before repository, audit or provider access. This demonstrates a service boundary defect, not proof of an exploited remote HTTP leak.

## Acceptance

- Shared `security/service-org-context.ts` validates organization, preserves supplied userId and requires a membership verifier. Empty/null/non-string/whitespace actor fails closed; only an omitted actor retains existing trusted server/service composition.
- Native PG/SQLite MI factories now provide real membership checks by default, including factories whose older WithMembership wrappers were optional. Generic actor-bearing service calls without a verifier fail closed.
- Credential SQLite atomic overrides and PG transaction paths use the same guard before key-provider access.
- Billing close orchestration preserves actor and passes the explicit verifier through reporting-period, draft, fee and HWM factories. No fee/economics/HWM formula changes.
- Admin credential-read and billing-close adapters explicitly inject their existing capability verifier, rechecking the actor/org/permission against the database. This preserves lawful admin cross-org access without manufacturing membership or dropping actor. Ordinary tenant factories keep strict membership.
- Existing user credential HTTP derives the organization from authenticated user. Tests cover route→native service→real PostgreSQL, anonymous rejection and outsider/admin separation.
- Extend the additional capital-authority PG CI job and its executed-proof guard. Do not modify frozen historical jobs or accept skipped actual-PG proof.

## Validation and review

Tests use isolated synthetic credentials and local disposable databases only. No actual key is decrypted, no exchange HTTP request is made. Native SQLite and actual PostgreSQL exercise all81 operations against a real non-member, plus authorized member/internal/admin controls. End-to-end native billing composition checks internal, member and cross-org administrator still reach a DRAFT with canonical profit receipts. Draft/fee/HWM algorithms and policy parameters remain unchanged.

Targeted regressions: actor matrices, tenant-isolation, credential lifecycle, billing/MI/snapshot and route auth suites; lint/typecheck/build; canon and PR governance; both source/consumer graph validators; authoritative full unit and required PostgreSQL checks on exact PR head. Append-only fixture audits are retained. Local tests do not certify production RLS or complete runtime security qualification.

Reality inventory review: only credential-service.ts is a changed member of the134 consumer files. Its imported connector types remain; no new connector references, source paths, Reality ingress or effects. Refresh only the reviewed consumer content seal on this base; recompute after integrating1097/1098/1099. Execution graph remains unchanged. Existing25 references become26 only via the separately reviewed1099 permission check after serial integration.

## Do NOT / authority

No new trading path, venue call, activation, role grant, key migration, database schema, fee30%, HWM, settlement, holdout, scientific threshold or finality changes. Preserve RLS and org predicates. C3 pinned producer/code/mounts/parameters remain untouched. User delegates technical self-review/PR/merge after checks; self-review is not independent/Human admission. Final security and exact account/Org0 launch gates remain open.

## Limits / dependencies

Serialize PR integration after1097→1098→1099 and revalidate combined source seals. Explicit service-only runtime authority tokens/leases across every background caller remain the runtime/security qualification scope; this patch documents and preserves existing trusted org-only composition, not a newly ratified authority model. It does not repair all legacy endpoint permission choices, invoice issuance/governance atomicity or broader auth TOCTOU; those need separately demonstrated defects and P07/P18 review. No global isolation-complete claim.

## Local validation on base a4c2f777

81 outsider operations with effect spies PASS;90 native SQLite/context controls PASS;85 actual PostgreSQL tests PASS, including route/member/admin controls. Additional PG capital-authority set140 tests/5files PASS and executed-proof JSON guard PASS. 111 tenant-isolation tests/34files PASS (14PG tests skipped in default unit environment, not counted as proof);368 affected regressions/56files PASS; native billing internal/member/admin chain8 tests PASS (overlap). Lint0errors324existingwarnings, typecheck/build, bothgraphs PASS. Full PR CI and combined-tree integration remain pending.
