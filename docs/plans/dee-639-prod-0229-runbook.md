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
  nextAction: "Human reviews this packet, verifies a restore into a separate project, then applies 0229 through the Supabase connector. This document does not apply it."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-639 production runbook — apply 0229 only

Owner decision recorded for this packet: production migration **0229** may be applied to Supabase project `wdsnuvldxyrkqcjxvuxp` only after a backup is taken and a restore is verified on a **different** project. **0230 stays deferred.** The coordinator applies the SQL. This repository change does not connect to production, does not run the migrator against production, and does not deploy.

Canonical tree this packet was written against: `main` `520672258014ca4600b2343eef530a65dc38d769`. Re-read `origin/main` before the window. If `db/migrations_postgres/meta/_journal.json` no longer ends at 0229, stop.

## Canonical sequence

Postgres journal `db/migrations_postgres/meta/_journal.json` on that `main` has **230** entries, `idx` 0..229, `when` strictly increasing. The tail is:

| idx | when | tag | file SHA-256 |
|---|---|---|---|
| 228 | 1780000000228 | `0228_trader_discovery_loop_postgres_v1_rls` | `b020a1523ec988be54051c0e98ed3f7a5033c4e1dac79ae7e0073fe055a174c9` |
| 229 | 1780000000229 | `0229_trader_observation_read_only_credential_v1` | `67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70` |

Git blob of the 0229 file at that commit: `981b2076f309706e91b88d9ae7db4728f7e63947`. The file was introduced by `d9c9f051954776cdeb3122950eebc012e7c9aee4` (PR 714) and is unchanged on current `main`. Its header comment still says the migration is unmerged and unapplied. That sentence is frozen. Editing it would change the journal hash.

There is no `0230_*.sql` on `origin/main`. Journal and SQL files match 1:1 (230 and 230). `db/AGENTS.md` says production apply is **targeted SQL** on `waia-prod`. Do not run `pnpm db:migrate:postgres` against production.

The last read-only production comparison in the DEE-1153 packet (2026-10-01) found the live journal equal to the repository prefix through 0228: 229 rows, next repository entry 0229 with the hash above. A later catalog read (2026-10-02 14:47:52 UTC) found `public.trader_scheduled_noncapital_cycle_receipts_v1` absent. Those are historical facts. Repeat the preflight in the window. This packet did not query production.

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
2. The ordinary migrator stops at 0229 only when **both** are true: the process cwd is a clean checkout of a commit whose journal tail is exactly 0229 (current `main` `520672258014ca4600b2343eef530a65dc38d769` qualifies; any child that adds 0230 does not), and the preflight shows the live high-water `created_at` is exactly `1780000000228`. Do not point that command at production for this window. The coordinator apply path is the SQL transaction.

There is no supported flag that means "apply 0229 and skip a later journal entry". Hiding 0230 by deleting a journal row, renaming the file, or changing `when` is forbidden.

## Missing canonical migration for scheduled receipts

`public.trader_scheduled_noncapital_cycle_receipts_v1` is **not** created by 0229 or by any other file under `db/migrations_postgres/`. Runtime `lib/trader/paper/scheduled-noncapital-owner-postgres-v1.ts` selects and inserts that table. The only DDL is `docs/plans/dee-1205-scheduled-noncapital-owner.sql`, which is a synthetic proof fixture. It has no journal entry, no `statement-breakpoint` contract, and no production grants review. Do not execute it on `wdsnuvldxyrkqcjxvuxp`.

The missing artifact is a new hand-authored Postgres migration plus a matching `meta/_journal.json` entry and `db/schema.postgres.ts` update, proved on a fresh synthetic database. On current `main` the next free number is 0230, but 0230 is already the deferred DEE-1032 inventory migration (`waia_account_inventory`, `waia_account_inventory_owner`, `public.trader_observation_inventory_v1()`, policies `trader_inventory_state` and `trader_inventory_credential`). Do not reuse 0230 for the receipts table, do not skip 0229, and do not insert the fixture by editing the journal. The receipts migration waits until 0230 is either merged in order (receipts then become 0231) or formally abandoned and replaced by a reviewed receipts migration. This pull request does not add that migration.

## Preflight

Run this on `wdsnuvldxyrkqcjxvuxp` immediately before the backup clone and again immediately before apply. Read-only. One transaction, then rollback. Do not select credential rows, `permission_metadata`, `encrypted_payload`, query text, or role passwords.

Stop if any expected value differs, including a journal count other than 229. Do not "repair" the journal.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

SELECT current_database() AS database_name,
       current_setting('server_version_num') AS server_version_num;

SELECT count(*)::bigint AS journal_rows,
       count(DISTINCT created_at)::bigint AS distinct_created_at,
       min(created_at)::text AS min_created_at,
       max(created_at)::text AS max_created_at
FROM drizzle.__drizzle_migrations;

SELECT created_at::text, hash
FROM drizzle.__drizzle_migrations
WHERE created_at IN (1780000000228, 1780000000229)
ORDER BY created_at;

SELECT to_regclass('public.exchange_credentials') AS exchange_credentials,
       to_regprocedure('public.exchange_credential_observation_read_only(text,text,text)') AS gate_function,
       to_regclass('public.trader_scheduled_noncapital_cycle_receipts_v1') AS scheduled_receipt_table,
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
  'waia_account_observer',
  'waia_account_observer_login',
  'waia_account_observation_reader',
  'waia_account_observation_reader_login',
  'waia_account_observation_credential',
  'waia_account_observation_credential_login',
  'waia_account_inventory',
  'waia_account_inventory_owner'
)
ORDER BY r.rolname;

SELECT member.rolname AS member_role,
       parent.rolname AS parent_role,
       m.admin_option,
       m.inherit_option,
       m.set_option
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
WHERE member.rolname IN (
    'waia_account_observer_login',
    'waia_account_observation_reader_login',
    'waia_account_observation_credential_login'
  )
  OR parent.rolname IN (
    'waia_account_observer',
    'waia_account_observation_reader',
    'waia_account_observation_credential',
    'waia_account_inventory',
    'waia_account_inventory_owner'
  )
ORDER BY member.rolname, parent.rolname;

SELECT has_column_privilege(
         'waia_account_observation_credential',
         'public.exchange_credentials',
         'permission_metadata',
         'SELECT') AS credential_role_can_select_metadata,
       has_column_privilege(
         'waia_account_observation_credential',
         'public.exchange_credentials',
         'encrypted_payload',
         'SELECT') AS credential_role_can_select_payload;

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

- `journal_rows = 229`, `distinct_created_at = 229`, `min_created_at = 1777989873065`, `max_created_at = 1780000000228`.
- Exactly one tail row: `1780000000228` / `b020a1523ec988be54051c0e98ed3f7a5033c4e1dac79ae7e0073fe055a174c9`. No row for `1780000000229`.
- `exchange_credentials` is non-null. `gate_function`, `scheduled_receipt_table`, and `inventory_function_0230` are null.
- `rls_enabled` true, `rls_forced` false. `observation_read_only` returns no attribute row.
- No `trader_inventory_*` policies. No `waia_account_inventory` or `waia_account_inventory_owner` role.
- Six observation roles present. The three `*_login` roles: `rolcanlogin` true, not superuser, not inherit, not bypassrls, not createdb, not createrole, not replication, `rolconnlimit = 2`. The three parents: `rolcanlogin` false, same privileged flags false. Each login is a member of only its own parent, with `admin_option` false, `inherit_option` false, `set_option` true. Parents have no outbound membership in this result. This matches the 2026-10-01 catalog; if PostgreSQL 17 column names `inherit_option` / `set_option` are absent, stop rather than rewriting the check.
- `credential_role_can_select_metadata` is false. `credential_role_can_select_payload` may be true; 0210 grants that column on purpose. Do not widen it.
- `credential_relation_locks = 0` and `nonidle_transactions_older_than_1_minute = 0`. A non-zero lock count means wait or stop. Do not raise `lock_timeout` above 5s and do not retry a timed-out apply while the first attempt might still be running.

`has_column_privilege` for `observation_read_only` is omitted here because the column does not exist yet. PostgreSQL returns null for a missing column. Check it after apply.

## Backup and restore verification

Do this before the production transaction. Do not restore **onto** `wdsnuvldxyrkqcjxvuxp` as the proof.

Supabase documents two different restore actions ([Database Backups](https://supabase.com/docs/guides/platform/backups), [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)):

- **In-place restore** and **in-place PITR** replace the production database and take `wdsnuvldxyrkqcjxvuxp` offline. Those are disaster tools. They are not the verification drill.
- **Restore to a new project** (Dashboard → project `wdsnuvldxyrkqcjxvuxp` → Database → Backups → **Restore to a New Project**) creates a separate project from a physical backup, or from a PITR timestamp when PITR is enabled. The source project stays up. Paid plan and physical backups are required. The clone copies schema, data, roles, and auth users. It does not copy Storage objects. Daily backups do not store custom-role passwords, so LOGIN passwords on the clone will not match production. Catalog checks do not need those passwords.

Verification steps:

1. Confirm a backup exists and record its timestamp or PITR target, the new project ref, and the source ref `wdsnuvldxyrkqcjxvuxp`. Record no connection strings, keys, or passwords.
2. Start **Restore to a New Project**. Wait until that new project is healthy. If the control is missing, or the only offered action is an in-place restore, stop. Do not invent a `pg_dump` against production from this packet, and do not use an empty preview branch as a substitute. A Supabase Branching preview is acceptable only when the coordinator can show it was created from this same physical backup and its project ref is not `wdsnuvldxyrkqcjxvuxp`.
3. On the **clone only**, disable extensions that can call outward or schedule work (`pg_cron`, `pg_net`, `wrappers`, and any wrapper foreign servers) before running further SQL. The clone is a full data copy.
4. Run the [Preflight](#preflight) script on the clone. The same expected values must hold, especially journal high-water `1780000000228` and the absent gate column.
5. Optional rehearsal: run the [Apply](#apply) transaction on the **clone only**, then the [Post-apply verification](#post-apply-verification). Do not point Cloudflare, workers, or observation hosts at the clone.
6. Leave production untouched until step 4 succeeds. After the production apply, the clone may be paused or deleted. Deleting the clone does not delete production. Never delete `wdsnuvldxyrkqcjxvuxp`.

Whether this project currently has physical backups or PITR was not re-checked. A 2026-10-01 attempt to open the backup dashboard was refused by the browser policy. Absence of that check is not evidence that backups are missing.

## Apply

One transaction. Statements below the `FILE` markers are the exact bytes of `db/migrations_postgres/0229_trader_observation_read_only_credential_v1.sql`. The journal hash is SHA-256 of those file bytes, not of this wrapper.

Use the Supabase SQL surface that can commit this whole script as **one** transaction (dashboard SQL with an explicit `BEGIN` / `COMMIT`). Do not paste it into a mode that auto-commits each statement. Do not use the transaction pooler (port 6543 or 6432) for this DDL. Do not set either timeout to `0`. If `lock_timeout` or `statement_timeout` fires, the transaction aborts; inspect and do not start a second attempt until the first session is gone.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- FILE BEGIN db/migrations_postgres/0229_trader_observation_read_only_credential_v1.sql
-- sha256 67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70
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
-- FILE END

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES (
  '67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70',
  1780000000229
);

DO $$
DECLARE
  journal_count bigint;
  generated_mark "char";
BEGIN
  SELECT count(*) INTO journal_count
  FROM drizzle.__drizzle_migrations
  WHERE created_at = 1780000000229
    AND hash = '67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70';
  IF journal_count <> 1 THEN
    RAISE EXCEPTION '0229_JOURNAL_CARDINALITY_%', journal_count;
  END IF;

  SELECT a.attgenerated INTO generated_mark
  FROM pg_attribute a
  WHERE a.attrelid = 'public.exchange_credentials'::regclass
    AND a.attname = 'observation_read_only'
    AND NOT a.attisdropped;
  IF generated_mark IS DISTINCT FROM 's' THEN
    RAISE EXCEPTION '0229_COLUMN_NOT_STORED';
  END IF;
END $$;

COMMIT;
```

## Post-apply verification

New read-only transaction on production. Do not read credential values.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

SELECT count(*)::bigint AS journal_rows,
       max(created_at)::text AS max_created_at
FROM drizzle.__drizzle_migrations;

SELECT created_at::text, hash
FROM drizzle.__drizzle_migrations
WHERE created_at = 1780000000229;

SELECT a.attgenerated, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS generation_expression
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.exchange_credentials'::regclass
  AND a.attname = 'observation_read_only'
  AND NOT a.attisdropped;

SELECT p.proname, p.provolatile, p.prosecdef, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'exchange_credential_observation_read_only';

SELECT has_column_privilege(
         'waia_account_observation_credential',
         'public.exchange_credentials',
         'observation_read_only',
         'SELECT') AS credential_role_can_select_gate,
       has_column_privilege(
         'waia_account_observation_credential',
         'public.exchange_credentials',
         'permission_metadata',
         'SELECT') AS credential_role_can_select_metadata;

SELECT to_regclass('public.trader_scheduled_noncapital_cycle_receipts_v1') AS scheduled_receipt_table,
       to_regprocedure('public.trader_observation_inventory_v1()') AS inventory_function_0230;

SELECT r.rolname
FROM pg_roles r
WHERE r.rolname IN ('waia_account_inventory', 'waia_account_inventory_owner');

ROLLBACK;
```

Expected:

- `journal_rows = 230`, `max_created_at = 1780000000229`.
- One journal row, hash `67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70`.
- `attgenerated = s`, `attnotnull` true, generation expression `exchange_credential_observation_read_only(permission_metadata, venue, exchange_account_id)`.
- One function, `provolatile = i` (immutable), `prosecdef` false, arguments `text, text, text`.
- Gate `SELECT` true for `waia_account_observation_credential`. Metadata `SELECT` still false.
- Receipts table still null. `trader_observation_inventory_v1` still null. Inventory roles still absent.

## Rollback

If `COMMIT` never succeeded, PostgreSQL already rolled the transaction back. Run the preflight again and expect the 0228 high-water mark. Do not retry until that is true.

If `COMMIT` succeeded and the post-apply checks fail, or the coordinator aborts before any process uses the new column: stop writers of `exchange_credentials`, then run this **one** transaction. Do not drop the column while a deployed observation host or account-acquisition session is using it. Those callers fail closed when the column is absent and can decrypt when the stored value is true. Roll the app or host back first if a release that requires the column has already gone out. This ceremony's intended order is schema first, and no release is authorized below, so the column should still be unused.

Do not use an in-place backup restore as the first rollback. 0229 is additive. In-place restore takes production offline and reverts every later write, not just this column.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.exchange_credentials
  DROP COLUMN observation_read_only;

DROP FUNCTION public.exchange_credential_observation_read_only(text, text, text);

DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = 1780000000229
  AND hash = '67086bdf2f8cdd101c49b33ef142daf5f791be6865e3b07b1e8de8897dc2bd70';

DO $$
DECLARE journal_count bigint;
BEGIN
  SELECT count(*) INTO journal_count
  FROM drizzle.__drizzle_migrations
  WHERE created_at = 1780000000229;
  IF journal_count <> 0 THEN
    RAISE EXCEPTION '0229_JOURNAL_STILL_PRESENT_%', journal_count;
  END IF;
  IF to_regprocedure('public.exchange_credential_observation_read_only(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '0229_FUNCTION_STILL_PRESENT';
  END IF;
END $$;

COMMIT;
```

After rollback, the preflight expectations hold again: 229 journal rows, high-water `1780000000228`, gate column absent.

## Release and flags after the schema

Applying 0229 does **not** authorize a Cloudflare deploy.

Last observed production web release in the handoff, not re-read here: SHA `31c78cba11d5ddf6cc6637b473a875574ebce00d`, version `2f679217-20de-4e3b-9905-bef8507c4948`, deployment `2b0ba0d5-cef2-4d8b-80a1-e915ecb9d990`. That SHA is an ancestor of current `main` and already contains the PR 714 credential reader. Confirm the live deployment SHA in Cloudflare before relying on it.

Do **not** deploy current `main` `520672258014ca4600b2343eef530a65dc38d769` as the follow-on of this migration. That commit's Worker cron calls `runScheduledNoncapitalPaperLoopFromEnv`. Checked-in `wrangler.jsonc` sets `PAPER_LOOP_ENABLED` to `1`, with `PAPER_LOOP_ORGANIZATION_ID` and `PAPER_LOOP_ACCOUNT_KEY` non-empty. `loadPaperLoopConfig` treats `1`, `true`, and `yes` as enabled. The scheduled owner then polls public HTX market data and writes `trader_scheduled_noncapital_cycle_receipts_v1`, which this migration does not create. An unchanged-config deploy fails that insert on every cron tick after a public GET, or commits noncapital cycles if the receipts table is added later without a separate decision.

Safe flag posture for any later, separately authorized deploy of `520672258014ca4600b2343eef530a65dc38d769`:

- Effective `PAPER_LOOP_ENABLED` is `0` or unset. Not `1`, `true`, or `yes`.
- `WAIA_TRADER_LIVE_ENABLED` and `WAIA_LIVE_TRADING_ENABLED` stay unset. Do not run `pnpm trader:live:enable` or `trader:live:confirm`.
- `WAIA_BLIND_HOLDOUT_ENABLED` stays unset.
- Do not change `MARKET_BRAIN_ENABLED`, `WATCHER_ENABLED`, or `WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED` in this window. Checked-in values are `1`. This packet does not retune them and does not treat them as a substitute for the paper-loop gate.
- Do not start `ai-trader-account-observation-host` in `account-observation-recurring`. Idle mode is a separate host decision and is not part of this SQL.
- Do not print Worker secrets while confirming flag names.

`52067225` is the source SHA of this packet. It is not the SHA to deploy until the receipts migration exists and a human release says the effective paper-loop flag is off or explicitly accepts the scheduled owner.

## Scheduled owner after the schema appears

0229 does not unblock the scheduled noncapital owner. That owner never reads `observation_read_only`. Its first database statement against the receipts table fails while the table is absent, and that statement is inside the transaction, before `runHeldNoTradeCycle` and before the receipt insert. Order submission is hard-refused (`SCHEDULED_PAPER_SUBMISSION_FORBIDDEN`) even when the table exists. The effect that **does** start once the column exists, without a new deploy, is the credential reader already in `31c78cba`: `createObservationCredentialReader` in the observation host and `createProtectedHtxAccountAcquisitionSessionV1`. While the column was missing, that projection failed closed. After 0229, a canonical HTX spot read-only credential stores `true`, and `waia_account_observation_credential` may select that boolean plus the ciphertext columns it already had. A running collector or acquisition session can then decrypt and issue read-only HTX GETs. The 2026-10-01 host check found no container named `waia-account-observation`; that does not prove another supervisor is absent. Do not start one in this window.

If the receipts table is created later while effective `PAPER_LOOP_ENABLED` is on, the owner will commit noncapital cycles: risk-limit `getOrCreate`, mock startup reconciliation, a paper cycle, and an append-only receipt. That is durable database effect. It is still not a live order. It is outside this 0229 authorization.

## Blockers and unknowns

- Production was not queried for this packet. The 0228 high-water mark and the absent receipts table are prior observations and must be re-proven by the preflight.
- Backup and PITR availability on `wdsnuvldxyrkqcjxvuxp` is unverified. No restore proof exists until the clone preflight passes.
- Effective Cloudflare `PAPER_LOOP_ENABLED` and the live-flag names were not re-read. Checked-in source and an older deployment snapshot both show paper loop enabled. That is unsafe for a deploy of current `main`, not a reason to skip 0229's own preflight.
- The scheduled receipts table has no canonical migration. 0230 remains deferred and must not ride along.
- DEE-1201 (paper executor lease) is a separate branch. This packet does not touch it.

## Acceptance

- The coordinator can apply exactly the 0229 file and one drizzle journal row in one transaction, and can prove the clone restore before doing so.
- 0230 objects stay absent.
- No production write, deploy, live flag, or order is performed by the change that adds this document.
