---
integrationIssue: DEE-779
integrationTitle: "AI-TRADER User Surface — secure HTX credential lifecycle"
branch: dee-779-htx-credential-lifecycle
riskTier: T2
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit, postgres-integration, lint, typecheck, build, canon, pr-governance, independent-exact-head-review, dee-653]
approvalGates: [linear-groomed, independent-exact-head-review, dee-653]
state:
  status: in-review
  prNumber: 513
  prUrl: https://github.com/oumaster369/waia/pull/513
  blockedReason: null
provenance:
  authoritativeBase: 76e1b6e77e0596110541fd966f9249fd19e0c564
  createdFrom: user-authorized-ai-trader-program-controller
---

# DEE-779 — HTX credential lifecycle

## Objective

Provide a tenant-scoped user lifecycle for disconnect, revoke, reconnect and guarded atomic
replacement of HTX credentials. The lifecycle reuses the existing envelope-encryption authority and
never creates trading or capital authority.

## Frozen invariants

- Session and Trader entitlement are required for every lifecycle operation.
- Organization scope is derived from the authenticated user; it is never accepted from the client.
- Destructive credential mutation fails closed unless `Origin` matches the direct request origin or
  the configured canonical Trader origin used behind the trusted proxy.
- API secrets and ciphertext are write-only and never returned, logged or included in audit metadata.
- Revoke is soft, idempotent and tenant-scoped. A revoked credential cannot be decrypted.
- Replacement is guarded by the exact active credential id observed by the client. Missing/stale
  state fails closed with HTTP 409 before the prior credential is revoked.
- PostgreSQL replacement/revoke and their audit record execute in one database transaction.
- Reconnect without an active credential is allowed only when the caller asserts disconnected state.
- No live-enable, order submission, kill-switch, strategy promotion, or capital mutation is added.

## Admitted files

- `app/api/trader/exchange-credentials/[credentialId]/route.ts`
- `docs/ai-trader/reality-v2-source-consumer-inventory.json` (mechanical digest refresh only;
  no Reality rule, disposition, allowlist, scientific meaning, security boundary or capital authority change)
- `lib/trader/credentials/connect-api.types.ts`
- `lib/trader/credentials/connect-handler.ts`
- `lib/trader/credentials/credential-service.ts`
- `lib/trader/credentials/errors.ts`
- `lib/trader/credentials/index.ts`
- `lib/trader/credentials/repository-postgres.ts`
- `lib/trader/credentials/repository-sqlite.ts`
- `lib/trader/credentials/types.ts`
- `tests/unit/trader-credential-service.test.ts`
- `tests/unit/trader-htx-connect-route.test.ts`
- `tests/integration/postgres-trader-credential-lifecycle.test.ts`
- `docs/plans/dee-779-htx-credential-lifecycle.md`
- `docs/plans/dee-779-htx-credential-lifecycle.execution-manifest.json`

## Verification

- Focused lifecycle and route tests cover stale replacement, idempotent revoke, unknown/cross-tenant
  fail-close, missing/foreign Origin rejection, replay/audit uniqueness, secret non-disclosure and
  active-row preservation on conflict.
- Typecheck, lint, build and repository governance must pass.
- PostgreSQL authoritative CI, including concurrent conditional-revoke behavior, remains required
  before merge.

## Acceptance

- Authenticated, entitled Trader users can disconnect/revoke and reconnect HTX credentials without
  exposing plaintext secrets or choosing tenant scope.
- Replacement requires the exact active credential identity observed by the user; stale state
  returns a stable conflict before inserting new credentials.
- SQLite and PostgreSQL replacement/revoke plus audit are atomic and roll back on insert or audit
  failure; concurrent revoke retries are idempotent and produce one revoke audit.
- Existing credentials in another tenant are indistinguishable from absent credentials.
- No live enablement, order submission, strategy promotion, kill-switch or capital authority is
  introduced.
- Focused unit, authoritative PostgreSQL, typecheck, lint, build, canonical-doc validation, PR
  governance, exact-head independent review and DEE-653 all pass before squash merge.
