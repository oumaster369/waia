# H2 one-step PostgreSQL migration operator

DEE-1010 provides a fail-closed Human-operated surface for the frozen Trader H2 ladder:

`0204 → 0205 → verify → 0206 → verify → 0207 → verify → 0208 → verify`

It does not authorize or perform H2 by itself. Production execution remains a separate T4
Human ceremony. Migration `0209` is outside this ladder and is always refused.

## Safety boundary

- Use a direct or session-mode PostgreSQL URL in `DATABASE_URL_POSTGRES_SESSION`.
  Transaction-pooler port `6543` and `pool_mode=transaction` are refused.
- The checked-out branch may contain newer files, but migration SQL is read only from the
  pinned Git commit/blob. Filesystem/current-checkout SQL is never an apply source.
- Git runs through `/usr/bin/git` with replacement objects and user/system Git configuration
  disabled. The 0204 journal blob, journal SHA-256 and complete `0000..0204` closure digest are
  pinned in addition to the migration identities below.
- Exactly one `--step` and matching `--confirm-exact-step` are required for mutation.
- There is no `--latest`, `--all`, `--continue`, loop, DDL retry, or next-step behavior.
- The complete database journal must equal the pinned predecessor prefix. Partial, duplicate,
  changed, missing, unknown, later, or `0209` identities refuse.
- Any public `ai_twin_*` relation or function refuses the frozen H2 lane.
- Exact SQL and its Drizzle journal row share one manually controlled, non-retrying
  `SERIALIZABLE` transaction.
- Pre-commit catalog contradiction rolls back. An uncertain COMMIT result must never be
  retried; use only `--verify-only`.
- Receipts contain identities and digests, not credentials or attestation contents.

## Pinned source

| Step | Source commit | Git blob | SHA-256 |
|---|---|---|---|
| 0204 baseline | `8023bb1980d9f02e61db4024f725aa16161c32dd` | `59ea9dd882ecd1f29787366f46889aaa560fa843` | `3d276ce097da14451e3114e112d1adef3fae5a63b719380244bb8e82ebb05a98` |
| 0205 | `c1d11c26a820315ca8cab0d04361223d4d94b53d` | `c75c42d2bae15beea5741161abfb18afae0b4c3b` | `aa511acd320b653858e4b064dfeb1af744a4d7f81cffaf72fb67cd91f1fffde1` |
| 0206 | `657914b1d6b4b897619cbfaef5d558ae1378efc9` | `22edad8bbee008f58592e263b78f01e162804543` | `20a768b30a3b0cf833ee29058f1343da1842947d9110d162e8a513cfa6b171ab` |
| 0207 | `7e0498f7a7e922d35a5c1ca6d61e1bf995e1c76d` | `d50d389d736bc2ab3a7ccbaf58eefd4a5ac168ac` | `fcd4e14c2bcb8a3e46b7267f25c662544b9d41de1370434785fafb240eff9491` |
| 0208 | `d7d5941a995b83473acb6e00c42d5252c44b2303` | `6f86bb554f4ec6a18ad3002c4b6db2d8733f7c65` | `d85e8e34da28860073d9c2f8f9ac9d7e58c3d296e905b1b73ba65a79cfe407f0` |

The complete `0000..0204` journal and SQL hashes are reconstructed from the immutable 0204
source commit, never from current checkout files.

## Required Human evidence

Four separate owner-only (`0600`), non-symlink, canonical-path JSON files are mandatory:

1. `RESTORE_POINT` / `APPROVED_RESTORE_POINT_AVAILABLE`
2. `WRITER_QUIESCENCE` / `WRITERS_QUIESCED`
3. `TARGET_IDENTITY` / `TARGET_IDENTITY_APPROVED`
4. `CEREMONY_AUTHORIZATION` / `AUTHORIZE_EXACT_H2_STEP`

All four use `waia.trader.h2.human-attestation.v1`, must be issued no more than 15 minutes
before invocation, and bind the same:

- ceremony and request IDs;
- selected step;
- target fingerprint;
- expected database and migration authority;
- operator and Human approver identities;
- evidence digest and canonical UTC issuance time.
- trusted Ed25519 signing-key fingerprint.

`contentDigestHex` is SHA-256 of recursively key-sorted canonical JSON excluding that field and
`signatureBase64`. `signatureBase64` is a canonical Ed25519 signature over the lowercase-hex
content digest. The owner-only trusted public-key file must match the fingerprint in the
root-owned, non-group/world-writable fixed trust policy
`/etc/waia/h2-approved-human-key.sha256`; every attestation must bind that same fingerprint.
The CLI cannot select or override this trust anchor.
For `TARGET_IDENTITY`, `evidenceDigestHex` must equal `targetFingerprint`.

The target fingerprint is the canonical digest of the independently observed database name/OID,
cluster system identifier, migration role, server address/port, and server version. The operator
recomputes it using `pg_control_system()` and rejects any mismatch. Human/DBA preparation of
these files is outside the operator; it never fabricates authorization or restore evidence.

Do not place passwords, connection strings, backup locators, SQL, tokens, or private evidence in
the attestations. Bind sensitive evidence by SHA-256 only.

## Preflight

Before every step, the Human ceremony must establish:

1. An approved, tested restore point bound to this target and request.
2. Human infrastructure has provisioned the approved Ed25519 public-key file fingerprint at the
   fixed root-owned trust-policy path; operators cannot write or override it.
3. Application and Trader writers are stopped.
4. The direct/session target points to the expected writable primary.
5. The migration role is the approved role, owns the Drizzle journal and affected existing
   relations, can create in `public`, and can create roles for 0205.
6. The complete live journal is exactly through the requested predecessor.
7. No `0209` journal or `ai_twin_*` object exists.

The operator independently checks relevant `pg_stat_activity` writer identities, then obtains:

- a transaction advisory lock for `waia.trader.h2.migration-operator.v1`;
- `ACCESS EXCLUSIVE` on `drizzle.__drizzle_migrations`;
- `ACCESS EXCLUSIVE` on the selected step's affected existing relations.

Lock wait is fixed at three seconds. Failure refuses without retry.

## Command

The shape below is documentation only; substitute Human-approved private paths and the exact
target fingerprint during the separate H2 ceremony:

```bash
DATABASE_URL_POSTGRES_SESSION='<direct-or-session-secret-url>' \
pnpm trader:h2:migrate \
  --step 0205 \
  --confirm-exact-step 0205 \
  --expected-target-fingerprint '<64-lowercase-hex>' \
  --trusted-human-public-key '/private/h2/human-ed25519-public.pem' \
  --restore-point-attestation '/private/h2/restore-point.json' \
  --writer-quiescence-attestation '/private/h2/writer-quiescence.json' \
  --target-identity-attestation '/private/h2/target-identity.json' \
  --ceremony-authorization-attestation '/private/h2/ceremony-authorization.json'
```

After a successful receipt, stop. The next step requires a new Human decision, new evidence and
a new invocation with the next explicit step.

## Migration-specific pre-commit verification

- **0205:** exact observer/reader role posture; revision column; RLS/FORCE RLS; seven scoped
  policies; revision/immutability triggers; no secret grants; no public function execution.
- **0206:** one permissive runner INSERT policy with exact Brier-v3 receipt/harness identities
  and amendment digest; no Cody-v2 identity.
- **0207:** the same policy replaced by exact admission-v4, terminal-v3, harness-v5 and
  Cody-7.15/v2 identities and amendment digest; old admission-v3 identity absent.
- **0208:** exact terminal table columns, constraints and lineage FKs; RLS/FORCE RLS;
  append-only triggers; owner/runner/browser policies; restricted runner/browser grants; immutable
  comparison-identity validator.

Verification runs before COMMIT. Full relation/column/constraint/index/policy/trigger/function/
role/membership/grant projections are matched against immutable expected catalog digests. Snapshot `ORDER BY` of definition text is not trusted: ICU `en-US` (approved Supabase PG 17.6)
and libc `en_US.utf8` (alpine fixtures) disagree on `,` vs `)`. The frozen snapshot re-sorts
those rows bytewise in-process so both locale providers converge. Digests are re-derived on
PostgreSQL 17 for both classes.
The digest is receipt-bound and must match one fresh read-only, repeatable-snapshot post-commit
verification transaction.

## Receipt

`waia.trader.h2.migration-operation-receipt.v1` is printed as one canonical JSON line. It binds:

- mode and outcome classification;
- target fingerprint and selected step;
- source commit/blob/SHA-256 and predecessor;
- journal digests before/after;
- four attestation content digests and ceremony/request/operator identities;
- trusted Human Ed25519 signing-key fingerprint;
- transaction identity when available;
- catalog verification digest;
- commit observation timestamp;
- read-only post-commit verification;
- `migration0209Observed: false`;
- `nextStepExecuted: false`;
- its own semantic content digest.

Persist the stdout receipt in the approved Human evidence store. It contains no secrets.

## Uncertain COMMIT recovery

`H2_MIGRATION_REFUSED:COMMIT_RESULT_UNCERTAIN` means no DDL retry is allowed. Reuse the exact
step, target and four attestations with:

```bash
DATABASE_URL_POSTGRES_SESSION='<same-direct-or-session-secret-url>' \
pnpm trader:h2:migrate \
  --step 0205 \
  --verify-only \
  --expected-target-fingerprint '<same-64-lowercase-hex>' \
  --trusted-human-public-key '/private/h2/human-ed25519-public.pem' \
  --restore-point-attestation '/private/h2/restore-point.json' \
  --writer-quiescence-attestation '/private/h2/writer-quiescence.json' \
  --target-identity-attestation '/private/h2/target-identity.json' \
  --ceremony-authorization-attestation '/private/h2/ceremony-authorization.json'
```

Verify-only opens a fresh default-read-only connection and returns only:

- `SELECTED_STEP_COMMITTED`, after exact journal and catalog verification; or
- `PREDECESSOR_NOT_APPLIED`, when the exact predecessor remains; or
- a refusal for every partial, later, changed, unknown, `0209`, or catalog-contradictory state.

## Failure and recovery

- Before COMMIT: the transaction rolls back SQL and journal together. Stop and investigate.
- Lock timeout, serialization error, disconnect or catalog failure: no automatic retry.
- After known COMMIT but failed post-commit verification: do not rerun migration; use
  `--verify-only`.
- A committed but invalid state is not automatically reversed. Keep writers quiesced and use the
  approved restore point only under a new Human recovery decision.

## Local-only validation

The integration suite is opt-in and hard-requires a loopback PostgreSQL administrator URL. It
creates disposable databases, applies the baseline through 0204, and never uses a shared target:

```bash
WAIA_TEST_DEE1010_PG_ADMIN_URL='postgres://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate' \
pnpm test --run tests/integration/postgres-h2-migration-operator-v1.test.ts
```

Never set this variable to a production, Supabase, remote, or shared database.

### Supabase-class catalog authority (DEE-1020)

The suite above runs against a bare cluster whose migration authority is the bootstrap superuser.
The approved target is a Supabase-class managed cluster, whose platform bootstrap changes catalog
ACL and membership rows. A second opt-in suite builds that cluster class from
`scripts/postgres-validation/prelude-supabase-baseline.sql`, proves `0205`–`0210` reach the same
frozen digests there, and injects unsafe grants to prove each one is refused. Run it in a separate
disposable container — it provisions cluster-level roles of its own:

```bash
WAIA_TEST_DEE1020_SUPABASE_LIKE_PG_ADMIN_URL='postgres://waia_validate:waia_validate_local_only@127.0.0.1:54330/waia_validate' \
pnpm test --run tests/integration/postgres-migration-catalog-authority-supabase-like-v1.test.ts
```

Both suites must pass before a ceremony: the bare lane proves the operator's step semantics, and
this one proves the frozen digests are reachable on the target's cluster class without concealing
authority. Neither is wired into GitHub CI, because each provisions cluster-level roles.
