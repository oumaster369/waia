---
integrationIssue: DEE-979
integrationTitle: "Protected account observation host lifecycle and local recovery"
branch: dee-979-observation-host
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [focused-host-runtime-admission-tests, scoped-lint, typecheck, build, independent-exact-diff-review]
approvalGates: [human-security-review, separate-production-activation]
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  blockedReason: null
provenance:
  authoritativeBase: 5aee44883454551760c889129577615737aa5b80
  createdFrom: user-authorized-local-parallel-work-DEE-979
---

# DEE-979 — Protected observation host lifecycle

## Acceptance

One explicit single-start owner composes the existing configured HTX observation runtime.
Validate the entire trusted assignment/configuration and required resource factories before opening
resources. Reuse current binding/configuration/coverage validators, venue admission and DB fencing;
never substitute positive callbacks or privileged fallback. Separate bounded collector and reader
resources are owned and closed, alongside the protected credential service resource.

No work on import/construction. Cancellation, partial opening, constructor/runtime errors and
shutdown failures are sanitized and attempt all owned cleanup. Late resources are closed and cannot
start a runtime after cancellation/deadline. Restart means constructing a fresh host, not resetting
durable due-time, lease, revision or observations. Diagnostics contain only fixed event/error codes.

## WP-1 — Host implementation and focused proofs

Own new files under `lib/trader/account-observation/` and focused host unit tests; preserve reviewed
core unless a concrete defect requires a minimal fix. Use explicit injected protected resource
factories, not environment discovery or a CLI that opens real credentials. Ground any resource
privilege verification in actual PostgreSQL metadata, not a caller's asserted admission boolean.
The factory remains responsible for connection establishment and configured driver limits; missing
or unknown configuration/role identity is refused before collection.

Tests use synthetic SQL/resource implementations and fake network, no real account credentials:
prevalidation/no autostart, separate roles/pools, duplicate run, revoke/partial/backoff reuse of existing
composition, open failures, cancellation/timeout, late opening, runtime failure, cleanup failures,
secret-bearing dependency exceptions, and fresh-host restart.

## WP-2 — Validation and integration handoff

Run focused host and existing runtime/admission suites, scoped lint and typecheck; root performs
build/integration gates and independent review. Preserve unmodified full CI. No full local unit rerun.
Record exact validation results and limitations before handoff; no subagent commit/push/merge.

## Explicit exclusions

No production/SSH/scientific process, migrations, real private credentials/accounts, external HTX calls,
orders, capital, blind holdout, fabricated Human admission, account discovery, UI or CI edits.
Trusted assignment provisioning, secure resource adapters/production privilege verification,
rate qualification and deployment remain separately proven activation obligations. This local host
does not complete DEE-960, historical acceptance or live trading.

## Local evidence — 2026-09-10

- Frozen dependency installation completed with `--frozen-lockfile --ignore-scripts`; no lockfile edit.
- Host lifecycle unit tests: 40 PASS (no autostart, complete prevalidation, snapshotting, one start,
  distinct pools/session identities, failed/prolonged opening/probe, late cleanup, constructor/runtime
  failure, disposal exceptions, bounded shutdown, sanitized events and fresh composition).
- Existing configured runtime / runtime / concrete HTX admission focused tests: 102 PASS.
  These retain the concrete venue checks, recurrence, revocation and partial/backoff proofs;
  new host lifecycle unit tests mock only that already-tested composition port.
- Actual PostgreSQL 17 host tests: 6 PASS on a fresh unique `dee979_host_*` database with limited
  DDL owner and separate NOINHERIT LOGINs. Prove MEMBER without SET rejection, extra/inherited
  role rejection, PUBLIC ciphertext/write grants, forbidden DELETE, forced RLS, session reset,
  and actual host-to-configured-runtime startup/stop with zero assigned accounts and no network.
- Authoritative unchanged three-file PostgreSQL CI command: **41 PASS**, including the 6 new
  host cases consolidated directly into the existing reader suite (17), existing collector suite (20), and full
  migrations/fresh/upgrade suite (4). No existing assertion removed; no CI job modified.
- The six host cases live directly in `tests/integration/account-observation-reader-postgres.test.ts`;
  no extra cases file remains. Both explicit test selection and workflow path matching therefore
  cover future case-only changes without a CI modification or duplicate execution.
- Exact graph/CI gates: **18 PASS** across `trader-reality-v2-consumer-graph.test.ts` (8, includes
  execution of the pinned whole-repository source/consumer validator and exact AST/import guards),
  `trader-execution-v2-consumer-graph.test.ts` (3),
  `trader-decision-v2-capital-authority-consumer-graph.test.ts` (3), and
  `account-observation-postgres-ci-contract.test.ts` (4). No inventory/authority rule edit.
- The actual `node --import tsx scripts/trader/validate-execution-v2-consumer-graph.ts` command
  also passed: exit 0, `violations: []`, `failClosedLegacyBoundary: true`.
- Following consolidation, reran the authoritative three PG suites (41 PASS), typecheck and scoped
  lint (both PASS), and the expanded graph checks above. Source runtime blobs are unchanged.
- TypeScript PASS; full lint exit 0 with 307 existing-repository warnings, scoped files zero warnings;
  `pnpm build` PASS; `pnpm validate:canon` PASS; `git diff --check` PASS.
- Build initially denied a loopback listener by the sandbox, then passed the same command with
  approved local execution. Initial PostgreSQL sandbox connection denied; same tests passed with
  loopback access. Neither environment denial is represented as a product failure or test PASS.
- Started only the previously stopped existing `waia-dee960-local-pg17-20260909` PostgreSQL17
  fixture at `127.0.0.1:55460`. Synthetic databases and roles retained; no user or production data
  removed, no other container restarted. No scientific process or actual HTX request touched.
- Independent read-only review reported no proven P1/P2 for source blobs:
  host `240a21b53c189936224218fe0c58aff81f341e84`, role probe `bdbc9746f22ebbab318bbf6ccecd5f9d06731b74`.
  Root still owns final integration/exact-head review, commit/PR and remote gates.
- Final independent test-delta review: no proven P1/P2; unit blob
  c25e8a05f1c7e8be1565015447048d0bcad84fff and actual PostgreSQL reader suite
  ddab18561e65610146103d55dd757185142424c1. Empty-assignment host integration
  proves construction/drain, not a collection cycle; existing configured-runtime
  cycle tests remain separate. Root reviewed final source and integration delta.

## Remaining activation boundaries

This is an explicit local lifecycle library, not a deployed daemon, operator assignment provisioning,
or new key-management service. Factory implementations are trusted infrastructure providers; SQL
driver options and actual role metadata are checked, but an arbitrary fabricated driver object is
not cryptographically authenticated. Pool opening signals cover construction; successful resources
remain owned until explicit disposal. Cancellation/deadline cleans late-delivered resources, while
an uncooperative never-settling disposer yields a fixed failure, not a claim of proven closure.

The metadata probe is bounded and read-only, not a complete cluster ACL certification. Production
provisioning must independently qualify LOGIN credentials, schema/function privileges, key-service
isolation, resource-limit enforcement, rate limits, activation, restarts and monitoring before an
actual account is admitted. No method in this package grants exchange or trading authority.
