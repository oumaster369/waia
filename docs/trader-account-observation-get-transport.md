# DEE-960 — bounded HTX GET transport, local implementation

`lib/trader/account-observation/htx-get-transport.ts` implements the transport port
used by the local HTX observation reader. It is server-only, not a deployed service.
The caller supplies network I/O, clock, previously authorized key material and a
current exact-key/account read-admission verifier. There is no default fetch,
environment lookup, credential decryption, account discovery or startup side effect.

## Enforced boundary

- Only HTTPS `api.huobi.pro` and `api-aws.huobi.pro`; host/path cannot be supplied
  by a per-request caller. Paths are limited to exact-account balance, ordinary
  open orders, symbol/window-bounded match results and numeric order detail.
- GET only. Strict query schemas exclude signature overrides, arbitrary fields,
  alternate account IDs, unconfigured symbols and windows exceeding 48 hours.
  Order-detail responses still require the reader's separate exact-account proof.
- Existing pure GET signer creates the canonical HMAC-SHA256 query. The broader
  connector/client and all POST/order/cancel/transfer methods are excluded.
- Exact immutable binding and SHA256 of the actual access key are passed to the
  admission verifier before network access and before returning response data.
  A supplied `true` test verifier is a fixture, not proof of production admission.
  Runtime repository fencing remains necessary at commit after these checks.
- Redirect following is disabled; any redirect response or changed response URL
  is rejected. Cookies are omitted, caching disabled, and no signed URL/key/body
  is logged. Exceptions are replaced with fixed observation error codes.
- Enforced maximum streamed response bytes is checked before UTF-8 decoding/JSON
  parsing. Declared over-limit length and malformed UTF-8 refuse the response.
  Non-200 bodies are discarded; status is retained for reader classification.
- Whole-request timeout includes admission, headers, stream and final admission.
  Caller abort/disposal cancels waiting and releases the owned response stream;
  late responses are cancelled rather than returned. A failed/aborted transport
  is terminal and cannot be reused. Successful reads are serialized.
- Transport cancellation requires an AbortSignal-respecting network adapter to
  guarantee underlying socket release. An arbitrary injected function cannot be
  forcibly terminated by JavaScript; tests verify fail-closed return/reuse behavior.
- Disposal drops owned key references; it does not promise secure erasure of
  immutable JavaScript strings or copies retained by the caller.

## Local evidence and remaining acceptance

49 synthetic-key/mock-network tests cover canonical signature construction,
identity/admission denial before and after reading, allowlists, redirect/error
handling, byte/encoding bounds, timeout/abort/disposal and late-response cleanup.
A composed reader+transport test checks balances, ordinary orders and account-proven
trades from mocked raw REST responses. It preserves null source/update times and
PARTIAL coverage. No HTTP request was sent to HTX.

The dedicated `account-observation-postgres.yml` workflow runs all three
account-observation integration suites serially with explicit local-only opt-in.
Account/UI-only changes do not thereby schedule unrelated historical proofs.
The existing `postgres-integration.yml` is unchanged, with a
regression contract against accidental omission or soft failure. This is authored
CI configuration plus local execution proof, not a completed GitHub CI run.

Remaining: trusted assignment provisioning, wiring the current exact-key admission
verifier and approved credential opener, authorized production role/pool/runtime
deployment, actual read-only account qualification and both-panel acceptance.
Conditional-order/market-buy/rebate/points coverage and full positions/accounting
remain separate explicit gaps. This transport grants no live/capital authority.

Protocol reference verified 2026-09-09:
[official HTX spot authentication](https://huobiapi.github.io/docs/spot/v1/en/#authentication).
HTTP method, lowercase host, path and sorted URL-encoded parameters form the signature;
these tests use synthetic keys, not the user's credentials.

## Local runtime opener composition

`htx-reader-opener.ts` connects the runtime's `openReader(binding, signal)` port
to this transport and the HTX reader. It checks a separately supplied open
authorization before key access, validates all five returned binding fields and
checks the digest of the actual key against current read admission before
constructing the transport. Each subsequent request retains transport admission
checks. No existing broad trading connector or permissive metadata parser is used.

The OPEN deadline covers authorization, key adapter and final admission. Timeout
or cancellation prevents use of a late key and releases its handle once. On
successful return, OPEN cancellation is detached: the domain service aborts its
open timer immediately, while each later read has its own signal. Reader disposal
closes the transport and credential handle; errors are classified without raw
adapter messages. This does not promise erasure of JavaScript strings.

17 local tests cover this composition, including a domain-service commit with
mocked storage and raw HTTP responses. Combined opener/transport/reader/runtime/
Reality checks: 135/135 PASS. Independent read-only review found no proven P1/P2
within the opener scope. These are not production credentials or admission proof.

The recurring PostgreSQL17 integration now uses this opener plus the real signer,
transport and reader, with synthetic keys and an in-memory HTTP adapter. It proves
two persisted cycles, handle release, stored cadence after runtime restart and
revoked-binding refusal. The affected PostgreSQL suite passes 19/19 tests under
the existing constrained collector role. Admission callbacks remain explicit
fixtures; no assertion of real HTX or production-key verification follows.

The trusted implementations of `authorizeOpen`, `openCredential`,
`verifyReadAdmission` and account assignment loading still require integration
and separate production acceptance. They are not replaced by test callbacks in
any production startup; no new process starts on import.

## DB-backed assignment filtering

`createPostgresObservationAssignmentSource(sql, configured)` now supplies concrete
`loadAssignments` and `authorizeOpen` functions. The input is an explicitly
authorized list of at most 20 exact bindings/configurations, not browser input or
automatic discovery. It is copied and validated, including configuration digest
and duplicate-account rejection. Every load/open check uses the dedicated
read-only PostgreSQL role and a scoped joined query of current credential and
collection metadata; no key columns, new grants or migrations are needed.

The database check requires the stored active credential revision, organization,
account, configuration revision and exact symbol list to match. Revoked, missing
or changed assignments are filtered out. A new revision is never adopted without
replacing the explicitly authorized input list. Database errors are failures,
not permission to use a cached list. Cancelled results are discarded; concurrent
loads are refused until the outstanding query settles. Existing SQL timeouts and
the caller's bounded dedicated pool limit in-flight work. This is a per-account
snapshot; opener/transport/commit fences remain necessary after loading.

This closes read-only database filtering, not operator provisioning or venue
admission. A collection row alone does not authorize decrypting a key or accessing
an exchange. Supplying the authorized list, the approved credential store adapter
and exact-key permission verification remain production integration obligations.

Validation for this slice: 10 assignment unit checks, 5 runtime checks and 6
Reality graph checks PASS; dedicated-reader PostgreSQL17 suite 11/11 PASS,
including new exact-assignment/rotation/symbol-drift cases. Typecheck, scoped
lint and diff checks PASS. Independent bounded review found no proven P1/P2.
The database validation retained real restricted roles and RLS following the
Supabase security guidance; no privileged fallback or permission expansion was
added. Production data, secrets, calculations and deployments were not touched.
