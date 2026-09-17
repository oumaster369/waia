# Post-H2 ordered one-step PostgreSQL migration operator

DEE-1018 provides the fail-closed Human-operated surface for the additive range **after** the frozen
H2 ladder:

`0208 → 0209 → verify → STOP → 0210 → verify → STOP`

It does not authorize or perform anything by itself. Each step is a separate Human ceremony. The
frozen H2 operator ([`H2-ONE-STEP-MIGRATION-OPERATOR.md`](H2-ONE-STEP-MIGRATION-OPERATOR.md)) keeps
`0205..0208` and is unchanged; this operator refuses those steps, and H2 refuses these.

## Ratified rollout model

The Human Architect selected the **ordered global post-H2 lane** for DEE-1018. The production
journal advances `0205 → 0206 → 0207 → 0208 → 0209 → 0210`. Sparse application — recording `0210`
while `0209` is unapplied — is rejected, and this operator refuses it structurally.

Applying `0209` is a **schema-only** step. It authorizes no AI-TWIN runtime, ingestion, writer,
route, backfill or product rollout; the operator proves that by requiring the AI-TWIN tables to grant
nothing to any other role, so no runtime identity can reach them.

## Why not `drizzle-kit migrate`

Drizzle selects unapplied migrations by a single `max(created_at)` high-water mark, not by strict
prefix. From a live journal at `0208` a generic migrate would apply `0209` **and** `0210` in one
uninterruptible run, collapsing two independently gated module rollouts into one decision. Worse, if
`0210` were ever recorded first, `0209` would fall below the high-water mark and be skipped forever.
This operator reads and executes only the one pinned migration named by `--step`.

## Safety boundary

- Use a direct or session-mode PostgreSQL URL in `DATABASE_URL_POSTGRES_SESSION`. Transaction-pooler
  port `6543` and `pool_mode=transaction` are refused.
- Migration SQL is read only from the pinned Git commit/blob. Checkout content is never an apply
  source, even when the working tree differs.
- Git runs through `/usr/bin/git` with replacement objects and user/system configuration disabled.
- Exactly one `--step` plus a matching `--confirm-exact-step` is required for mutation.
- There is no `--latest`, `--all`, `--continue`, `--next`, loop, DDL retry or next-step behavior, and
  no generic Drizzle migrate path.
- The complete live journal must equal the pinned predecessor prefix exactly. Gaps, extra rows,
  duplicates, changed hashes or timestamps, reordering, unknown or later identities, sparse `0210`
  and an already-applied step all refuse.
- The catalog is cross-checked against the journal: `0209` refuses if any `public.ai_twin_*` object
  already exists, and `0210` refuses unless the 18 AI-TWIN tables `0209` created are actually
  present. A journal row without its objects is treated as a forged history.
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

| `--step` | Accepted live journal | Resulting journal |
|---|---|---|
| `0209` | exactly `0000..0208` (209 rows) | `0000..0209` (210 rows) |
| `0210` | exactly `0000..0209` (210 rows) | `0000..0210` (211 rows) |

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
   `0210` policy exists.

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

After a successful `0209` receipt, **stop**. `0210` requires a new Human decision, a new evidence
packet and a second invocation with `--step 0210`.

## Migration-specific pre-commit verification

**0209 (DEE-871 AI-TWIN epistemic persistence).** Exactly the 18 `ai_twin_*` tables; the 4 immutable
validator functions, none `SECURITY DEFINER`; every `ai_twin_*` index belongs to one of those tables
and no view, sequence or foreign table appears; all objects owned by the migration authority; zero
table privileges granted to any other role; no `SELECT` reachability for `authenticated`, `anon` or
`PUBLIC`; and the Trader `0205` observation surface — the `observation_revision` column, the five
`0205` policies and the absence of any credential-column grant — left intact.

**0210 (DEE-1015 account-observation credential authority).** Exact
`waia_account_observation_credential` posture (NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS,
NOCREATEDB, NOCREATEROLE, NOREPLICATION, no memberships); exactly the eight granted credential
columns and three state columns, all `SELECT`; no whole-table credential `SELECT`; no reachability
for the seven withheld credential columns; no credential INSERT/UPDATE/DELETE; no observer or reader
access to `encrypted_payload` or `wrapped_dek_key`; both assignment-bound `FOR SELECT` policies
present, permissive, scoped to that single role, consulting the `waia.observation_*` runtime context
and never `USING (true)`, with the credential read additionally bound to a provisioned collection
state and `status = 'active'`; and `FORCE ROW LEVEL SECURITY` still disabled on
`exchange_credentials` per migration `0007`.

Verification runs before COMMIT. Full relation/column/constraint/index/policy/trigger/function/
role/membership/grant projections are matched against immutable expected catalog digests validated on
PostgreSQL 17. The digest is receipt-bound and must match one fresh read-only, repeatable-snapshot
post-commit verification transaction.

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

`POST_H2_MIGRATION_REFUSED:COMMIT_RESULT_UNCERTAIN` means no DDL retry is allowed. Reuse the exact
step, target and four attestations with `--verify-only` (which forbids `--confirm-exact-step`):

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
remains, or a refusal for every partial, later, changed, unknown or catalog-contradictory state.

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
WAIA_TEST_DEE1018_PG_ADMIN_URL='postgres://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate' \
pnpm test --run tests/integration/postgres-post-h2-migration-operator-v1.test.ts
```

Never set this variable to a production, Supabase, remote or shared database.
