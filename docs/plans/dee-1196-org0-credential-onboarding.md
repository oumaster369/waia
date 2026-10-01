---
integrationIssue: DEE-1196
integrationTitle: "Connect an Org0 HTX observation credential from Admin"
branch: dee-1196-org0-readonly-connect
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, isolated-postgres]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, independent-security-review, required-ci]
approvalGates: [user-authorized-technical-fix, independent-security-review, required-ci, no-production-migration]
state:
  status: implementation
  prNumber: null
  nextAction: "Implement and prove the Org0-only read credential connect path; no live activation."
provenance:
  createdFrom: "2026-10-01 approved DEE-1196 Org0 read-only Admin connect brief"
  supersedes: null
---

# DEE-1196 — Org0 read-only credential onboarding

Add a dedicated Admin GET/POST endpoint and matching Admin UI for the existing Org0 observation target. The server resolves `WAIA_TRADER_ORG0_ORGANIZATION_ID`; the only exchange account admitted is the nominated HTX spot account `73737331`. The request cannot choose an organization, account, venue, permissions or enrollment. The endpoint uses PostgreSQL in production. SQLite may support isolated UI fixtures only and must not silently store an Org0 credential.

Before any key handling or HTX request, require an authenticated Admin session, Trader entitlement, `admin.trader.operations.mutate`, and explicit membership in the resolved Org0. Recheck membership and permission before storing. POST additionally requires the Admin console's strict same-origin JSON check. A missing or invalid Org0 target fails closed. GET returns the fixed target and exactly the active matching credential's masked metadata or null; it does not decrypt or expose stored key material.

POST accepts only `apiKey`, `apiSecret`, and required `expectedActiveCredentialId` (UUID or null). It freshly validates the supplied key and secret using the exact-key HTX admission path, verifies a single working spot account equal to `73737331`, and accepts exclusively read-only permission. Trade, withdrawal, transfer, unknown or ambiguous scopes refuse. Then it invokes the canonical credential service to encrypt, audit and optimistically replace the active Org0 credential. It does not copy or decrypt a stored credential, enroll an observation assignment, change live enable, or invoke any trading connector method. Responses and errors contain no secret or ciphertext; logs and telemetry contain no request body or key fingerprint.

API: `GET /api/trader/admin/org0-readonly-connect` returns `{target:{organizationId,venue:"htx",exchangeAccountId:"73737331",marketType:"spot",requiredPermission:"read"},credential:CredentialMetadataDto|null}`. `POST` returns the same metadata-only shape on success. The route uses no cache.

## Acceptance

- Focused tests prove missing session, entitlement, Admin mutate grant, Org0 membership, target config, wrong account, ambiguous account, trade/unknown permission, malformed body, cross-origin and stale replacement all refuse before storage; auth failures perform no HTX request.
- Synthetic native PostgreSQL proves exact Org0 insert/rotate/audit, encrypted payload and masked response, stale optimistic conflict, cross-org isolation and no enrollment. No production key or venue call is used in tests.
- Existing personal credential history and endpoints remain unchanged. Local lint, typecheck, build, canonical validation and required CI pass; independent security review precedes publication or merge. This package does not qualify an observation collector, migrate production, or activate live trading.
