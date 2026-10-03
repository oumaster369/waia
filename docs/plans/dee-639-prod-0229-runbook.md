---
integrationIssue: DEE-639
integrationTitle: "Production apply packet for Postgres migration 0229 only"
batchMode: single-issue
branch: cursor/dee-639-prod-0229-runbook-0fe8
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [validate-canon, pr-governance, lint, typecheck, build]
approvalGates: [human-review, backup-restore-verified, no-0230, no-live-activation, no-merge-by-agent]
state:
  status: in-review
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: 753
  prUrl: https://github.com/oumaster369/waia/pull/753
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "0229 is applied and verified. The temporary clone was deleted after explicit Human confirmation; 0230 and deployment remain separately deferred."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-639 production runbook — apply 0229 only

Owner decision recorded for this packet: production migration **0229** may be applied to Supabase project `wdsnuvldxyrkqcjxvuxp` only after a backup is taken and a restore is verified on a **different** project. **0230 stays deferred.** The coordinator applies the SQL. This repository change does not connect to production, does not run the migrator against production, and does not deploy.

Canonical tree this packet was written against: `main` `0f6be381a68589d4abd4c8920b5a1fd3f5a02110`. Re-read `origin/main` immediately before the apply. If `db/migrations_postgres/meta/_journal.json` no longer ends at 0229, stop.

## Canonical sequence

Postgres journal `db/migrations_postgres/meta/_journal.json` on that `main` has **230** entries, `idx` 0..229, `when` strictly increasing. The tail is:

| idx | when | tag | file SHA-256 |
|---|---|---|---|
| 228 | 1780000000228 | `0228_trader_discovery_loop_postgres_v1_rls` | `b020a1523ec988be54051c0e98ed3f7a5033c4e1dac79ae7e0073fe055a174c9` |
| 229 | 1780000000229 | `0229_trader_observation_read_only_credential_v1` | `67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70` |

Git blob of the 0229 file at that commit: `981b2076f309706e91b88d9ae7db4728f7e63947`. The file was introduced by `d9c9f051954776cdeb3122950eebc012e7c9aee4` (PR 714) and is unchanged on current `main`. Its header comment still says the migration is unmerged and unapplied. That sentence is frozen. Editing it would change the journal hash.

There is no `0230_*.sql` on `origin/main`. Journal and SQL files match 1:1 (230 and 230). `db/AGENTS.md` says production apply is **targeted SQL** on `waia-prod`. Do not run `pnpm db:migrate:postgres` against production.

The final read-only production admission at `2026-10-03T10:26:36Z` matched the exact repository prefix through 0228 (229 rows; ordered-prefix digest `a60e7e17aa3002e86d016cec6e2be7f41bc8b230daa167214b6572cfe917e398`), with 0229 and 0230 objects absent, zero other `exchange_credentials` locks, and zero non-idle transactions older than one minute. The reviewed wrapper was then applied and verified at `2026-10-03T10:27:33Z`–`10:27:34Z`; production now has the exact 230-row prefix through 0229 (digest `3855287a6dca60522b16a503f894eacbf1a871f3715b13a6294d682cd21affc0`). See `audit-ai-trader-2026-10-03/0229-production-final-admission.json` and `0229-production-result.json`.

## What 0229 contains

0229 is three statements, separated by `--> statement-breakpoint` (a SQL comment, so the file is valid as one script):

1. `CREATE FUNCTION public.exchange_credential_observation_read_only(metadata text, expected_venue text, expected_account text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE`. It returns true only for canonical HTX (`expected_venue` exactly `htx`), a non-blank untrimmed-equal account id, JSON object metadata with `version` 1, `marketType` `"spot"`, matching `exchangeAccountId`, `withdrawForbidden` true, `transferForbidden` true, a string array `warnings`, and a non-empty `scopes` array whose every element is `"read"`. Anything else, including trade scopes, malformed JSON, and a non-spot market, returns false. It reads no table.
2. `ALTER TABLE public.exchange_credentials ADD COLUMN observation_read_only boolean GENERATED ALWAYS AS (public.exchange_credential_observation_read_only(permission_metadata, venue, exchange_account_id)) STORED NOT NULL`. PostgreSQL rewrites the table to store the value for existing rows and takes `ACCESS EXCLUSIVE`. The DEE-1153 catalog sample was 98,304 bytes. That size is stale; the preflight remeasures it.
3. `GRANT SELECT (observation_read_only) ON public.exchange_credentials TO waia_account_observation_credential`.

0229 does **not** add an RLS policy, does **not** `ENABLE` or `FORCE` RLS, does **not** grant `permission_metadata` or ciphertext, does **not** create a LOGIN, and does **not** create `public.trader_scheduled_noncapital_cycle_receipts_v1`. Existing policies `trader_observation_credential_read` and `trader_observation_credential_assignment` from migration 0210 stay as they are. `0007_exchange_credentials_rls.sql` already enables RLS on `exchange_credentials` and does not force it.

## What the migrator would apply from a journal at 0228

`pnpm db:migrate:postgres` is `scripts/ops/postgres-migrate-with-session-lock-budget.ts`. It sets session `lock_timeout=5s` and `statement_timeout=120s`, then calls drizzle-orm `0.41.0` `migrate()` on `db/migrations_postgres`.

Drizzle reads every journal entry. It hashes each SQL file with SHA-256 of the raw file text. It reads **only** `max` by `ORDER BY created_at DESC LIMIT 1` from `drizzle.__drizzle_migrations`. Inside **one** transaction it runs every journal entry whose `when` is **greater** than that single timestamp, and inserts `(hash, created_at)` after each file. It has no `--only`, `--to`, or `--step` flag. The H2 and post-H2 one-step operators stop at 0215 and refuse 0229.

On **this** `main`, the only `when` greater than `1780000000228` is `1780000000229`. If the live high-water mark is exactly `1780000000228`, that migrator applies **0229 alone**.

It applies **0230 in the same transaction** if the checkout's journal contains `0230_trader_observation_inventory_v1` (`when` `1780000000230`). That file is not on `origin/main`. It exists on the unmerged DEE-1032 tree `52c16604de547706a42d1af99eb2a2104dea9bcc` (`refs/codex-handoff/dee-1032` in the 2026-10-02 handoff bundle). Do not migrate from that tree, from a later descendant, or from a dirty worktree.

Supported way to stop at 0229, without editing the journal:

1. Preferred for this window, and the path `db/AGENTS.md` allows on `waia-prod`: execute the single transaction in [Apply](#apply). It contains the 0229 file and one journal insert. It does not contain 0230.
2. The ordinary migrator stops at 0229 only when **both** are true: the process cwd is a clean checkout of a commit whose journal tail is exactly 0229 (current `main` `0f6be381a68589d4abd4c8920b5a1fd3f5a02110` qualifies; any child that adds 0230 does not), and the preflight shows the live high-water `created_at` is exactly `1780000000228`. Do not point that command at production for this window. The coordinator apply path is the SQL transaction.

There is no supported flag that means "apply 0229 and skip a later journal entry". Hiding 0230 by deleting a journal row, renaming the file, or changing `when` is forbidden.

## Missing canonical migration for scheduled receipts

`public.trader_scheduled_noncapital_cycle_receipts_v1` is **not** created by 0229 or by any other file under `db/migrations_postgres/`. Runtime `lib/trader/paper/scheduled-noncapital-owner-postgres-v1.ts` selects and inserts that table. The only DDL is `docs/plans/dee-1205-scheduled-noncapital-owner.sql`, which is a synthetic proof fixture. It has no journal entry, no `statement-breakpoint` contract, and no production grants review. Do not execute it on `wdsnuvldxyrkqcjxvuxp`.

The missing artifact is a new hand-authored Postgres migration plus a matching `meta/_journal.json` entry and `db/schema.postgres.ts` update, proved on a fresh synthetic database. On current `main` the next free number is 0230, but 0230 is already the deferred DEE-1032 inventory migration (`waia_account_inventory`, `waia_account_inventory_owner`, `public.trader_observation_inventory_v1()`, policies `trader_inventory_state` and `trader_inventory_credential`). Do not reuse 0230 for the receipts table, do not skip 0229, and do not insert the fixture by editing the journal. The receipts migration waits until 0230 is either merged in order (receipts then become 0231) or formally abandoned and replaced by a reviewed receipts migration. This pull request does not add that migration.

## Preflight

Run this on `wdsnuvldxyrkqcjxvuxp` immediately before apply. It is read-only. The ordered-prefix digest compares every stored `(created_at, hash)` pair to the exact repository prefix through 0228, rather than relying on count and tail alone. Do not select credential rows, `permission_metadata`, `encrypted_payload`, query text, or role passwords.

Stop if any expected value differs. Do not repair the journal or role topology. The wrapper independently takes bounded table locks and repeats the exact journal guard inside its transaction; preflight cannot close the interval between this read-only snapshot and apply.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog, public;

SELECT current_database() AS database_name,
       current_setting('server_version_num') AS server_version_num;

SELECT count(*)::bigint AS journal_rows,
       count(DISTINCT created_at)::bigint AS distinct_created_at,
       min(created_at)::text AS min_created_at,
       max(created_at)::text AS max_created_at,
       encode(pg_catalog.sha256(pg_catalog.convert_to(
         pg_catalog.string_agg(created_at::text || ':' || hash, E'\n' ORDER BY created_at, hash),
         'UTF8')),'hex') AS ordered_prefix_sha256
FROM drizzle.__drizzle_migrations;

SELECT created_at::text, hash
FROM drizzle.__drizzle_migrations
WHERE created_at IN (1780000000228, 1780000000229)
ORDER BY created_at;

SELECT to_regclass('public.exchange_credentials') AS exchange_credentials,
       to_regprocedure('public.exchange_credential_observation_read_only(text,text,text)') AS gate_function,
       to_regclass('public.trader_scheduled_noncapital_cycle_receipts_v1') AS scheduled_receipt_table,
       to_regclass('public.trader_research_development_stage_receipts_v1') AS development_receipts_table,
       to_regprocedure('public.trader_observation_inventory_v1()') AS inventory_function_0230;

SELECT c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       pg_total_relation_size(c.oid) AS table_and_indexes_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'exchange_credentials';

SELECT a.attname, a.attgenerated, a.attnotnull
FROM pg_attribute a
WHERE a.attrelid = 'public.exchange_credentials'::regclass
  AND a.attname = 'observation_read_only'
  AND NOT a.attisdropped;

SELECT pol.polname
FROM pg_policy pol
WHERE pol.polrelid IN (
  'public.exchange_credentials'::regclass,
  'public.trader_account_collection_state'::regclass
)
AND pol.polname IN ('trader_inventory_state', 'trader_inventory_credential')
ORDER BY pol.polname;

SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolinherit, r.rolbypassrls,
       r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolconnlimit
FROM pg_roles r
WHERE r.rolname IN (
  'waia_account_observer', 'waia_account_observer_login',
  'waia_account_observation_reader', 'waia_account_observation_reader_login',
  'waia_account_observation_credential', 'waia_account_observation_credential_login',
  'waia_account_inventory', 'waia_account_inventory_owner'
)
ORDER BY r.rolname;

SELECT member.rolname AS member_role,
       parent.rolname AS parent_role,
       m.admin_option, m.inherit_option, m.set_option
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
WHERE member.rolname IN (
    'waia_account_observer', 'waia_account_observer_login',
    'waia_account_observation_reader', 'waia_account_observation_reader_login',
    'waia_account_observation_credential', 'waia_account_observation_credential_login',
    'waia_account_inventory', 'waia_account_inventory_owner'
  )
  OR parent.rolname IN (
    'waia_account_observer', 'waia_account_observer_login',
    'waia_account_observation_reader', 'waia_account_observation_reader_login',
    'waia_account_observation_credential', 'waia_account_observation_credential_login',
    'waia_account_inventory', 'waia_account_inventory_owner'
  )
ORDER BY member.rolname, parent.rolname;

SELECT has_column_privilege(
         'waia_account_observation_credential',
         'public.exchange_credentials',
         'permission_metadata', 'SELECT') AS credential_role_can_select_metadata,
       has_column_privilege(
         'waia_account_observation_credential',
         'public.exchange_credentials',
         'encrypted_payload', 'SELECT') AS credential_role_can_select_payload;

SELECT count(*)::bigint AS credential_relation_locks
FROM pg_locks
WHERE relation = 'public.exchange_credentials'::regclass;

SELECT count(*)::bigint AS nonidle_transactions_older_than_1_minute
FROM pg_stat_activity
WHERE state IS DISTINCT FROM 'idle'
  AND xact_start IS NOT NULL
  AND xact_start < clock_timestamp() - interval '1 minute';

ROLLBACK;
```

Expected before apply:

- Journal has `229` rows and distinct timestamps; min `1777989873065`, max `1780000000228`, ordered-prefix digest `a60e7e17aa3002e86d016cec6e2be7f41bc8b230daa167214b6572cfe917e398`. There is exactly one tail row `1780000000228` / `b020a1523ec988be54051c0e98ed3f7a5033c4e1dac79ae7e0073fe055a174c9` and no 0229 row.
- `exchange_credentials` is non-null; the 0229 function and generated column are absent. The scheduled receipts, development-stage receipts and 0230 inventory function are absent. RLS is enabled and not forced. No inventory policies or inventory roles exist.
- The six observation roles are present. All three `*_login` roles have `rolcanlogin=true`, `rolinherit=false`, no superuser/bypass/create-db/create-role/replication privileges, and connection limit `2`. The `waia_account_observer` parent is `NOLOGIN` with `rolinherit=true` (migration 0205 relies on PostgreSQL's default); the reader and credential parents are `NOLOGIN` with `rolinherit=false` (0205/0210 explicitly set `NOINHERIT`). All parents have the other privileged flags false.
- Membership edges are exactly: each login role → its own parent with `admin_option=false`, `inherit_option=false`, `set_option=true`; and `postgres` → each of the three parent roles with `admin_option=true`, `inherit_option=false`, `set_option=false`. No other edge may involve the six observation roles or the inventory roles. These postgres edges are present in the verified production and restore-clone catalogs.
- `credential_role_can_select_metadata=false`; payload access may be true under the existing 0210 grant.
- `credential_relation_locks=0` and `nonidle_transactions_older_than_1_minute=0`. A nonzero other credential-table lock means stop, inspect owner/mode/age, and recheck; the wrapper's 5-second `ACCESS EXCLUSIVE` timeout remains the final bounded lock guard.

Do not call `has_column_privilege` for the absent `observation_read_only` column during preflight: PostgreSQL raises an error for an unknown column name; it does not return `NULL`. Verify that grant after apply.

## Backup and restore verification

The required separate-project restore has been completed. It was restored from backup `2026-10-03T03:35:49Z` of source project `wdsnuvldxyrkqcjxvuxp` into distinct project `zijfrbnzelqyfukmvfql`. The restore started at `2026-10-03T10:09:12Z`; when the verification evidence was captured, the dashboard showed `COMPLETED` and the restore project API reported `ACTIVE_HEALTHY`. The restore operation did not replace or modify the source database; the separately authorized migration followed after verification.

The read-only clone proof at `2026-10-03T10:14:04Z` confirmed PostgreSQL 17 on both sides (source `170006`, clone `170011`), zero outward-calling/scheduling extensions and zero foreign servers on the clone. The canonical comparisons for journal, objects, observation column, roles, memberships, credential privileges, public relations/columns, invalid public indexes, inventory policies, extensions, and foreign servers all matched. The clone journal remained at 229 rows, max `1780000000228`, with exact ordered-prefix digest `a60e7e17aa3002e86d016cec6e2be7f41bc8b230daa167214b6572cfe917e398`.

Aggregate counts were production 3 trader organization profiles, 3 collection states, and 19,631 observations, versus clone 3, 3, and 19,184. They were observed at different times and are a restore sanity check, not an exact business-data checksum. No credential values were read. No worker was connected to the clone. Evidence is recorded in `audit-ai-trader-2026-10-03/0229-restore-verification.json`.

The clone rehearsal passed before production apply: it reached the expected exact 0228 prefix, applied the reviewed wrapper, and verified the exact 0229 prefix, generated column, immutable function, SELECT grant, unchanged roles, and all 16 pure-function cases. Production then passed the fresh lock-free admission and the same apply verification. Evidence is in `audit-ai-trader-2026-10-03/0229-clone-rehearsal-result.json`, `0229-production-final-admission.json`, and `0229-production-result.json`.

Supabase documents two different restore actions ([Database Backups](https://supabase.com/docs/guides/platform/backups), [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)):

- **In-place restore** and **in-place PITR** replace the production database and take the source offline. They are disaster tools, not the verification drill.
- **Restore to a New Project** creates a separate project from a physical backup, or from a PITR timestamp when enabled. The source stays up. Do not restore onto `wdsnuvldxyrkqcjxvuxp` as proof.

The temporary restore project was deleted after explicit Human confirmation on 2026-10-03. A prior pause attempt had been refused for this paid project. The Dashboard returned to the project list with the clone absent and waia-prod present; the source API remained ACTIVE_HEALTHY. Evidence: restore-clone-deleted.jpg. Never delete source project `wdsnuvldxyrkqcjxvuxp`.

## Apply

**Completed 2026-10-03:** the reviewed wrapper was applied to production after the successful clone rehearsal and fresh lock-free admission. The production result reports success at `2026-10-03T10:27:33.484504Z`; post-apply verification passed at `10:27:34.589414Z`. The journal contains 230 rows through 0229 with exact digest `3855287a6dca60522b16a503f894eacbf1a871f3715b13a6294d682cd21affc0`, the stored generated column and immutable non-security-definer function are present, the new gate is selectable by the credential role (existing ciphertext permissions are unchanged; metadata remains denied), roles/memberships are unchanged, and all 16 pure-function cases passed. The scheduled/development receipt tables and 0230 inventory function remain absent.

The canonical migration source retains its historical header comment saying it is unmerged/unapplied. Those source bytes are unchanged to preserve the journal hash; the comment no longer describes current production state.

The SQL below is the exact executed packet retained for audit; **do not rerun it**. It is one transaction and embeds the exact 0229 migration bytes (canonical SHA-256 `67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70`). Wrapper SHA-256: `200affcc0422ae5c32c74bb21dda6697c37c44fb3d1c37fa4f2257f91b81453b`. It acquires the credential table's `ACCESS EXCLUSIVE` lock first with a 5-second timeout, then serializes journal writers with `SHARE ROW EXCLUSIVE`; this matches the normal DDL-then-journal insertion order and avoids lock-order deadlock. Under both locks it verifies the full 229-entry ordered journal-prefix digest before any migration DDL. It then applies only canonical 0229, inserts its journal row, and checks the 230-entry prefix plus generated column, function and privileges before commit. A mismatch raises an exception and rolls the whole transaction back.

Use the Supabase SQL surface that commits this whole script as **one** transaction. Do not paste it into a mode that auto-commits each statement. Do not use the transaction pooler (port 6543 or 6432) for this DDL. Do not set either timeout to `0`. If a lock or statement timeout fires, inspect and do not start a second attempt until the first session is gone.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;
-- Match the normal DDL-before-journal lock order to avoid a lock-order inversion.
LOCK TABLE public.exchange_credentials IN ACCESS EXCLUSIVE MODE;
-- Serialize journal writers; no other migration may pass between check and commit.
LOCK TABLE drizzle.__drizzle_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
DECLARE n bigint; tail bigint; digest text;
BEGIN
  SELECT count(*),max(created_at),encode(sha256(convert_to(
    string_agg(created_at::text||':'||hash,E'\n' ORDER BY created_at,hash),'UTF8')),'hex')
    INTO n,tail,digest FROM drizzle.__drizzle_migrations;
  IF n <> 229 OR tail IS DISTINCT FROM 1780000000228
    OR digest IS DISTINCT FROM 'a60e7e17aa3002e86d016cec6e2be7f41bc8b230daa167214b6572cfe917e398' THEN
    RAISE EXCEPTION '0229_EXACT_JOURNAL_PREFIX_MISMATCH';
  END IF;
  IF to_regprocedure('public.exchange_credential_observation_read_only(text,text,text)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.exchange_credentials'::regclass
      AND attname='observation_read_only' AND NOT attisdropped) THEN
    RAISE EXCEPTION '0229_ALREADY_OR_PARTIALLY_PRESENT';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.exchange_credentials'::regclass)
    OR has_column_privilege('waia_account_observation_credential','public.exchange_credentials','permission_metadata','SELECT') THEN
    RAISE EXCEPTION '0229_CREDENTIAL_BOUNDARY_MISMATCH';
  END IF;
  IF to_regclass('public.trader_scheduled_noncapital_cycle_receipts_v1') IS NOT NULL
    OR to_regclass('public.trader_research_development_stage_receipts_v1') IS NOT NULL
    OR to_regprocedure('public.trader_observation_inventory_v1()') IS NOT NULL THEN
    RAISE EXCEPTION '0229_UNEXPECTED_SCHEMA_ADVANCEMENT';
  END IF;
END $guard$;

-- CANONICAL FILE BEGIN
-- DEE-1151: decrypt only exact-account canonical HTX spot read-only policy.
-- Mirrors the stored read-purpose contract in htx-credential-types.ts, then
-- additionally excludes trade scopes. Metadata remains withheld from the role.
-- This new migration is unmerged/unapplied to production. Do not edit0000-0228.
--> statement-breakpoint
CREATE FUNCTION public.exchange_credential_observation_read_only(
  metadata text, expected_venue text, expected_account text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  policy jsonb;
  scopes jsonb;
  -- ECMAScript String.trim whitespace, matching the canonical stored policy.
  trim_chars CONSTANT text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13)
    || ' ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF expected_venue IS DISTINCT FROM 'htx' OR expected_account IS NULL
    OR btrim(expected_account, trim_chars) = ''
    OR expected_account <> btrim(expected_account, trim_chars)
    OR metadata IS NULL OR btrim(metadata) = '' THEN
    RETURN false;
  END IF;
  BEGIN
    policy := metadata::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object'
    OR policy->'version' IS DISTINCT FROM '1'::jsonb
    OR policy->'marketType' IS DISTINCT FROM '"spot"'::jsonb
    OR policy->'exchangeAccountId' IS DISTINCT FROM to_jsonb(expected_account)
    OR policy->'withdrawForbidden' IS DISTINCT FROM 'true'::jsonb
    OR policy->'transferForbidden' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(policy->'warnings') IS DISTINCT FROM 'array'
    OR (policy ? 'accountLabel' AND jsonb_typeof(policy->'accountLabel') IS DISTINCT FROM 'string') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(policy->'warnings') AS warning
    WHERE jsonb_typeof(warning) IS DISTINCT FROM 'string') THEN
    RETURN false;
  END IF;
  scopes := policy->'scopes';
  IF jsonb_typeof(scopes) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(scopes) AS scope
    WHERE scope IS DISTINCT FROM '"read"'::jsonb) THEN
    RETURN false;
  END IF;
  RETURN jsonb_array_length(scopes) > 0;
END;
$$;
--> statement-breakpoint
ALTER TABLE public.exchange_credentials
  ADD COLUMN observation_read_only boolean
  GENERATED ALWAYS AS (
    public.exchange_credential_observation_read_only(permission_metadata, venue, exchange_account_id)
  ) STORED NOT NULL;
--> statement-breakpoint
GRANT SELECT (observation_read_only)
  ON public.exchange_credentials TO waia_account_observation_credential;
-- CANONICAL FILE END

INSERT INTO drizzle.__drizzle_migrations (hash,created_at)
VALUES ('67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70',1780000000229);
DO $guard$
DECLARE n bigint; tail bigint; digest text;
BEGIN
  SELECT count(*),max(created_at),encode(sha256(convert_to(
    string_agg(created_at::text||':'||hash,E'\n' ORDER BY created_at,hash),'UTF8')),'hex')
    INTO n,tail,digest FROM drizzle.__drizzle_migrations;
  IF n <> 230 OR tail IS DISTINCT FROM 1780000000229
    OR digest IS DISTINCT FROM '3855287a6dca60522b16a503f894eacbf1a871f3715b13a6294d682cd21affc0' THEN
    RAISE EXCEPTION '0229_EXACT_JOURNAL_PREFIX_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid='public.exchange_credentials'::regclass AND attname='observation_read_only'
      AND NOT attisdropped AND attgenerated='s' AND attnotnull) THEN
    RAISE EXCEPTION '0229_GENERATED_COLUMN_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc
    WHERE oid='public.exchange_credential_observation_read_only(text,text,text)'::regprocedure
      AND provolatile='i' AND NOT prosecdef) THEN
    RAISE EXCEPTION '0229_FUNCTION_MISMATCH';
  END IF;
  IF NOT has_column_privilege('waia_account_observation_credential','public.exchange_credentials','observation_read_only','SELECT')
    OR has_column_privilege('waia_account_observation_credential','public.exchange_credentials','permission_metadata','SELECT') THEN
    RAISE EXCEPTION '0229_COLUMN_PRIVILEGE_MISMATCH';
  END IF;
END $guard$;
COMMIT;
```


## Post-apply verification

Run in a new read-only transaction. Do not read credential values. Expected ordered-prefix digest is `3855287a6dca60522b16a503f894eacbf1a871f3715b13a6294d682cd21affc0`.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog, public;

SELECT count(*)::bigint AS journal_rows,
       max(created_at)::text AS max_created_at,
       encode(pg_catalog.sha256(pg_catalog.convert_to(
         pg_catalog.string_agg(created_at::text || ':' || hash, E'\n' ORDER BY created_at, hash),
         'UTF8')),'hex') AS ordered_prefix_sha256
FROM drizzle.__drizzle_migrations;

SELECT created_at::text, hash
FROM drizzle.__drizzle_migrations
WHERE created_at = 1780000000229;

SELECT a.attgenerated, a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS generation_expression
FROM pg_catalog.pg_attribute a
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.exchange_credentials'::regclass
  AND a.attname = 'observation_read_only'
  AND NOT a.attisdropped;

SELECT p.proname, p.provolatile, p.prosecdef,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'exchange_credential_observation_read_only';

SELECT has_column_privilege('waia_account_observation_credential',
         'public.exchange_credentials', 'observation_read_only', 'SELECT') AS credential_role_can_select_gate,
       has_column_privilege('waia_account_observation_credential',
         'public.exchange_credentials', 'permission_metadata', 'SELECT') AS credential_role_can_select_metadata;

SELECT to_regclass('public.trader_scheduled_noncapital_cycle_receipts_v1') AS scheduled_receipt_table,
       to_regclass('public.trader_research_development_stage_receipts_v1') AS development_receipts_table,
       to_regprocedure('public.trader_observation_inventory_v1()') AS inventory_function_0230;

SELECT r.rolname
FROM pg_catalog.pg_roles r
WHERE r.rolname IN ('waia_account_inventory', 'waia_account_inventory_owner');

ROLLBACK;
```

Expected: 230 journal rows, max `1780000000229`, exact ordered-prefix digest above; one 0229 row with the canonical file hash; stored generated non-null column; one immutable non-security-definer function; gate SELECT true while metadata SELECT remains false. Receipt tables, 0230 inventory function and inventory roles remain absent.

## Rollback

Rollback is an operator-only contingency, not a routine follow-up. Do not run it if any deployed process may use the column. Stop/rollback consumers first and confirm no later schema migration has been applied. The wrapper locks `exchange_credentials` then the journal using the same bounded order as apply. It requires the exact 230-row 0229 prefix before any drop, and verifies the exact 229-row 0228 prefix after deletion. All actions are one transaction; any guard failure leaves the applied schema and journal intact.

Rollback wrapper SHA-256: `dfe7aebff1e5f1348dba5320b53f90dc070e932fca12330340142e31e895ee09`.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;
-- Match the normal DDL-before-journal lock order to avoid a lock-order inversion.
LOCK TABLE public.exchange_credentials IN ACCESS EXCLUSIVE MODE;
-- Serialize journal writers; no other migration may pass between check and commit.
LOCK TABLE drizzle.__drizzle_migrations IN SHARE ROW EXCLUSIVE MODE;
-- Operator-only rollback: first prove no current consumer uses the new column.
-- Never use this after subsequent migrations or without a fresh schema/usage check.
DO $guard$
DECLARE n bigint; tail bigint; digest text;
BEGIN
  SELECT count(*),max(created_at),encode(sha256(convert_to(
    string_agg(created_at::text||':'||hash,E'\n' ORDER BY created_at,hash),'UTF8')),'hex')
    INTO n,tail,digest FROM drizzle.__drizzle_migrations;
  IF n <> 230 OR tail IS DISTINCT FROM 1780000000229
    OR digest IS DISTINCT FROM '3855287a6dca60522b16a503f894eacbf1a871f3715b13a6294d682cd21affc0' THEN
    RAISE EXCEPTION '0229_EXACT_JOURNAL_PREFIX_MISMATCH';
  END IF;
END $guard$;
ALTER TABLE public.exchange_credentials DROP COLUMN observation_read_only;
DROP FUNCTION public.exchange_credential_observation_read_only(text,text,text);
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at=1780000000229 AND hash='67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70';
DO $guard$
DECLARE n bigint; tail bigint; digest text;
BEGIN
  SELECT count(*),max(created_at),encode(sha256(convert_to(
    string_agg(created_at::text||':'||hash,E'\n' ORDER BY created_at,hash),'UTF8')),'hex')
    INTO n,tail,digest FROM drizzle.__drizzle_migrations;
  IF n <> 229 OR tail IS DISTINCT FROM 1780000000228
    OR digest IS DISTINCT FROM 'a60e7e17aa3002e86d016cec6e2be7f41bc8b230daa167214b6572cfe917e398' THEN
    RAISE EXCEPTION '0229_EXACT_JOURNAL_PREFIX_MISMATCH';
  END IF;
  IF to_regprocedure('public.exchange_credential_observation_read_only(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '0229_ROLLBACK_FUNCTION_PRESENT';
  END IF;
END $guard$;
COMMIT;
```

After a successful rollback, the preflight expectations hold again: exact 229-row ordered prefix digest `a60e7e17aa3002e86d016cec6e2be7f41bc8b230daa167214b6572cfe917e398`, high-water `1780000000228`, and gate column/function absent.

## Release and flags after the schema

Applying 0229 does **not** authorize a Cloudflare deploy.

Last observed production web release in the handoff, not re-read here: SHA `31c78cba11d5ddf6cc6637b473a875574ebce00d`, version `2f679217-20de-4e3b-9905-bef8507c4948`, deployment `2b0ba0d5-cef2-4d8b-80a1-e915ecb9d990`. That SHA is an ancestor of current `main` and already contains the PR 714 credential reader. Confirm the live deployment SHA in Cloudflare before relying on it.

Do **not** deploy current `main` `0f6be381a68589d4abd4c8920b5a1fd3f5a02110` as the follow-on of this migration. That commit's Worker cron calls `runScheduledNoncapitalPaperLoopFromEnv`. Checked-in `wrangler.jsonc` sets `PAPER_LOOP_ENABLED` to `1`, with `PAPER_LOOP_ORGANIZATION_ID` and `PAPER_LOOP_ACCOUNT_KEY` non-empty. `loadPaperLoopConfig` treats `1`, `true`, and `yes` as enabled. The scheduled owner then polls public HTX market data and writes `trader_scheduled_noncapital_cycle_receipts_v1`, which this migration does not create. An unchanged-config deploy fails that insert on every cron tick after a public GET, or commits noncapital cycles if the receipts table is added later without a separate decision.

Safe flag posture for any later, separately authorized deploy of `0f6be381a68589d4abd4c8920b5a1fd3f5a02110`:

- Effective `PAPER_LOOP_ENABLED` is `0` or unset. Not `1`, `true`, or `yes`.
- `WAIA_TRADER_LIVE_ENABLED` and `WAIA_LIVE_TRADING_ENABLED` stay unset. Do not run `pnpm trader:live:enable` or `trader:live:confirm`.
- `WAIA_BLIND_HOLDOUT_ENABLED` stays unset.
- Do not change `MARKET_BRAIN_ENABLED`, `WATCHER_ENABLED`, or `WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED` in this window. Checked-in values are `1`. This packet does not retune them and does not treat them as a substitute for the paper-loop gate.
- Do not start `ai-trader-account-observation-host` in `account-observation-recurring`. Idle mode is a separate host decision and is not part of this SQL.
- Do not print Worker secrets while confirming flag names.

`0f6be381` is the canonical source SHA for this packet. It is not a deployment authorization. The receipts migration is absent; a separate human release decision is required before deploying this or any later code.

## Scheduled owner after the schema appears

0229 does not unblock the scheduled noncapital owner. That owner never reads `observation_read_only`. Its first database statement against the receipts table fails while the table is absent, and that statement is inside the transaction, before `runHeldNoTradeCycle` and before the receipt insert. Order submission is hard-refused (`SCHEDULED_PAPER_SUBMISSION_FORBIDDEN`) even when the table exists. The effect that **does** start once the column exists, without a new deploy, is the credential reader already in `31c78cba`: `createObservationCredentialReader` in the observation host and `createProtectedHtxAccountAcquisitionSessionV1`. While the column was missing, that projection failed closed. After 0229, a canonical HTX spot read-only credential stores `true`, and `waia_account_observation_credential` may select that boolean plus the ciphertext columns it already had. A running collector or acquisition session can then decrypt and issue read-only HTX GETs. The 2026-10-01 host check found no container named `waia-account-observation`; that does not prove another supervisor is absent. Do not start one in this window.

If the receipts table is created later while effective `PAPER_LOOP_ENABLED` is on, the owner will commit noncapital cycles: risk-limit `getOrCreate`, mock startup reconciliation, a paper cycle, and an append-only receipt. That is durable database effect. It is still not a live order. It is outside this 0229 authorization.

## Blockers and unknowns

- Migration 0229 is applied and verified in production. The restore verification and clone rehearsal also passed. The temporary restore project `zijfrbnzelqyfukmvfql` was deleted with explicit Human confirmation after evidence was saved.
- Effective Cloudflare `PAPER_LOOP_ENABLED` and the live-flag names were not re-read. Checked-in source and an older deployment snapshot both show paper loop enabled. That is unsafe for a deploy of current `main`, not a reason to skip 0229's own preflight.
- The scheduled receipts table has no canonical migration. 0230 remains deferred and must not ride along.
- DEE-1201 (paper executor lease) was merged in PR752 and is outside this schema-only packet.

## Acceptance

- The production journal now contains exactly the canonical 0229 file hash at `1780000000229`; apply and post-apply guards passed, and the separate clone rehearsal passed.
- 0230 objects stay absent.
- No production write, deploy, live flag, or order is performed by the change that adds this document.
