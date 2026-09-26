---
integrationIssue: DEE-1127
integrationTitle: "Attest observation credential SQL authority before host startup"
branch: dee-1127-observation-credential-startup-attestation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres17, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2, WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Implement admitted bounded credential-pool startup probe and actual private-factory integration; native PG17 requires controller resource grant."
provenance:
  authoritativeBase: 340ead8da22b35c47a20de12ec0eef652ef950ff
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1127 — observation credential SQL startup attestation

Parent DEE-176; the Controller admitted this foundation implementation on 2026-09-26
under the user's delegated technical authority after M01 independent design acceptance.
Active Linear issue DEE-1127 is In Progress with execution label backend. Start at
accepted main `340ead8da22b35c47a20de12ec0eef652ef950ff`. Pinned source facts from 752a
are unchanged there. Commit this canonical plan before implementation.

Frozen R2 SHA256: `6e000a9d5778c85041da63978e7d67cbc05b71a64e54269a1c8bc3a47581363d`.
Supporting addendum: `c13f0648b82ef549f42d2ccddf686100b22e5f0f300b92e601a25fee24a8ade4`.
The proposal-status language embedded below preserves provenance; Controller admission
supersedes its pending-authorization wording. This is not final DEE-176, D09 resolution,
current deployment assurance or new scientific/financial/live authority.

## WP-1 — mandatory third-resource catalog admission

Add the exact credential-login/parent probe to the existing host-role-probe module,
leaving collector/reader behavior intact. Bind it into the real private credential
factory before provider initialization/readiness; honor its opening signal and
existing bounded cleanup. No factory export, optional admission bypass, schema,
provisioner, KMS, master/permission-policy, provider or production change.

## WP-2 — actual default-factory adversarial proof

Add focused probe/startup/cancellation/late-cleanup units and extend the existing
credential PostgreSQL suite. Native proof uses real isolated PostgreSQL 17 at the
existing fixed loopback55460 harness, actual restricted role sessions, actual
production default factory, synthetic crypto and inert HTX transport. Preserve
foreign/revoked/column controls; explicitly restore cluster-global role/ACL changes.
PG16, fake server versions or skipped opt-in suites are not supported native proof.

## WP-3 — required executed proof and independent readiness

The CI author exclusively owns the four proof paths: `.github/workflows/account-observation-postgres.yml`,
`tests/unit/account-observation-postgres-ci-contract.test.ts`,
`scripts/postgres-validation/assert-account-observation-test-results.mjs`, and
`tests/unit/account-observation-test-results-guard.test.ts`. Add mandatory JSON proof
for all four existing serial PG17 suites and negative guard tests. No other native
lane is replaced. Controller owns full readiness, final nonauthor review, preflight,
PR and publication. File-scoped commits only in this shared checkout.

## Acceptance criteria

- Actual credential session/parent attributes, memberships, effective protected-object
  privileges, non-database direct ACL and ownership admission precede provider init.
- Explicit CONNECT/PUBLIC/TEMP limits, parent NOINHERIT, RLS-bit limitations and
  startup-only scope exactly follow R2; no broader no-DDL/no-residency claim.
- Unsafe startup produces no HOST_STARTED, venue request or credential-service use;
  prior resources and failed/late credential pool close with fixed errors.
- Safe default-factory startup and existing three-resource/GET-only behavior remain.
- Actual PG17 four-suite proof passes with zero skips and enforced JSON guard;
  unit, scoped lint, later full readiness/current-base CI and independent review pass.
- Evidence records tested SHAs, initial failures, exact role restoration/session
  teardown and honest native/fixture/deployment limits. No current result claimed yet.

## Validation and resource ownership

Author may run targeted units/scoped ESLint and one coordinated typecheck after
source freeze. Native PG17 and heavy full checks require explicit Controller grants;
no such grant exists at this plan commit. Read-only executable/container discovery
is allowed; do not start or alter any existing database. Controller schedules all
native/full readiness and keeps production/C3/live out of this work.

## Frozen admitted R2 implementation contract (verbatim)

# P13 foundation — authoritative revised credential-pool startup contract R2

**Status:** ready for root/M01 admission review only. No issue, implementation, database connection or native test has been authorized by this text. Immutable source base: **752a09e07bd2b7d19387a45f74627bc6ced6b6ab**.

This is the **single operative revised engineering proposal**. It incorporates the finite PG17/ACL/factory clarifications verbatim below and supersedes only the less precise claims in original contract `982bf6d1335679207f5816a9fc2bf4fe46cb620b4788cdce28112a4ad514452b`. Original contract and matrix are preserved unchanged. Exact supporting addendum: `P13-THIRD-POOL-NATIVE-AND-ACL-ADDENDUM-752a09e0.md`, SHA256 **c13f0648b82ef549f42d2ccddf686100b22e5f0f300b92e601a25fee24a8ade4**. No reader must infer an unwritten exception from the original proposal.

## Concrete trigger and acceptance

At the pinned source, `runAccountObservationCollector` constructs the real protected host. The host verifies collector and reader pool posture, then invokes private `openObservationCredentialService`. That factory creates the third SQL pool, imports the master through the existing provider and returns the narrow reader without a live credential-session posture query. URL username validation and provision-time checks do not establish current runtime role attributes. Existing READ ONLY / SET LOCAL ROLE / eight-column projection / assignment RLS remain genuine controls; no deployed privilege drift or bypass has been observed.

**One complete result:** the actual collector entry may initialize its credential provider, report HOST_STARTED and reach its normal observation reader only after its own third database resource passes a mandatory bounded startup identity/privilege probe. Unsafe/unverifiable startup refuses, closes acquired SQL resources, emits no host readiness and makes no venue request. Safe provisioner-compatible startup preserves the existing observation behavior and drain. This is a real default-factory integration, not an optional admission helper.

The probe does not prove current HTX key permissions, memory nonresidency, exact policy-definition integrity or continuous privilege stability. It does not resolve D09. No existing master, KMS, exchange permission, scientific, financial or live policy is changed. Potential parent is a P13 foundation child under DEE-176 after root dedupe; it is not final DEE-176 qualification.

## Exact implementation surface if admitted

- `lib/trader/account-observation/host-role-probe.ts`: new exported credential-specific probe, preserving collector/reader behavior.
- `scripts/trader/account-observation-collector-host.ts`: mandatory call in the existing private credential factory and its existing opening-signal/cleanup lifecycle; keep factory private.
- `tests/integration/account-observation-credential-postgres.test.ts`: actual default-factory PG17 positive/adverse cases, serial role-restoration proof; retain existing controls.
- `tests/unit/account-observation-credential-startup.test.ts`: new focused ordering/abort/late cleanup controls. Fake SQL unit controls are explicitly not native role proof.
- `.github/workflows/account-observation-postgres.yml`, `tests/unit/account-observation-postgres-ci-contract.test.ts`, new `scripts/postgres-validation/assert-account-observation-test-results.mjs`, new `tests/unit/account-observation-test-results-guard.test.ts`: mandatory four-suite PG17 executed-result guard and negative controls, root-owned integration.
- New canonical child plan at `docs/plans/dee-<admitted-id>-observation-credential-startup-attestation.md`; actual issue ID assigned only by root.

No schema/migration, role provisioning, existing historical plan rewrite, credential-data read during startup, real key injection, provider/host execution, new transport, endpoint, automatic role repair, key rotation or change to generic `readonly+trade` admission. Existing three-pool resource ownership and all four native suites remain. Native/heavy resources require a separate root grant. If implementation cannot satisfy these checks without broadening privileges, stop and report the exact failure instead of adding authority.

## 1. Exact existing real-PG17 acceptance lane

The supported lane is **`.github/workflows/account-observation-postgres.yml` → `account-observation-postgres17`**, displayed as **“PostgreSQL 17 account observation restricted-role guard”**. Its service is `postgres:17-alpine`, published only for the synthetic harness at **127.0.0.1:55460**, database `waia_dee960_local`, login `waia_local_admin`. Its fixed credentials are public synthetic fixture literals, not production inputs. The test target does not fall back to a configured application database. The enabling flag is `DEE960_LOCAL_PG17=1`.

The four exact suites run serially with `--no-file-parallelism`:

1. `tests/integration/account-observation-migration-postgres.test.ts` — the existing limited-owner migration/prefix/full-journal checks.
2. `tests/integration/trader-account-observation-postgres.test.ts` — recurring collector.
3. `tests/integration/account-observation-reader-postgres.test.ts` — reader authority.
4. `tests/integration/account-observation-credential-postgres.test.ts` — provisioner, credential authority and real collector entry.

`tests/unit/account-observation-postgres-ci-contract.test.ts` pins the separate lane, image/port, flag, serial four-suite list, filters and absence of soft-failing/disabled job options. Its test description still says “three” in one name, but the actual pinned list has **four** entries; count the executed files, not that prose. There is no justification to replace this lane with the generic capital-authority or billing lanes.

The existing credential suite executes **`SHOW server_version_num`** and requires **170000 ≤ version < 180000**. It creates a unique `dee1015_cred_<uuid>` database, applies canonical **0006, 0007, 0205 and 0210** under a limited DDL owner, provisions actual runtime LOGINs through the real operator, and connects through those logins. Its credential-specific database is a four-migration fixture, **not** a full-journal proof. The separate first suite performs the existing full-journal check; these are distinct evidence claims.

Root reports that local **54329 is PG16.14**. This addendum did not connect to verify that report. In either event it is not the designated PG17 lane: no fake version, suppressed unsupported-parameter error, environment-only “PG17” assertion, or PG16 run may be reported as supported native acceptance. The valid choices after a resource grant are the existing CI PG17 service or an explicitly granted fresh local PG17 instance matching this fixed 55460 harness. Creating/starting such an instance is **not authorized by this addendum**. Existing listeners/fixtures must not be replaced, repointed or reset.

Add the new native cases to the already registered fourth suite unless implementation reveals a concrete isolation need. Preserve all four serial suites and the existing CI contract. Save machine-readable results for exact source, four executed files, all passed and zero skipped; a flag-disabled local invocation is not native proof. If a separate test file is ultimately necessary, root must add it to the lane and its contract rather than relying on an unregistered one-off run. No unrelated historical/capital/billing gate is removed.

**A JSON executed-proof guard does not currently exist in this PG17 workflow.** The static CI contract is not that guard. This proposal explicitly includes adding JSON output plus a required observation-specific executed-proof check and negative guard tests, using the pattern of `scripts/postgres-validation/assert-payment-reconciliation-test-results.mjs` without altering its payment list or a capital PG16 gate. Proposed owned paths are `scripts/postgres-validation/assert-account-observation-test-results.mjs`, `tests/unit/account-observation-test-results-guard.test.ts`, this PG17 workflow and its existing static contract. The new check must require each of the four exact files once, passed status, nonempty assertions, every assertion passed, and no failed/skipped/todo assertions; malformed/missing/duplicate/empty/skip-only results and disabled/missing guard wiring must fail. It runs after the unfiltered serial native invocation. Root owns final proof/CI integration after admission. These are future changes, not existing acceptance credited by this addendum.

### Cluster-role test isolation

The existing four suites create isolated databases but use **cluster-global role names**. They therefore must remain serial. The credential suite currently closes clients and retains its synthetic database; retention is not failure to close sessions. New adverse startup tests that temporarily change a canonical test role must run only on the explicitly isolated PG17 test cluster, restore the precise changed attribute/ACL in `finally`, and prove restored role/grant state plus no remaining sessions/fault hooks. Database isolation alone does not isolate a changed role. No adversarial role mutation on shared 54329 or any existing non-test database is proposed.

## 2. Exact no-direct-ACL and ownership boundary

Reuse the **semantics** of `scripts/ops/provision-account-observation-logins.mjs::LOGIN_POSTURE` and `readParent`; do not import that executable provisioning module into the production runtime or execute its mutation path.

The existing non-database direct-ACL predicate is exactly:

```sql
EXISTS (
  SELECT 1 FROM pg_shdepend dependency
  WHERE dependency.refclassid = 'pg_authid'::regclass
    AND dependency.refobjid = login.oid
    AND dependency.deptype = 'a'
    AND dependency.classid <> 'pg_database'::regclass
) AS has_direct_grants
```

It has **no current-database filter**; it can detect such dependencies in another database in the same test cluster. Reusing it does not justify silently narrowing it to `pg_class` or only the two runtime tables. Ownership uses the same `refclassid/refobjid` pair with **`deptype = 'o'`**, again without a database filter; the provisioner also explicitly checks `pg_database.datdba = login.oid` for the current database. Preserve these scopes and return only refusal booleans/fixed codes, not arbitrary catalog/ACL bodies.

There is an important source/comment distinction:

| Item | Actual source predicate / permitted interpretation |
|---|---|
| Login direct table/column/schema/function ACL dependencies | Refused by the predicate above; login authority should derive from exactly its approved parent. |
| Database ACL dependencies | **All `pg_database` ACL dependencies are excluded** by that predicate, not only CONNECT entries. |
| Current database CREATE | Separately refused using **effective** `has_database_privilege(login.oid, current_database(), 'CREATE')`, including authority inherited via PUBLIC. Apply the corresponding effective check to the parent too, so SET ROLE cannot add it. |
| CONNECT | Required connectivity; direct or existing PUBLIC CONNECT is not treated as a forbidden data grant. Successful connection is not row authority. |
| TEMP / TEMPORARY | The existing provisioner **does not test it**. This minimal runtime check must neither claim TEMP is denied nor turn it into a new global policy. A positive native control must record actual `has_database_privilege(..., 'TEMP')` and remain compatible with the existing provisioner's admitted role. No runtime grant/revoke is added. |
| PUBLIC catalog/schema rights | PUBLIC is not a login-specific ACL dependency attributable to that login OID. Catalog reads necessary for the probe and existing schema USAGE are not rejected as direct login grants. A global “no PUBLIC privilege” or “no DDL anywhere” claim would be false. |
| PUBLIC access on protected data | Effective `has_*_privilege` checks on the bounded credential/state/observation relations must still detect extra access supplied by PUBLIC. The direct-ACL predicate alone cannot do that. |

Thus the provisioner's comment “CONNECT … is the only ACL dependency tolerated” is stronger than its actual database-ACL filter. **This addendum corrects the original proposal's “except CONNECT” / unrestricted “no DDL” wording:** reuse the current non-database direct-ACL/ownership checks, deny effective database CREATE and permanent CREATE in the checked `public` schema, preserve existing connectivity and untested TEMP compatibility, and do not assert universal denial of temporary-object or unrelated-schema privileges. Enforcing literal CONNECT-only would require another reviewed compatibility decision; it is not smuggled into this startup repair.

### Parent and protected-object checks

The parent's expected schema USAGE and exact column grants are legitimate; applying the login's “no direct ACL” predicate to the parent would reject the intended 0210 authority. Instead:

- Parent is the exact `waia_account_observation_credential`, **NOLOGIN, NOINHERIT**, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION, with no parent memberships/ownership. Pin NOINHERIT from **0210**, not merely the generic provisioner's `readParent`: that generic helper deliberately tolerates the older 0205 observer's inheritance attribute when it has no memberships. Login is the exact safe NOINHERIT identity `waia_account_observation_credential_login`, LOGIN with every other privileged attribute false, only that parent, ADMIN/INHERIT false, SET true and the existing connection limit 2. Require `current_user = session_user` at probe entry and no other role reachable with `pg_has_role(session_user, role, 'SET')` apart from self and this parent.
- Login/parent must have no effective CREATE on the current database or checked `public` schema. Schema USAGE remains permitted. Ownership cannot substitute for an ACL grant.
- On `exchange_credentials`, the parent receives only the eight declared SELECT columns; no whole-table SELECT, any additional-column SELECT, data write/destructive/reference/trigger/maintenance privilege. On `trader_account_collection_state`, only the three identity columns are permitted. `trader_account_observations` remains unavailable to this credential role. Evaluate effective privileges, including PUBLIC contributions, for both the login and the parent; the NOINHERIT login is not required to possess its parent's eight columns before SET ROLE.
- RLS remains enabled on credential/state tables; collection state retains FORCE RLS. Do not require FORCE RLS on `exchange_credentials` or broaden policies. These catalog flags are **not** proof of exact policy-definition integrity, absence of every additional permissive policy, or continuous drift protection. Actual assigned/foreign/revoked native controls remain the row-visibility evidence at the tested schema.
- These are **bounded object/membership checks**, not an exhaustive allowlist of every parent/PUBLIC privilege or callable function in the cluster. The original phrase “any extra authority” applies to this explicit checked scope. Unexpected authority outside it is reported rather than silently claimed absent.

All catalog checks run using the credential resource's own actual restricted login. Administrator-selected fake result rows cannot prove that login can execute the probe. No SECURITY DEFINER helper, new catalog grant, owner fallback, role provisioning or automatic repair is allowed to make it pass.

**Matrix precision:** existing collector/reader URL parsers demand their canonical username strings, but `probeObservationPool` itself only returns a nonempty actual login, checks its attributes/exclusive role and lets the host compare the two actual names for distinction. It does **not** compare each actual `session_user` to its canonical login string. The original matrix's “exact logins” describes configured usernames, not an already present exact-session-name assertion. This new credential probe explicitly checks its exact actual name. Do not silently broaden this package into a change to the other two probes.

## 3. Real production composition: no factory export required

The existing native case **`starts the actual collector through all three provisioned runtime identities`** in `account-observation-credential-postgres.test.ts` already invokes:

`runAccountObservationCollector({ env: synthetic fixed-role URLs/manifest/master, signal, fetchImpl, report })`

It **does not supply `openCollector`, `openReader` or `openCredentialService`**. Consequently the actual private factories execute; only the external HTX transport is inert. The test reaches a signed read using the synthetic decrypted key, records HOST_STARTED and drains the real SQL resources. This is the preferred extension seam.

Keep `openObservationCredentialService` private in `scripts/trader/account-observation-collector-host.ts`. Its existing actual path becomes:

1. construct its bounded credential SQL client;
2. await the new mandatory catalog probe using that client;
3. check cancellation/current ownership;
4. initialize the existing master provider and construct the existing reader;
5. return the same resource interface, with existing SQL cleanup on failure/disposal.

Export the new reusable credential **probe** from the existing `lib/trader/account-observation/host-role-probe.ts` for direct native wrong-login/catalog tests; preserve the existing collector/reader probe behavior. There is no need to export the resource factory, introduce another service implementation, widen `ObservationCredentialResource`, or inject an optional `admit` callback into production.

The private factory currently returns a callback that ignores the host's opening AbortSignal. The bounded repair must accept that existing signal and check it **before creating SQL**, **after the probe**, **after provider initialization** and **before returning the resource**. A cancellation/failed construction closes the owned SQL client through the existing `end({ timeout: 5 })` path and propagates a fixed error; do not expose SQL/provider exception payloads. Keep the probe READ ONLY, driver limits max 1–2 / connect timeout 1–3 seconds / max lifetime 1–300 seconds / prepare false, SQL statement timeout 3000ms, lock timeout 1000ms and transaction timeout 5000ms. A host acquisition timeout aborts opening and disposes any late successful resource through the existing host mechanism. No claim that an uncooperative pending dependency stopped immediately or that secret bytes were securely erased. Tests must await late cleanup before recording zero sessions, and cover abort before open, during probe, and during/after provider initialization. Safe completed acquisition still lives until the existing explicit disposal, not until its opening signal is released.

For full-path native refusal, keep the real factories and safe synthetic manifest/crypto, alter only the test credential login/parent posture, and assert **no HOST_STARTED, no HTX fetch, fixed host failure and closed clients**. A wrong-login direct probe control is separate from full-path privilege-drift controls; the CLI's existing URL-name parser may correctly refuse a mismatched claimed username even earlier.

For ordering counters, a focused unit spy on `SecretsStoreMasterKeyProvider.create` / synthetic getter can prove no provider initialization after a failing probe. It cannot replace the native catalog test. Native positive controls retain actual crypto; adverse native cases need not fake `server_version_num`, driver results, role predicates or the protected service. Environment/master parsing already precedes this seam, so neither unit nor native evidence may claim zero prior raw-master residency.

## 4. Mandatory additional controls and missing evidence

| Control | Required future proof |
|---|---|
| Real version | Captured actual PG17 version from the fixed loopback lane; existing [17,18) assertion preserved. No credit for local16/fake version. |
| Provisioner-compatible positive | Actual safe login succeeds with existing CONNECT/PUBLIC/TEMP posture recorded; protected data privileges remain exactly scoped. |
| Catalog privilege/identity failures | Genuine safe-name role drift, missing/wrong parent, extra SET membership/options, privileged flags, connection limit, ownership and non-database ACL dependencies refuse from the actual resource. |
| Effective PUBLIC control | A test-only PUBLIC grant on a protected forbidden column/relation causes refusal despite no direct login ACL; remove it exactly in `finally`. |
| Database ACL boundary | Existing CONNECT remains accepted; effective CREATE (including PUBLIC) refuses; TEMP is recorded and not misrepresented as denied. No global PUBLIC revocation. |
| Factory/host ownership | Real `runAccountObservationCollector` defaults reach the mandatory probe. Unsafe role refuses before provider creation/readiness/venue fetch; prior collector/reader pools and failed credential pool close. Cancellation/late resource assertions remain correctly bounded. |
| Safe row controls | Preserve existing exact assignment, missing/revoked/foreign scope, column refusal and collector/reader no-ciphertext controls. |
| Result attribution | Exact changed source, complete four-suite serial native results, zero skips, role restoration/session teardown evidence. Old 152/8 synthetic proof remains at c2a and is not a substitute. |

No native or unit acceptance has been executed for this proposal. The concrete PG17 lane and real-factory test already exist in source; whether the new runtime catalog query is accepted by those restricted roles and covers the adverse matrix remains future implementation proof. Root dedupe and independent review still precede admission. D09 and final DEE-176 remain separate.
