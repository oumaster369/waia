---
integrationIssue: DEE-1015
integrationTitle: "Account observation production host: executable collector, trusted assignments, state provisioning and credential-isolated runtime"
branch: dee-1015-account-observation-production-host-executable-collector
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [focused-unit-tests, actual-postgres17-integration, lint, typecheck, build, canonical-docs, pr-governance, execution-consumer-graph, independent-exact-diff-review]
approvalGates: [integration-ready, human-merge, separate-production-alpha0-ceremony]
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4, WP-5]
  remainingWorkPackages: []
  prNumber: 599
  prUrl: https://github.com/oumaster369/waia/pull/599
  lastValidatedGitSha: 8875fc047415c5c2d8c3a80456f93bca12c3edcf
  lastValidationAt: 2026-09-16
  blockedReason: null
  nextAction: "Human review and squash merge; the production Alpha 0 ceremony stays separate and Human-only."
provenance:
  authoritativeBase: 1eaa73cd134e1bc104b0f4fefa4e1e5c9f08e801
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1015 — Account observation production host

## Exact starting point

Base SHA **`1eaa73cd134e1bc104b0f4fefa4e1e5c9f08e801`** (`origin/main`, verified by fresh fetch, unchanged
from the instruction's expected tip). Fresh worktree/branch
`dee-1015-account-observation-production-host-executable-collector`. The stale
`dee-904-production-bootstrap-orchestrator` worktree is not a base and is not modified.

## Reconciled existing implementation (reused, not rebuilt)

Verified on the base SHA before writing code:

| Fact | Evidence |
|------|----------|
| `createAccountObservationHost` is a library host, not a daemon/CLI | `lib/trader/account-observation/host.ts:68`; referenced only by that file and `tests/{unit,integration}` |
| No `trader:*` command starts it | no `package.json`/`scripts/`/`services/` reference to account observation |
| Historical Execution Server admits only `idle` / `historical-v2-ratified-one-shot` and refuses master/HTX authority | `services/ai-trader-execution-host/entrypoint.mjs` `FORBIDDEN_RUNTIME_KEYS` + `parseExecutionHostRuntimeV2` |
| `waia_account_observer` has **no** INSERT on `trader_account_collection_state` | `0205:127-132` grants SELECT on both tables, INSERT only on `trader_account_observations`, UPDATE limited to lease/cadence columns |
| Existing 0205 schema is sufficient | no contradiction reproduced; provisioning is an authority question, not a schema question |
| Account-observation transport is GET-only | `htx-get-transport.ts:62,112` refuse non-GET and issue `method: "GET"` only |
| Account-observation code has no Execution V2 order-submission authority | no `placeOrder`/`submitOrder`/`cancelOrder` reference anywhere under `lib/trader/account-observation/` |

Reused as-is: `host.ts`, `configured-runtime.ts`, `runtime.ts`, `scheduler.ts`, `service.ts`,
`postgres-repository.ts`, `postgres-reader.ts`, `postgres-assignments.ts`, `credential-store.ts`,
`htx-reader{,-opener}.ts`, `htx-get-transport.ts`, `htx-read-admission.ts`, `coverage.ts`,
`host-role-probe.ts`, read/stream handlers and routes, `0205_trader_account_observation_v1.sql`,
`lib/trader/credentials/*`, `lib/trader/security/secrets-store-master-key-provider.ts`.

DEE-956/960/961/978/979 acceptance boundaries are unchanged: no scheduler, host lifecycle, HTX reader,
admission, persistence, read projection, SSE or UI is rebuilt or altered.

## Architecture chosen

A **supervisor + consumer** pair, mirroring the established `services/ai-trader-execution-host`
production-service convention, plus one Human-invoked provisioning operator following the
`scripts/ops/postgres-h2-migration-operator-v1.ts` convention.

### Dedicated observation runtime target

`services/ai-trader-account-observation-host/` — a **third** approved host service, a distinct runtime
authority from the historical Execution Server:

- `entrypoint.mjs` — supervisor. Validates exact release identity, runtime mode, three distinct
  PostgreSQL logins, absolute manifest path, manifest content digest and deployment tier **before**
  opening a listener or spawning anything. Owns its own health identity
  (`service: "ai-trader-account-observation-host"`), `--preflight-image` and `--preflight-runtime`.
  Refuses forbidden runtime keys and forwards only a strict env allowlist to the consumer.
- `server.mjs` — separate health listener (default port 8090), distinct from the execution host's 8080.
- `Dockerfile` / `.dockerignore` — selective COPY packaging, non-root user, `WAIA_IMAGE_RELEASE_SHA`
  build arg, mirroring the execution host image contract.

`services/ai-trader-execution-host/entrypoint.mjs` is **not modified**; its `FORBIDDEN_RUNTIME_KEYS`
and secret refusal remain byte-identical and are additionally pinned by a new digest regression.

### Process lifecycle

`entrypoint.mjs` (validate → health listener → spawn) → consumer
`scripts/trader/account-observation-collector-host.ts`:

trusted manifest validation → database resource admission (`probeObservationPool` for collector and
reader) → protected credential service → configured HTX observation runtime (via
`createConfiguredHtxObservationRuntime`, constructed inside the existing host) →
`createAccountObservationHost` → recurring run → bounded drain.

No scheduler, lease logic or runtime loop is duplicated in the entrypoint. Cadence, leases and backoff
remain owned by the merged DEE-960/979 runtime and durable `trader_account_collection_state`.

SIGTERM/SIGINT: supervisor forwards the signal to the consumer; the consumer calls the existing
`host.stop()` and awaits the existing bounded drain, then exits 0. A consumer failure exits non-zero
and shuts the supervisor down; the container restart policy is a ceremony decision, not repository state.

### Secret boundary

- The Cloudflare binding name `AI_TRADER_MASTER_KEY` is **forbidden** as an environment variable in this
  service, exactly as in the execution host. The observation runtime consumes an explicitly
  service-scoped `WAIA_OBSERVATION_MASTER_KEY` (base64 32-byte) instead, so a Worker binding name can
  never be silently satisfied by a plaintext env string.
- The master key reaches only the consumer process, through the supervisor's env allowlist.
- The credential service is built from the existing `SecretsStoreMasterKeyProvider.create` +
  `createCredentialService` + `createPostgresExchangeCredentialRepository`; no new key-management
  service, no new crypto. `assertCredentialDecryptionAllowed` still gates decryption, and
  `productionReady` is derived from the existing `isProductionDeployment()`.
- HTX API keys are never accepted as environment or request input; they are only ever decrypted by the
  existing protected credential store, per assignment, behind the existing double DB fence.
- Diagnostics report fixed event codes, release identity, manifest digest and counts only.

### Database roles

Three distinct logins, all separately provisioned outside this PR:

| Purpose | Login | Granted role | Authority |
|---------|-------|--------------|-----------|
| Collector | `waia_account_observer_login` | `waia_account_observer` | lease/cadence UPDATE + observation INSERT |
| Reader | `waia_account_observation_reader_login` | `waia_account_observation_reader` | SELECT projection only |
| Credential | `waia_account_observation_credential_login` | (credential ciphertext read) | `exchange_credentials` ciphertext for envelope decryption |
| Provisioning | operator-supplied elevated login | migration/provisioning authority | one-row INSERT inside the operator boundary only |

`probeObservationPool` proves collector/reader identity, exclusivity, absent ciphertext access, absent
destructive privilege and forced RLS before the credential service opens. The credential login is
deliberately a **third** resource so the collector/reader probes can keep asserting "no ciphertext".

### Trusted assignment authority

`lib/trader/account-observation/assignment-manifest.ts` — a strict, digest-bound operator manifest:

- schema `waia.account_observation_assignment_manifest.v1`, `.strict()` at every level;
- binds `releaseSha`, `host`, host-level `intervalMs`/`iterationTimeoutMs`/`openTimeoutMs`/`shutdownTimeoutMs`,
  and per assignment `organizationId`, `credentialId`, `exchangeAccountId`, `credentialRevision`,
  `configurationRevision`, `symbols`, and reader/coverage limits;
- deterministic identity: canonical JSON → sha256. The manifest's own declared `contentSha256` and an
  independently injected expected digest must both equal the recomputed digest, mirroring the H2
  operator's `--expected-target-fingerprint` two-party binding. A file swap without a deployment change
  fails closed;
- recomputes `createObservationConfiguration` and requires `configurationRevision === config.revision`;
- requires `htxCoverage` to equal `{ ...readerLimits, host }`;
- refuses duplicate accounts, duplicate credentials, unsupported hosts/symbols/coverage, revision
  mismatch, release mismatch, digest mismatch, more than 20 assignments;
- is never derived from browser/request input and performs no account discovery and no
  "all organizations" mode. It only narrows what an operator already approved; the existing
  `createPostgresObservationAssignmentSource` still re-checks currentness against the database, and a
  DB match is still not venue admission.

### Provisioning authority

`scripts/ops/account-observation-provision-collection-state-v1.ts` +
`pnpm trader:observation:provision-state` — bounded, Human-invoked, one exact assignment per invocation:

- requires `WAIA_TRADER_CLI=1` and `DATABASE_URL_POSTGRES_SESSION` (the same elevated
  provisioning/migration authority the H2 operator uses), never the collector login;
- requires `--manifest`, `--expected-manifest-sha256`, exact `--organization-id`/`--credential-id`/
  `--exchange-account-id`, and `--confirm-exact-assignment org:credential:account`; `--verify-only`
  performs every check and commits nothing;
- attests the provisioning session: PostgreSQL ≥ 17, INSERT privilege on
  `trader_account_collection_state`, RLS-unfiltered authority, and that the session is **not** the
  collector/reader runtime role;
- asserts the least-privilege invariant that `waia_account_observer` still has **no** INSERT on
  `trader_account_collection_state` — a broadened grant fails the operator closed;
- validates the credential row: exists, `venue='htx'`, `status='active'`, exact organization and
  exchange account, and `observation_revision` equal to the manifest `credentialRevision`;
- INSERT only. Exact existing row → idempotent `ALREADY_PROVISIONED`. Any differing
  `configuration_revision`/`symbols` → `CONFLICTING_STATE` refusal. No UPDATE, no DELETE, no
  observation-history mutation, no schema change;
- emits a canonical JSON receipt of identities and digests, with no secret values.

### Failure / restart behavior

Invalid configuration fails before any pool, credential or network open. Construction failure disposes
every acquired resource in reverse order through the existing bounded host cleanup. Runtime failure
propagates `ACCOUNT_OBSERVATION_HOST_FAILED`, drains, and exits non-zero. Restart means a fresh process
and a fresh host; durable cadence, leases, revisions and observation history are untouched, so a restart
cannot re-collect out of cadence.

## Explicit non-goals

No deployment, no image push, no Cloudflare/Supabase/production mutation, no secret injection, no HTX
credential creation, no real HTX call, no migration apply, no H2/H5/holdout/FHV/Forward-Paper/live step,
no 0205 edit, no new migration, no 0206–0208 bundling, no order/cancel/amend/transfer/withdraw method,
no DEE-978 permission-semantics change, no Execution Server modification, no C3 contact, no AI-TWIN
worktree change, no UI/SSE/read-projection change, no deploy/rollback shell automation (the ceremony
runbook documents exact commands instead), no ADR (current canon determines every decision here).

## Acceptance

1. One executable production entrypoint constructs and reuses the merged DEE-979
   `createAccountObservationHost` without reimplementing its scheduler, lease or coverage logic.
2. A trusted, operator-authored, digest-bound assignment manifest is the only production source of
   `ObservationAssignment[]`; it is never browser-controlled, request-derived or discovery-derived.
3. A dedicated observation runtime target exists with its own health/preflight identity, exact release
   binding, credential-capable secret boundary and bounded SIGTERM/SIGINT drain — separate from the
   historical Execution Server, whose `FORBIDDEN_RUNTIME_KEYS` refusal stays byte-identical.
4. A Human-invoked provisioning operator seeds exactly one approved `trader_account_collection_state`
   row, idempotent on an exact match and fail-closed on any conflict, without granting the recurring
   collector login INSERT authority.
5. Capital safety is proved by regression: GET-only transport, read-only admission, unchanged
   `legacyOrderSubmissionDisabled()`, and an authority-graph walk showing no reachable Execution V2
   connector dispatch or order/cancel/amend/transfer/withdraw capability.
6. `db/migrations_postgres/0205_trader_account_observation_v1.sql` is byte-identical and no migration is
   added or applied.
7. Local qualification passes: focused unit suites, actual disposable PostgreSQL 17 provisioning
   integration, `pnpm lint`, `pnpm typecheck`, `pnpm build`, canonical-doc validation, PR-governance
   validation, execution consumer/import-graph validation, `git diff --check`.

## WP-1 — Trusted assignment manifest authority

`lib/trader/account-observation/assignment-manifest.ts`: schema-versioned, size-bounded, canonical-JSON
digest-bound manifest parser with explicit refusal codes. Focused negative tests for digest, release,
organization, credential/account substitution, revision, symbol/coverage, host and duplicate-account
cases.

## WP-2 — Executable collector consumer

`scripts/trader/account-observation-collector-host.ts`: runtime-identity validation → manifest admission
→ distinct collector/reader/credential resources through injectable factories → existing role probes →
protected credential service → configured HTX observation runtime → `createAccountObservationHost` →
recurring run → bounded drain. Focused tests prove refusal before any protected resource opens.

## WP-3 — Dedicated observation service target

`services/ai-trader-account-observation-host/`: supervisor `entrypoint.mjs` (own forbidden-key set,
preflight, health identity, allowlisted child environment, signal forwarding), `server.mjs` health
endpoint, `Dockerfile`, `.dockerignore`. Supervisor tests plus the third-service allowlist update in the
Execution Server boundary regression.

## WP-4 — Collection-state provisioning operator

`scripts/ops/account-observation-provision-collection-state-v1.ts`: Human-invoked, manifest-bound,
verify-only capable, privilege-attesting, idempotent single-row INSERT with a canonical receipt. Unit
tests plus actual PostgreSQL 17 integration appended to the CI-selected observation suite.

## WP-5 — Authority graph, validation and publication

Static transitive-import regression proving the new runtime cannot reach Execution V2 order submission,
full local validation, independent adversarial exact-diff review, single PR to `main`.

## Affected files

New: `lib/trader/account-observation/assignment-manifest.ts`,
`lib/trader/security/credential-payload-aad.ts`,
`scripts/trader/account-observation-collector-host.ts`,
`scripts/ops/account-observation-provision-collection-state-v1.ts`,
`services/ai-trader-account-observation-host/{entrypoint.mjs,server.mjs,Dockerfile,.dockerignore}`,
`docs/ops/ACCOUNT-OBSERVATION-HOST-RUNBOOK.md`,
`tests/unit/account-observation-manifest-fixtures.ts`,
`tests/unit/account-observation-assignment-manifest.test.ts`,
`tests/unit/account-observation-collector-entrypoint.test.ts`,
`tests/unit/account-observation-host-service.test.ts`,
`tests/unit/account-observation-state-provisioning.test.ts`,
`tests/unit/account-observation-authority-graph.test.ts`,
`docs/plans/dee-1015-account-observation-production-host-executable-collector.md`.

Modified: `package.json` (two operator scripts),
`lib/trader/security/index.ts` and `lib/trader/credentials/envelope-crypto.ts` (relocate
`credentialPayloadAad` out of the security barrel so envelope decryption no longer drags the HTX
trade-capable connector into the observation import graph; the barrel still re-exports it, so every
existing consumer is unchanged),
`tests/unit/trader-bp6-execution-host-boundaries.test.ts` (third approved service),
`tests/integration/trader-account-observation-postgres.test.ts` (appended DEE-1015 PostgreSQL block),
`.github/workflows/account-observation-postgres.yml` plus
`tests/unit/account-observation-postgres-ci-contract.test.ts` (the existing observation Postgres job now
also triggers on the three new DEE-1015 paths, kept in lockstep by its contract test),
`docs/ops/EXECUTION-SURFACES.md` (documents the future dedicated observation host surface, which canon
requires to exist before the post-merge ceremony may use it),
`docs/ai-trader/reality-v2-source-consumer-inventory.json` (consumer **content** repin only —
`4b66aaca…b5ba` → `33d0a073…7870`).

The Reality V2 repin is mechanically justified and deliberately minimal. Consumer count stays 129, the
sorted **path** digest is byte-identical, the 154 source paths, source content digest, 25 connector
references, consumer rules, canonical kinds and ingress boundaries are all unchanged. The only two
pinned consumers whose bytes moved are `lib/trader/security/index.ts` (one inline function replaced by a
re-export) and `lib/trader/credentials/envelope-crypto.ts` (one import specifier), and both are
behaviour-identical: the AAD string and every exported name are the same. The change strictly *reduces*
reachable authority, which is exactly what the pin exists to surface for review. Precedent for a
mechanically derived repin inside one issue is [DEE-960](dee-960-account-observation-core.md).

Unchanged and asserted so: `services/ai-trader-execution-host/**`,
`db/migrations_postgres/0205_trader_account_observation_v1.sql`, every merged
`lib/trader/account-observation/*` runtime module.

## Tests

Entrypoint/runtime: invalid config before I/O; missing/wrong release identity; malformed and duplicate
trusted assignments; distinct reader/collector resources; wrong PostgreSQL roles; credential service not
opened before admission; synthetic-dependency startup success; SIGTERM/SIGINT drain; failed-construction
and runtime-failure cleanup; no secret-bearing diagnostics.

Trusted assignment: content/digest identity; credential and account substitution; organization mismatch;
revision mismatch; symbol/coverage mutation; unsupported host; duplicate account; stale configuration.

Provisioning: new exact row; exact idempotent retry; conflicting row refusal; revoked/wrong credential
refusal; organization/account mismatch; least-privilege attestation; collector role provably without
arbitrary INSERT bootstrap authority — on actual disposable PostgreSQL 17 with real 0205 grants.

Authority graph: transitive import walk proving the new service, consumer and operator cannot reach
Execution V2 connector dispatch or any order/cancel/amend/transfer/withdraw capability; GET-only
transport, read-only admission, `legacyOrderSubmissionDisabled()` and Execution Server secret refusal
all asserted unchanged.

Regressions rerun: DEE-960/961/978/979 focused suites plus the account-observation PostgreSQL CI
contract, so streaming and admission cannot break silently.

## Rollback

Repository-only change. Revert the single squash merge; nothing is deployed, provisioned, migrated or
keyed by this PR, so revert restores the exact prior operational state. Until the separate ceremony runs,
the new service has no image, no secret, no assignment manifest and no collection-state row, and is
therefore inert.

## Post-merge Human-only production ceremony (not acceptance here)

Fresh production preflight → exact H2 step `0205` **if and only if** the then-current live journal and
predecessor permit it → provision the three observation LOGIN roles → deploy the exact merged app and
build/run the exact observation host image → create an HTX **`readonly`-only** key (no `trade`, transfer
or withdrawal) → inject `WAIA_OBSERVATION_MASTER_KEY` and the three database URLs into the dedicated
runtime → author and digest the exact assignment manifest → run the provisioning operator for the exact
approved assignment → start the collector → verify automatic tenant/Admin SSE parity, reconnect, polling
fallback, revoke, restart, stale-state truth and zero venue writes. Every step is Human-only and outside
this PR.
