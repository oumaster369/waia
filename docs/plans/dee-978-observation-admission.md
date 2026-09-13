---
integrationIssue: DEE-978
integrationTitle: "Bind account observation coverage and exact-key read admission"
branch: dee-978-observation-admission
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit, lint, typecheck, build, canon, independent-exact-head-review]
approvalGates: [human-security-review, human-production-rollout]
state:
  status: in-review
  prNumber: 571
  prUrl: https://github.com/oumaster369/waia/pull/571
  blockedReason: null
provenance:
  authoritativeBase: 9c976bdadded0f7de0bdfe891dc0573aac3be70c
  createdFrom: user-authorized-parallel-completion
---

# DEE-978 — DEE-960 observation coverage and admission follow-up

## Authority and boundaries

Human authorized remaining local DEE-960/961 implementation and verified PR/merge.
DEE-978 is the atomic follow-up to merged PR570, parent DEE-960; one PR per issue.
No production, migrations, real credential/account access, orders, capital, historical
process changes, scientific restarts or Human-ratification substitution. DEE-960 remains
open after this slice; integration of a host/provisioning surface requires separate proof.
Existing user WIP in the earlier account-observation-core worktree is not part of this PR.

## Acceptance

1. Coverage identity: bind HTX host, page size, page count, record/response bounds and
   trade window into the existing configuration digest. Configured HTX runtime must
   reject missing or mismatched coverage before pool/store/network I/O. Generic injected
   runtime configurations retain their old digest when no HTX coverage is specified;
   these legacy configurations must not open the configured HTX runtime. Persisted
   revisions already support the digest, so no DDL or assignment mutation is needed.
   Validate every bound; copy/freeze nested parameters; prove all changes affect identity.
2. Exact-key read admission: assess a bounded, GET-only metadata check using the same
   opened key and stored spot-account binding. Do not treat an injected always-true
   callback or local database currentness as venue permission. Ground response validation
   in the existing exact-admission implementation and official HTX metadata contract.
   Implement only with explicit cancellation, timeout/body limits, identity/permission
   negative tests and no order-write capability. If an upstream contract is missing,
   record it precisely rather than fabricating a positive admission.

## Validation and handoff

Red/green focused regressions, existing observation and HTX admission suites, lint,
typecheck, production build and applicable CI/governance gates. Independent review of
exact final diff precedes merge. No new full-repository audit or repeated scientific
calculation is required for this bounded change. Record SHA/results and remaining
runtime/provisioning/production gaps in Linear; do not mark the whole Trader complete.

## Local evidence — 2026-09-10

- 424 focused unit tests PASS, including all six coverage-change regressions and
  concrete same-key metadata admission without an injected verifier. An injected
  true verifier cannot bypass a negative venue response.
- 35 actual PostgreSQL 17 tests PASS: fresh complete migrations, additive upgrade,
  restricted observer/read roles, recurring collection, revoke and configured runtime.
  Only isolated synthetic localhost databases were used; no production migration.
- Typecheck and Next production build PASS. Full lint: zero errors, 307 existing
  warnings. The sandbox denied a loopback socket on the first build; the permitted
  local build then completed, without changing code or deployment.
- Independent source review found no proven P1/P2 in the six changed source files;
  reviewed source diff SHA-256:
  `8519bbd0b2985a75ad75ddf181cf5deaa4f738d822fa7757300698e5130ca445`.
  Exact PR-head CI and final review are still required before merge.

## Remaining activation boundary

No host service, assignment provisioning, production rollout or real-account call
is included. Fresh admission makes three bounded metadata GETs per check: an empty
one-symbol collection currently makes 21 metadata plus three observation requests.
Production cadence/rate-limit qualification is therefore still required; do not
activate an arbitrary cadence or claim that this package completes DEE-960.
The GET-only transport has no order, withdrawal or transfer endpoint. A venue
`trade` permission is not proof that a key cannot transfer funds; the module grants
only its allowlisted GET capability. Unknown/withdraw/transfer metadata is denied.

Supabase guidance and the official HTX API Key Query response contract were used
for the protected credential and metadata boundary. No private credentials were
read, logged, transmitted to Linear or included in tests.

## CI correction — 2026-09-10

PR571 original-head full CI ran to completion: 6906 tests passed, two failed in
`trader-reality-v2-consumer-graph.test.ts`, 589 skipped in this suite (dedicated
PostgreSQL17 gate passed separately). Both failures reproduced locally: the
content digest omitted reviewed changes to transport/types, and the strict DTO
import test had not admitted the new type-only coverage dependency. The earlier
focused invocation used the wrong consumer-graph filename and did not execute
this guard; the focused gate now names the actual file explicitly.

Reconcile the existing inventory after review, preserving its 154 sources,129
consumers,25 connector references, exact path digest, source digests, narrow
dispositions and all forbidden-source checks. Allow only the single named
type-only coverage import from types.ts and add a check of its static Zod-only
module; no broad import exception or canonical Reality authority is introduced.
PR572 merged after all21 checks PASS as2c19890b4363f7cf9d223ba0fd11e017ab1cd6eb;
this branch incorporates that main commit without conflicts for strict-base CI.
After correction:470 focused unit tests (including the actual8-test Reality graph
guard), typecheck, scoped lint and diff check PASS. Exact-head GitHub CI will rerun;
the failed original result is retained, not relabelled as a successful run.
