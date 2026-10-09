---
integrationIssue: DEE-1230
integrationTitle: "Client structural privilege repair preparation"
branch: dee-1230-client-privilege-repair
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-native-postgres, scoped-lint, typecheck, independent-review]
approvalGates: [plan-approved, isolated-rehearsal, human-security-merge, fresh-production-admission]
state:
  status: in-progress
  currentWorkPackage: WP-PRIVILEGE-PREPARATION
  completedWorkPackages: []
  remainingWorkPackages: [WP-PRIVILEGE-PREPARATION]
  prNumber: 771
  prUrl: "https://github.com/oumaster369/waia/pull/771"
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Persist and review the source SQL representation; whole-Trader readiness and any further production action remain separately gated."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1230 client privilege repair

## Approved bounded scope

Prepare a client-only removal of PostgreSQL TRUNCATE, REFERENCES, TRIGGER and PG17 MAINTAIN. The current operational proposal contains exactly 163 affected Trader relations: 162 `trader_*` relations plus `exchange_credentials`. `trader_org_profiles` is already remediated. The two optional Core relations `audit_logs` and `organization_members` are excluded. The sealed exact name/OID/ACL matrix remains in root's private continuation proof directory; no production OIDs, account data or connection details are embedded in source.

Preserve postgres ownership, every non-client table grant, all column grants, role attributes/memberships, data, RLS flags, policies, triggers and constraints. Only the two direct client principals `anon` and `authenticated` lose the four named privileges, without CASCADE or grant option. This package does not assert a historical leak or complete least privilege for `service_role`.

Root also admitted **preparation and isolated rehearsal** of removing those same four client rights from `postgres` defaults for future tables in `public`. PostgreSQL cannot restrict this default statement to a Trader name prefix: it affects every future public table actually created as postgres. It does not change existing non-target tables. Owner and service-role defaults remain. `supabase_admin` defaults are excluded; no SET ROLE, membership change, managed-role credential or privilege bypass is included. Future tables made by all creators are therefore **not** fully covered.

## Files and contract

- `tests/fixtures/client-privilege-repair-contract.sql`: UNNUMBERED, isolated-rehearsal-only template. Temporary invoker helpers normalize ACLs semantically and capture table OID/name/kind/owner, table/column ACLs, column shape, RLS, policy/trigger/constraint definitions, schema ACL, role/membership graph, public/global table defaults and event-trigger definitions. Input is a reviewed expected-before snapshot and explicit target list; the clean state is derived by removing only client Dxtm entries. Helpers never persist beyond the connection.
- `tests/integration/client-privilege-repair-postgres.test.ts`: root-run synthetic harness for a separately owned PostgreSQL 17 fixture. It exercises real restricted client LOGINs and observer CRUD, privilege operations, exact idempotence, future defaults, drift refusals and rollback after a forced second-target failure.

The template permits only a complete match to the reviewed before state or complete match to its derived clean state. Mixed clean/dirty targets, unexpected grants, owner changes, alternate PUBLIC/column/client-membership paths, global-default changes or unrelated catalog drift refuse. ACCESS SHARE target identity locks are acquired in stable order with finite lock/statement/transaction deadlines. They protect relation identity against DROP/rename without intentionally blocking ordinary readers or DML; the rehearsal checks concurrent owner UPDATE compatibility. A failed check or DDL statement aborts the transaction and rolls back prior target changes. A clean repeat performs no target DDL. Ambiguous acknowledgement near COMMIT requires root's separate reconciliation; no automatic retry or restoration exists.

A post-commit restoration would reopen privileges and requires fresh separate admission. It must never GRANT ALL, replay raw ACLs or automatically restore obsolete captured grants. Default restoration cannot retroactively repair tables created while defaults differed.

## Source-path and canonical compatibility review

On the inspected main `03e95316f4f3c855edafb03afe7c5bec7b782243`, a source scan covered 108 `use client` files in app/components/lib. The only two token matches were Tailwind `truncate` CSS classes in `fhv-operations-dashboard.tsx` and `transaction-table.tsx`; no client SQL DDL path was identified by this scan. This is a scoped source-path review, not a complete transitive dataflow proof.

Server matches include SQLite WAL checkpoint truncation (unrelated to PostgreSQL table rights), metadata privilege probes, and the existing `scripts/postgres-validation/prelude-supabase-baseline.sql` plus `scripts/ops/postgres-migration-catalog-authority-v1.ts`. The latter explicitly treats the four structural rights as a pre-existing bounded platform baseline and accepts their absence, while refusing regrants on already-hardened relations. Neither historical verifier nor prelude is changed/replayed in this preparation. Future migration/fixture integration requires separate review of creating-role paths and any create-time grant hooks; postgres ownership alone does not prove the creator.

ADR-0007's application-mediated access and targeted RLS strategy remains unchanged. RLS is not treated as a substitute for removing TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.

## Acceptance

Root owns the new local TLS-only fixture and all actual database execution. The owned admin connection has no idle expiry so its pg_temp helpers remain on the same session until explicit teardown. The harness refuses CI, a port other than 55843, a database other than `waia_client_privilege_fixture`, non-postgres owner context, missing explicit CA/password, or a server outside PG17. Capture and repair require actual `postgres` NOSUPERUSER+BYPASSRLS. A separately root-provisioned `dee1230_fixture_admin` superuser is used only for synthetic role setup and adversarial event-trigger/owner-drift setup and cleanup, never for capture or repair. The service-role proof performs real BYPASSRLS server CRUD. It never reads DATABASE_URL. The root-owned node_modules link is temporary and must not be committed. No dependencies are installed or changed.

Root command, with the private owner password supplied directly in the process environment and never printed:

```sh
DEE1230_PG17_REHEARSAL=1 DEE1230_PG17_PORT=55843 \
DEE1230_PG17_CA="$DEE1230_ROOT_CA" \
pnpm exec vitest run tests/integration/client-privilege-repair-postgres.test.ts
```

`DEE1230_PG17_PASSWORD` and `DEE1230_PG17_BOOTSTRAP_PASSWORD` must already be set by root; `$DEE1230_ROOT_CA` names the fixture CA file. Synthetic client/observer/service LOGIN passwords are fixture-only literals, distinct from both private owner and bootstrap passwords. Root must provision the bootstrap LOGIN and set the fixture postgres role NOSUPERUSER+BYPASSRLS before running. The harness may reset only its own fixture's public schema and synthetic roles; the production template is not operationally wired.

Required evidence: before privileges genuinely permit the four representative operations inside rolled-back synthetic transactions; afterward both clients fail each operation; owner/server semantic ACLs and observer organization-scoped CRUD remain; current rows/column ACL/RLS/policies/triggers remain; a new postgres public table has no client Dxtm and retains owner/service rights; a forced second-target failure rolls back earlier table revokes while defaults remain unchanged; a separate post-apply transaction failure rolls back table ACLs and already-mutated defaults; exact clean replay succeeds; mixed/unexpected/owner/global/column/RLS drift refuses without further changes.

Only scoped lint and newly-authored-file static/type checks may be run by this preparation agent. Native execution, review acceptance, commit/push/PR and production activation remain root-owned. No full unit suite or unchanged application build is required for this preparation.

Preparation validation on 8 October: scoped ESLint and a strict single-file TypeScript check of the rehearsal harness passed. Native tests had not been executed by the preparation agent; these static results did not qualify SQL behavior or production activation.

Root validation on 8 October: all **22 native PostgreSQL 17 cases passed with zero skips** over verified TLS, with capture and repair performed by the actual non-superuser postgres owner. The first attempt exposed PostgreSQL's rejection of zero-dimensional empty ACL arrays; its failure log was retained. A focused independent review accepted the explicit NULL/empty-array normalization, and the second campaign passed. **That isolated fixture rehearsal did not change production.** Independent source review and the ACL-helper successor review had no open findings within that preparation scope.

## Dated operational follow-up — 9 October 2026

Root reports that the targeted database work was subsequently applied and verified. RLS was enabled on 38 relations, and the four structural client privileges were removed from the 163 Trader relations in scope. Separately, an accepted operation removed those same four direct privileges from `anon` and `authenticated` on `public.audit_logs` and `public.organization_members`, under migration `dee1230_revoke_core2_structural_20261008` (`20261008162200`); those two Core relations were not part of the 163-relation Trader proposal. A separate migration (`20261009105659`) removed only the eight structural `anon`/`authenticated` default grants for future tables created by `postgres` in `public`; it changed no defaults for other creators, global defaults, sequences, functions, or function defaults.

Four pure validators received fixed `search_path` settings in migration `20261009113150`. The historical pre-admission recording failure remains part of the record; the actual SQL guards and postcondition passed. Migration `20261009140350` for one function and migration `20261009151948` for exact JSONB keys have durable pre-admission and postcondition PASS evidence limited to those configurations; they made no function-body, ACL, owner, or dependency changes. The 15:19:58 advisor report recorded zero errors, zero RLS-disabled relations, zero leaked-password findings, 152 search-path warnings, and 39 no-policy informational findings. Existing leaked-password mode remains enabled.

The 22-case native fixture result above remains the historical PASS; it was not rerun for this follow-up. No new numbered migration or Drizzle journal entry was added: the journal remains at 232, and PR759's future `0232` remains reserved/HOLD. Persistence of the source SQL is still pending. The whole Trader remains NOT READY. These security changes performed no trading or Grok activity and left account data and credentials unchanged.

## Operational holds and limits

No new numbered migration, schema edit or Drizzle journal entry was added by the preparation package. Current journal count is 232; PR759 future `0232` remains reserved/HOLD. Any further production action remains separately gated. This fixture is deliberately guarded to the synthetic database and is **not** a production apply wrapper.

The 163-relation proposal requires a fresh full before-state and owner/grantor check before any later operational action. The captured historical catalog lacks fresh policy/trigger bodies. Root's earlier reviewed `extensions.pgrst_ddl_watch` whitelist omitted REVOKE and ALTER DEFAULT PRIVILEGES; that historical body is not proof of the current body. Fresh event-trigger context/body equality and behavior review remain production prerequisites. The catalog comparison does not replace that review or claim to detect arbitrary trigger-driven data side effects without inspecting data. The isolated fixture tests actual seeded-row preservation.

Catalog snapshots do not globally lock every role/default administrator. Any further operational action must separately admit a bounded serialized change window and reconcile its exact before/after state; no backend termination, managed-role bypass, forced lease or broader security repair is authorized here. The dated follow-up above records root's separately executed targeted actions; this preparation package itself did not perform live DB/provider/host/Grok queries or trading operations.
