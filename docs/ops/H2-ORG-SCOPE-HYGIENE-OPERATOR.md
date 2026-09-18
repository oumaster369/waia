# H2 leftover org-scope hygiene operator

DEE-1022 provides a fail-closed Human-operated surface that DROPs leftover permissive
`FOR ALL` policies named `waia_historical_runner_org_scope`. Those policies are absent from git
migrations `0000..0205` and would OR-bypass the 0206/0207 Brier INSERT WITH CHECK.

This operator does **not** apply H2. Production 0206 remains a later, separate ceremony after this
lane returns `SELECTED_STEP_COMMITTED`.

## Safety boundary

- Use a direct or session-mode PostgreSQL URL in `DATABASE_URL_POSTGRES_SESSION`. Transaction-pooler
  ports `6543` / `6432` and `pool_mode=transaction|statement` are refused.
- The live journal must equal the pinned H2 `0000..0205` prefix exactly. The operator never inserts a
  Drizzle journal row and never edits 0205–0211 SQL.
- Exactly `--step DROP_ORG_SCOPE` plus matching `--confirm-exact-step DROP_ORG_SCOPE` are required
  for mutation. There is no `--latest`, `--all`, `--continue`, generic migrate, or next-step behavior.
- Live leftover inventory must match the frozen 28-relation identity (name, `polcmd=*`, permissive,
  role `waia_historical_runner`, USING/CHECK). Partial, extra, or rewritten leftovers refuse. The
  operator then `DROP POLICY` those 28 names only.
- It does **not** CREATE `waia_historical_runner_org_select_v2` on 0201 exact-run relations
  (`trader_orders`, `trader_order_events`, `trader_fills`, `trader_accounting_frontier`) and does
  **not** invent SELECT on `trader_lifecycle_events`.
- An H2 or post-H2 ceremony packet cannot authorize this DROP: schema, trust path, selected step and
  extra leftover-binding fields are distinct.
- Uncertain COMMIT must never be retried; use `--verify-only`.

## Required Human evidence

Four owner-only (`0600`) JSON files, schema
`waia.trader.h2.org-scope-hygiene-human-attestation.v1`, issued within 15 minutes, binding the same
ceremony/request, target fingerprint, leftover policy name, leftover relation digest, and Partner
Alpha0 organization id.

Trust policy (root-owned, not group/world-writable):

`/etc/waia/h2-org-scope-hygiene-approved-human-key.sha256`

`CEREMONY_AUTHORIZATION.evidenceDigestHex` must equal the leftover relation digest.
`TARGET_IDENTITY.evidenceDigestHex` must equal the target fingerprint.

## Command

Documentation shape only; substitute Human-approved private paths:

```bash
DATABASE_URL_POSTGRES_SESSION='<direct-or-session-secret-url>' \
pnpm trader:h2:org-scope-hygiene \
  --step DROP_ORG_SCOPE \
  --confirm-exact-step DROP_ORG_SCOPE \
  --expected-target-fingerprint '<64-lowercase-hex>' \
  --trusted-human-public-key '/private/h2/hygiene/human-ed25519-public.pem' \
  --restore-point-attestation '/private/h2/hygiene/restore-point.json' \
  --writer-quiescence-attestation '/private/h2/hygiene/writer-quiescence.json' \
  --target-identity-attestation '/private/h2/hygiene/target-identity.json' \
  --ceremony-authorization-attestation '/private/h2/hygiene/ceremony-authorization.json'
```

`--verify-only` (without `--confirm-exact-step`) reports `LEFTOVER_ORG_SCOPE_PRESENT` while the
frozen 28 remain, or `SELECTED_STEP_COMMITTED` after they are gone and remaining 0199/0201 policies
are still lawful.

## After a successful receipt

Stop. Do not retry 0206 until this receipt is `SELECTED_STEP_COMMITTED` and a new H2 packet for
`--step 0206` is prepared. See [`H2-ONE-STEP-MIGRATION-OPERATOR.md`](H2-ONE-STEP-MIGRATION-OPERATOR.md).
