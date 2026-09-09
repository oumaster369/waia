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
