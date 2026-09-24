# Post-H2 ordered one-step PostgreSQL migration operator

DEE-1018 provides the fail-closed Human-operated surface for the additive range **after** the frozen
H2 ladder:

`0208 → 0209 → verify → STOP → 0210 → verify → STOP → 0211 → … → 0215`

DEE-1070 extends the same operator through `0211`, `0212`, `0213`, `0214`, and `0215`. Each of those
steps is still one Human ceremony. The operator does not apply a later step because an earlier one
succeeded.

It does not authorize or perform anything by itself. Each step is a separate Human ceremony. The
frozen H2 operator ([`H2-ONE-STEP-MIGRATION-OPERATOR.md`](H2-ONE-STEP-MIGRATION-OPERATOR.md)) keeps
`0205..0208` and is unchanged; this operator refuses those steps, and H2 refuses these.

## Ratified rollout model

The Human Architect selected the **ordered global post-H2 lane** for DEE-1018. The production
journal advances `0205 → 0206 → 0207 → 0208 → 0209 → 0210 → 0211 → 0212 → 0213 → 0214 → 0215`.
Sparse application — recording any later step while its predecessor is unapplied — is rejected, and
this operator refuses it structurally.

Applying `0209` is a **schema-only** step. It authorizes no AI-TWIN runtime, ingestion, writer,
route, backfill or product rollout; the operator proves that by requiring the AI-TWIN tables to grant
nothing to any other role, so no runtime identity can reach them. The four `ai_twin_*` validator
functions keep the cluster's untouched function default ACL: stock `PUBLIC EXECUTE` on bare
PostgreSQL (`proacl` NULL) and owner-only EXECUTE on the approved production target
(`{postgres=X/postgres}`). They are `IMMUTABLE` pure `jsonb → boolean` predicates that read no
table, their bodies are pinned verbatim in the catalog digest, and the operator refuses any
named-role EXECUTE grant.

## Why not `drizzle-kit migrate`

Drizzle selects unapplied migrations by a single `max(created_at)` high-water mark, not by strict
prefix. From a live journal at `0208` a generic migrate would apply `0209` through `0215` in one
uninterruptible run, collapsing independently gated module rollouts into one decision. Worse, if a
later step were ever recorded first, its predecessor would fall below the high-water mark and be
skipped forever.
This operator reads and executes only the one pinned migration named by `--step`.

## Safety boundary

- Use a direct or session-mode PostgreSQL URL in `DATABASE_URL_POSTGRES_SESSION`. Pooler ports `6543`
  and `6432`, and `pool_mode=transaction` / `pool_mode=statement`, are refused.
- Migration SQL is read only from the pinned Git commit/blob. Checkout content is never an apply
  source, even when the working tree differs.
- Git runs through `/usr/bin/git` with replacement objects and user/system configuration disabled.
- Exactly one `--step` plus a matching `--confirm-exact-step` is required for mutation.
- There is no `--latest`, `--all`, `--continue`, `--next`, loop, DDL retry or next-step behavior, and
  no generic Drizzle migrate path.
- The complete live journal must equal the pinned predecessor prefix exactly. Gaps, extra rows,
  duplicates, changed hashes or timestamps, reordering, unknown or later identities, a sparse step
  and an already-applied step all refuse.
- The catalog is cross-checked against the journal. `0209` refuses if any `public.ai_twin_*` object
  already exists. Each later step refuses unless the previous step's objects are present, and
  refuses if its own objects are already present. A journal row without its objects is treated as a
  forged history.
- Exact SQL and its single Drizzle journal row share one manually controlled, non-retrying
  `SERIALIZABLE` transaction.
- A pre-commit catalog contradiction rolls back both. An uncertain COMMIT must never be retried; use
  `--verify-only`.
- Receipts carry identities and digests, never credentials or attestation contents.

## Pinned source

| Step | idx | when | Source commit | Git blob | SHA-256 |
|---|---|---|---|---|---|
| 0209 | 209 | 1780000000209 | `b10f7edcb2187253355399ca5dfb82bac0177c12` | `baa60df04b1d8e2efa128ec645c44d7c956ae620` | `abed7b094260866d33f82aa420481bf910e70c0e331f470ef4999e66e6c6f397` |
| 0210 | 210 | 1780000000210 | `4b6081342702e0322d0bda4c64f00cbf04704b4e` | `302d215e41ff9f3e2409473479b81d1611ca919e` | `1ab9f641f02cdf51f7fbefcc910163e3834c20aacbe7ea12a71163f547983efb` |
| 0211 | 211 | 1780000000211 | `8121eef576bcc8e32b5429c46e2bf0a54d73f25a` | `1fa106097cb2913cbd624b871ed6fa3509d7229b` | `6e1fd8ab8cefd9a9b03841709584db116193d2a2074e81e3650c8ea03aca08c2` |
| 0212 | 212 | 1780000000212 | `d356d39727e7310d815abbdb44d8b73c454531c4` | `ec36226c119d9121efff9100ba81ed74a04051cc` | `4dca64d100c7a410fce764966080e7ce9b925e5838880b7932c62cc0248a8cb0` |
| 0213 | 213 | 1780000000213 | `d356d39727e7310d815abbdb44d8b73c454531c4` | `449dfeef8e3726cb8146b8c7aa83ddc2ec0bb9e9` | `aae00fa4a90d5421103a9a78eb1ec31c98683e77b31faf4576160295da5e58f4` |
| 0214 | 214 | 1780000000214 | `c6e5349bf7a8e3b7eb3d546b1210445ec38dee0e` | `a7a9c3185aa1809cc94ea72c4388beed4ad29662` | `3f6299469575115d531bab8c0c32e2eb619313458b02738c9d1fda73b47de49c` |
| 0215 | 215 | 1780000000215 | `c6e5349bf7a8e3b7eb3d546b1210445ec38dee0e` | `a7656ba91f49a6670cb3a8d75cab217235557d13` | `5b7808ce91078cc598d177685b20bb4c6bed95f15c2a692d39741ef4312ee5fe` |

| `--step` | Accepted live journal | Resulting journal |
|---|---|---|
| `0209` | exactly `0000..0208` (209 rows) | `0000..0209` (210 rows) |
| `0210` | exactly `0000..0209` (210 rows) | `0000..0210` (211 rows) |
| `0211` | exactly `0000..0210` (211 rows) | `0000..0211` (212 rows) |
| `0212` | exactly `0000..0211` (212 rows) | `0000..0212` (213 rows) |
| `0213` | exactly `0000..0212` (213 rows) | `0000..0213` (214 rows) |
| `0214` | exactly `0000..0213` (214 rows) | `0000..0214` (215 rows) |
| `0215` | exactly `0000..0214` (215 rows) | `0000..0215` (216 rows) |

The `0000..0208` prefix is taken from the H2 operator's own pinned baseline closure, so the two lanes
cannot disagree about what "canonical through 0208" means. Preparing `0210` re-pins the `0209`
source as well, so it can never be prepared against an unverifiable predecessor.

## Required Human evidence

Four separate owner-only (`0600`), non-symlink, canonical-path JSON files are mandatory:

1. `RESTORE_POINT` / `APPROVED_RESTORE_POINT_AVAILABLE`
2. `WRITER_QUIESCENCE` / `WRITERS_QUIESCED`
3. `TARGET_IDENTITY` / `TARGET_IDENTITY_APPROVED`
4. `CEREMONY_AUTHORIZATION` / `AUTHORIZE_EXACT_POST_H2_STEP`

All four use `waia.trader.post-h2.human-attestation.v1`, must be issued no more than 15 minutes
before invocation, and bind the same ceremony and request IDs, selected step, target fingerprint,
expected database and migration authority, operator and Human approver identities, evidence digest,
canonical UTC issuance time and trusted Ed25519 signing-key fingerprint.

`contentDigestHex` is SHA-256 of recursively key-sorted canonical JSON excluding that field and
`signatureBase64`. `signatureBase64` is a canonical Ed25519 signature over the lowercase-hex content
digest. The owner-only trusted public-key file must match the fingerprint in the root-owned,
non-group/world-writable fixed trust policy `/etc/waia/post-h2-approved-human-key.sha256`; every
attestation must bind that same fingerprint. The CLI cannot select or override this trust anchor.
For `TARGET_IDENTITY`, `evidenceDigestHex` must equal `targetFingerprint`.

The schema version and trust-policy path are deliberately distinct from H2's, so an H2 ceremony
packet can never authorize a post-H2 step and a post-H2 packet can never authorize an H2 step.

The target fingerprint is the canonical digest of the independently observed database name/OID,
cluster system identifier, migration role, server address/port and server version. The operator
recomputes it with `pg_control_system()` and rejects any mismatch.

Do not place passwords, connection strings, backup locators, SQL, tokens or private evidence in the
attestations. Bind sensitive evidence by SHA-256 only.

## Preflight

Before every step, the Human ceremony must establish:

1. An approved, tested restore point bound to this target and request.
2. The approved Ed25519 public-key fingerprint installed at the fixed root-owned trust-policy path.
3. Application, Trader and AI-TWIN writers are stopped.
4. The direct/session target points to the expected writable primary.
5. The migration role is the approved role, owns the Drizzle journal and — for `0210` — owns
   `public.exchange_credentials` and `public.trader_account_collection_state`, can create in
   `public`, and can create roles for `0210`.
6. The complete live journal is exactly through the requested predecessor.
7. For `0209`: no `public.ai_twin_*` object exists. For `0210`: `0209`'s objects exist and neither
   `0210` policy exists. For `0211`–`0215`: the predecessor step's objects exist and this step's
   objects do not.

The operator independently checks relevant `pg_stat_activity` writer identities, then obtains a
transaction advisory lock for `waia.trader.post-h2.migration-operator.v1`, `ACCESS EXCLUSIVE` on
`drizzle.__drizzle_migrations`, and `ACCESS EXCLUSIVE` on the selected step's affected existing
relations. Lock wait is fixed at three seconds; failure refuses without retry.

## Command

The shape below is documentation only; substitute Human-approved private paths and the exact target
fingerprint during the separate ceremony:

```bash
DATABASE_URL_POSTGRES_SESSION='<direct-or-session-secret-url>' \
pnpm trader:post-h2:migrate \
  --step 0209 \
  --confirm-exact-step 0209 \
  --expected-target-fingerprint '<64-lowercase-hex>' \
  --trusted-human-public-key '/private/post-h2/human-ed25519-public.pem' \
  --restore-point-attestation '/private/post-h2/restore-point.json' \
  --writer-quiescence-attestation '/private/post-h2/writer-quiescence.json' \
  --target-identity-attestation '/private/post-h2/target-identity.json' \
  --ceremony-authorization-attestation '/private/post-h2/ceremony-authorization.json'
```

After a successful receipt, **stop**. The next step requires a new Human decision, a new evidence
packet and a second invocation that names that exact step. Substitute `--step 0211` (or `0212`,
`0213`, `0214`, `0215`) only when that step is the one the Human just authorized.

## Migration-specific pre-commit verification

**0209 (DEE-871 AI-TWIN epistemic persistence).** Exactly the 18 `ai_twin_*` tables; the 4 immutable
validator functions, none `SECURITY DEFINER`; every `ai_twin_*` index belongs to one of those tables
and no view, sequence or foreign table appears; all objects owned by the migration authority; zero
table privileges granted to any other role; no `SELECT` reachability for `authenticated`, `anon` or
`PUBLIC`; and the Trader `0205` observation surface — the `observation_revision` column, the five
`0205` policies and the absence of any credential-column grant — left intact.

**0210 (DEE-1015 account-observation credential authority).** Exact
`waia_account_observation_credential` posture (NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS,
NOCREATEDB, NOCREATEROLE, NOREPLICATION, no memberships); no role other than
`waia_account_observation_credential_login` holding this authority, and that one only without
`INHERIT` or `ADMIN`, so the credential grants are reachable only through an explicit `SET ROLE`
inside the observation transaction; exactly the eight granted credential columns and three state
columns, all `SELECT`; no whole-table credential `SELECT`; no reachability for the seven withheld
credential columns; no credential INSERT/UPDATE/DELETE; no observer or reader access to
`encrypted_payload` or `wrapped_dek_key`; both assignment-bound `FOR SELECT` policies present on
their own relation, permissive, scoped to that single role, consulting the `waia.observation_*`
runtime context and never `USING (true)`, with the credential read additionally bound to a provisioned
collection state and `status = 'active'`; row-level security still enabled and `FORCE ROW LEVEL
SECURITY` still disabled on `exchange_credentials` per migration `0007`.

**0211 (knowledge edge and prediction versions).** The two version tables exist. Immutability
triggers `trader_knowledge_edges_immutable_all_v2` and `trader_market_predictions_immutable_all_v2`
are `BEFORE UPDATE OR DELETE`. Copied edge rows equal `trader_knowledge_edges`. Copied verification
rows equal predictions whose `verified_at`, `outcome_json`, and `verification_result` are all
non-null. No non-owner `UPDATE` or `DELETE` grant remains on the two source tables.

**0212 / 0213 (human promotion).** `0212` requires `trader_human_promotion_proposal_v2` and
`trader_human_research_assignment_v2`. `0213` requires deny-by-default row-level security on both.

**0214 / 0215 (admin console).** `0214` requires the seventeen console tables and the absence of
trigger `trader_admin_change_log_trg`. `0215` requires deny-by-default row-level security on those
tables and the same absent trigger.

Verification runs before COMMIT. Full relation/column/constraint/index/policy/trigger/function/
role/membership/grant projections are matched against immutable expected catalog digests. Snapshot definition rows are re-sorted bytewise in-process so ICU vs libc punctuation cannot
reorder identical FOREIGN KEY strings. Digests are re-derived on PostgreSQL 17 for both locale
providers.
The digest is receipt-bound and must match one fresh read-only, repeatable-snapshot post-commit
verification transaction.

## Receipt

`waia.trader.post-h2.migration-operation-receipt.v1` is printed as one canonical JSON line. It binds
mode and outcome classification, target fingerprint and selected step, source commit/blob/SHA-256 and
predecessor, journal digests before and after, four attestation content digests with ceremony/request/
operator identities, the trusted Ed25519 signing-key fingerprint, transaction identity when
available, catalog verification digest, commit observation timestamp, read-only post-commit
verification including `genericMigratorUsed: false` and `aiTwinRuntimeActivated: false`,
`nextStepExecuted: false`, and its own semantic content digest.

Persist the stdout receipt in the approved Human evidence store. It contains no secrets.

## Uncertain COMMIT recovery

`POST_H2_MIGRATION_REFUSED:COMMIT_RESULT_UNCERTAIN` means no DDL retry is allowed. Rerun with the
exact same step and target under `--verify-only` (which forbids `--confirm-exact-step`). Attestations
expire 15 minutes after they are issued, so if the ceremony has already run longer than that, the
Human must mint a fresh packet for the same step and target — this grants no mutation authority,
because verify-only cannot apply anything:

```bash
DATABASE_URL_POSTGRES_SESSION='<same-direct-or-session-secret-url>' \
pnpm trader:post-h2:migrate \
  --step 0209 \
  --verify-only \
  --expected-target-fingerprint '<same-64-lowercase-hex>' \
  --trusted-human-public-key '/private/post-h2/human-ed25519-public.pem' \
  --restore-point-attestation '/private/post-h2/restore-point.json' \
  --writer-quiescence-attestation '/private/post-h2/writer-quiescence.json' \
  --target-identity-attestation '/private/post-h2/target-identity.json' \
  --ceremony-authorization-attestation '/private/post-h2/ceremony-authorization.json'
```

Verify-only opens a fresh default-read-only connection and returns only `SELECTED_STEP_COMMITTED`
after exact journal and catalog verification, `PREDECESSOR_NOT_APPLIED` when the exact predecessor
journal remains *and* the catalog agrees that the step is cleanly unapplied, or a refusal for every
partial, later, changed, unknown or catalog-contradictory state.

## Failure and recovery

- Before COMMIT: the transaction rolls back SQL and journal together. Stop and investigate.
- Lock timeout, serialization error, disconnect or catalog failure: no automatic retry.
- After a known COMMIT but failed post-commit verification: do not rerun the migration; use
  `--verify-only`.
- A committed but invalid state is not automatically reversed. Keep writers quiesced and use the
  approved restore point only under a new Human recovery decision.

## Local-only validation

The integration suite is opt-in and hard-requires a loopback PostgreSQL administrator URL. It creates
disposable databases, applies the baseline through `0208`, and never uses a shared target:

```bash
WAIA_TEST_DEE1018_PG_ADMIN_URL='postgres://postgres@127.0.0.1:55492/postgres' \
pnpm test --run tests/integration/postgres-post-h2-migration-operator-v1.test.ts
```

Use a disposable loopback PostgreSQL 17 on its own port. Do not point this variable at port `54329`
(the shared local validate database), `.env.local`, production, Supabase, or any remote database.

`0209` and `0210` are additionally covered on the target's cluster class by
`tests/integration/postgres-migration-catalog-authority-supabase-like-v1.test.ts` — see the
DEE-1020 section of [`H2-ONE-STEP-MIGRATION-OPERATOR.md`](H2-ONE-STEP-MIGRATION-OPERATOR.md) for how
to run it.
