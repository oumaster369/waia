---
integrationIssue: DEE-956
integrationTitle: "HTX admission: exact identity and fail-closed permission metadata"
branch: dee-956-htx-exact-admission
riskTier: T3
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit, tenant-isolation, lint, typecheck, build, canon, independent-exact-head-review]
approvalGates: [human-security-review, human-merge, human-production-rollout]
state:
  status: in-progress
  prNumber: null
  prUrl: null
  blockedReason: null
provenance:
  authoritativeBase: b5c17263465fc525dd46eab8c8a076b1abde1a69
  createdFrom: user-authorized-parallel-completion-dee-944-dee-171
---

# DEE-956 — Exact HTX admission

## Context and goal

Verified defects: API-key metadata falls back to another row; the connector selects the first
working spot account; permission-probe failures admit an unknown key and fabricate READ scope;
the secure resolver drops the stored account identity on connector construction.

Correct these existing security-contract failures with bounded local changes, not a live-plane
rewrite. Root integration owns Linear, publication and subsequent review. This plan precedes code.

## Scope and files

- `lib/trader/connectors/htx/client.ts`: reject malformed identity responses; exact unique key match.
- `lib/trader/connectors/htx/htx-exchange-connector.ts`: bind input to constructor credentials,
  reject ambiguous/malformed account identity, honor internal expected account, reject unknown or
  failed permission metadata, expired key and explicit forbidden/unknown permission tokens.
- `lib/trader/security/htx-secure-credential-resolver.ts`: retain stored account identity in internal
  connector configuration, reject missing identity rather than fabricate it.
- `lib/trader/credentials/connect-handler.ts`: if needed, verify account-info/validation identity
  consistency before persistence; no storage/encryption/tenant mutation redesign.
- `lib/trader/{balances,positions,trade-history}/sync-handler.ts`: propagate the already stored
  expected account and reject a different validation identity before fetching or snapshot writes.
- `lib/trader/connectors/registry.ts`, `lib/trader/live/live-connector.ts`: preserve that internal
  binding through existing factory construction and reject failed validation; no new live authority.
- Focused connector, secure-resolver, connect-route and tenant-isolation unit tests.
- Existing balance/position/trade-history sync route tests add exact-account mismatch checks.
- Reality inventory mechanical content pin only if changed source paths are tracked; no classification
  or validator weakening.

## Frozen boundaries / Do NOT

No new account-selection API, schema, migration, real exchange call, credentials, live activation,
capital, blind holdout, RLS change, production write, push, merge or deployment. No new permission
or venue-write authority. Historical graph and scientific corpus unchanged.

Recognized `readOnly,trade` retains current compatibility behavior and warning; this does not prove
absence of transfer or account-management capability. Official HTX docs expose those actions under
Trade. The canon's structural TRANSFER prohibition therefore remains a separate live-admission
blocker, not waived or solved by this patch. Metadata policy flags are not exchange capability proof.

## Acceptance

1. Only one exact API-key metadata row can validate the configured credentials; no unrelated fallback.
2. Unknown/denied/malformed/timeout permission probes do not admit credentials or invent READ.
3. New onboarding has exactly one valid working spot account; ambiguity fails closed.
4. Existing stored expected account is retained internally and mismatch fails closed.
5. Failed revalidation clears prior usable state; caller credentials cannot validate a different
   constructor's client. Errors must not expose synthetic or actual credential values.
6. Rejected admission performs no credential insert/replacement; existing tenant isolation remains.
7. Focused tests, lint/typecheck/build and canon are recorded honestly; full PR CI/review remain
   required, not replaced by local results. No full Trader/live readiness claim follows this slice.

## Validation plan

Run focused mocked connector/client + route/lifecycle/tenant tests, then typecheck, lint, build and
canonical checks. Test exact second-row success, unrelated/duplicate key, missing/invalid UID,
empty/malformed permissions, denied/timeout probes, forbidden scopes, expired status, ambiguous
accounts, stored-account mismatch, failed revalidation and unchanged valid read-only path.

## Source evidence

HTX official API reference, inspected 2026-09-07:
https://huobiapi.github.io/docs/spot/v1/en/#query-api-key
API-key status is `normal` or `expired`; `readOnly`/`trade` are recognized metadata tokens.
This is documentation review only, not a real account capability test.

## Verification results

Local implementation completed on the authoritative base above; all exchange responses and
credential material in tests are synthetic. No actual exchange/account request was made.

- Baseline reproducer before fixes: 29 failed / 4 passed (33 tests), confirming the admission
  defects against the unmodified base. Subsequent tests expanded coverage rather than weakening it.
- Final focused run: 11 files / 169 tests PASS. Includes exact admission (38), connector (34),
  connect route (23), security foundation (11), HTX/credential tenant isolation (2 + 5),
  balance/position/trade sync routes (14 + 14 + 17), live CLI dependency/wiring mocks (2 + 9).
  The PostgreSQL-named CLI tests are mocked wiring tests, not a real database integration run.
- Reality graph validator PASS; its separate regression file has 4 tests PASS. Counts remain
  154 source paths / 124 consumer paths / 25 connector references. Only content pins changed;
  no path/classification/assertion/validator change.
- Whole-repository lint: zero errors, 307 existing warnings. Targeted changed-file lint passed.
- Final `tsc --noEmit` PASS; `next build` PASS after source freeze (compiled 7.2 seconds,
  build typecheck 39.6 seconds, 16/16 static pages). Existing middleware deprecation warning remains.
- Canonical validator: 8 regression cases PASS, 136 documents checked, all 3 release-identity
  contracts PASS. Final changed-production-file/new-test lint and `git diff --check` PASS.

Mechanical inventory content digest evidence, independently recalculated against base blobs:

| Surface | Base digest | New digest |
| --- | --- | --- |
| Sources | `967c4686a3f8b8147904b86584bd4a4ac6e8ab6a694db4136da2ff8ed82127fb` | `28b72be916300f75893d5f7e79a4164179c06b49e469c0b2b063c4f67156156b` |
| Consumers | `8cb37a273a6e2563a6a381a5bf46abcf0de08178ba7f14a82fdbac219861a814` | `4c2cb039be5a5b0e15a294ee99293b01cd2865d841b54fd0794616a7693c7cc9` |

Source path digest remains `d5f2b4b0f3642e52cb8aa1270105d66a4e3286b1d29ae26472bb3a02b951fd31`;
consumer path digest remains `b394bbd99341c0a868dc3b2e05a6743163a67fec8d70103de70cde858c9f082d`.

Earlier local setup failures were not PASS: sandbox loopback restriction and an external dependency
symlink prevented Next.js builds. The agent-owned symlink was replaced with an isolated dependency
copy; no source/configuration/security bypass was introduced. An expected strict resolver-config
test was updated for the added internal account binding; a test-only literal type error was fixed.

## Remaining gates and limitations

Independent exact-head security review, publication/CI, merge and production rollout remain pending.
This slice does not establish historical-run PASS, read-only account admission, real-account
reconciliation, live authority or full Trader readiness. Multiple working spot accounts deliberately
remain refused until a separate user-selection contract exists.

The resolver's existing fallback for missing stored permission metadata still produces policy flags;
this patch does not turn those flags into venue capability evidence. Likewise HTX Trade permission
does not prove structural transfer prohibition. Both remain explicit live-admission gaps.
