# DEE-705 — Breath of WAIA activation and rollback

## Purpose

This runbook activates the already reviewed Breath of WAIA completion batch. It does not authorize a deployment, database migration, public wallet registration, publication, provider secret change, or watcher enablement by itself. Every production step below is Human-only.

## Invariants

- The Treasury watcher is read-only and has no signing, custody, transfer-building, or broadcast capability.
- Register only a public USDT TRC-20 address. Never enter or provide a private key, seed phrase, signing key, PIN, CVV, full card number, or password.
- TronGrid is the primary read provider. Production readiness also requires an independently operated secondary TRON endpoint.
- Wallet registration does not enable observation. `TREASURY_WATCHER_ENABLED` defaults false.
- Finance Assistant reports are read-only. Writes require admin permission, a typed preview, explicit Human confirmation, a short-lived signed token, and a unique append-only consumption receipt.
- Automatic wallet entries remain `NEEDS_REVIEW`. No automation verifies or publishes them.
- Operating and Development Funds are accounting allocations over the same physical accounts; no custody movement occurs.
- AI-TRADER and the Execution Server are outside this procedure.

## Required Human inputs

Prepare these directly in the managed host. Do not paste secrets into chat, Linear, Git, screenshots, or logs.

1. Exact production organization UUID.
2. Public Treasury wallet address and Human-approved watcher start block after the ledger inception.
3. Dedicated TronGrid API key restricted to the USDT contract and required read endpoints.
4. Independent secondary TRON read endpoint and its separate credential if required.
5. Dedicated Finance Assistant OpenAI key and a random confirmation secret of at least 32 characters.
6. R2 evidence binding and least-privilege credentials.
7. Current database backup identifier and restore rehearsal evidence.

## Preflight — keep everything DARK

1. Confirm reviewed application SHA and migration SHA match the release candidate.
2. Confirm migrations `0163`–`0166` passed from an empty Postgres database.
3. Back up production Postgres and record the backup identifier outside Git.
4. Keep `TREASURY_WATCHER_ENABLED=false` and `WAIA_FINANCE_ASSISTANT_WRITES_ENABLED=false`.
5. Configure `TREASURY_WATCHER_ORGANIZATION_ID`, primary/secondary provider settings, R2, and Finance Assistant secrets.
6. Deploy code with both write/observer switches still false.
7. Check `/api/health/treasury-watcher`: expected `READY_DARK`; no secret value may appear.
8. Verify ordinary Finance, public Budget, Patrons, Work plan, and Breath pages remain available if the OpenAI provider is absent.

## Migration gate

Human approval is required before targeted application of:

- `0165_treasury_finance_assistant_confirmations.sql`
- `0166_treasury_finance_assistant_confirmations_rls.sql`

After apply, verify:

- RLS enabled;
- all privileges revoked from `anon` and `authenticated`;
- four deny policies present;
- update/delete triggers present;
- nonce digest uniqueness present;
- table contains no prompt or financial-value columns.

Do not run a blind full production migration command. Use the repository’s targeted production migration procedure.

## Wallet registration gate

1. Human checks the public address in TronScan and independently compares it with the actual Treasury wallet.
2. Human registers it in Finance → Wallet with network `TRC-20`, asset `USDT`, and canonical contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`.
3. Human records an audit reason.
4. Confirm the Wallet screen still reports `READY_DARK` and no checkpoint.

## First observation gate

1. Human confirms the ledger inception and watcher start block.
2. Human enables `TREASURY_WATCHER_ENABLED=true` for one scheduled cycle.
3. Inspect the checkpoint, provider outcome, observations, and generated semantic transactions.
4. Confirm every generated transaction is `NEEDS_REVIEW`, tenant-scoped, and linked to the expected public address/TronScan transaction.
5. Compare the observed result against the independent secondary provider.
6. If any mismatch exists, immediately set `TREASURY_WATCHER_ENABLED=false`; do not delete or rewrite observations.
7. Only after a clean first cycle may continuous scheduled observation remain enabled.

## Finance Assistant write gate

1. Confirm migrations `0165`/`0166` and the dedicated signing secret are present.
2. Confirm report requests work while writes remain disabled.
3. Enable `WAIA_FINANCE_ASSISTANT_WRITES_ENABLED=true`.
4. Preview and confirm one disposable non-financial catalog record in a staging organization.
5. Attempt the same token twice; the second attempt must return `ASSISTANT_CONFIRMATION_ALREADY_USED`.
6. Confirm the audit record contains no prompt or secret and the receipt stores only digests.
7. Confirm transaction creation produces only a `NEEDS_REVIEW` manual draft.

## Publication gate

1. Human reviews allocation evidence, patron shares, monthly/annual budgets, and public transaction visibility.
2. Human performs the existing audited publication action.
3. Confirm public Breath exposes only published facts; unavailable facts remain visibly pending.

## Rollback

- Disable `WAIA_FINANCE_ASSISTANT_WRITES_ENABLED`; reports and ordinary Finance continue.
- Disable `TREASURY_WATCHER_ENABLED`; already observed evidence remains append-only for review.
- Revoke/rotate provider keys if provider access is suspect.
- Revert application deployment to the previous reviewed SHA if UI/API behavior regresses.
- Do not delete confirmation receipts, chain observations, semantic transactions, allocation evidence, or audit rows.
- Database restore is a last resort for database failure only and requires a separate Human incident decision.

## Completion evidence

Record the deployed SHA, migration list, backup ID, health state, first checkpoint time, count of observations/transactions, replay-test outcome, R2 check, public-page screenshots, and Human approver. Do not record any secret value.
