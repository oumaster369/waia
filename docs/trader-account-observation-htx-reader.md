# DEE-960: local HTX observation reader

Subsequent local integration added the explicit bounded GET transport in
`htx-get-transport.ts`; see [its boundary and evidence](trader-account-observation-get-transport.md).
The reader still has no default transport. Production credential opening,
current admission wiring, deployment and real account qualification remain pending.

`lib/trader/account-observation/htx-reader.ts` supplies the observation reader port through
an explicitly injected, already admitted signed-GET transport. It neither opens credentials
nor provides a network/signing implementation. No account, production call or deployment
has been qualified by the local mock tests.

The transport contract requires an exact organization/credential/account/revision binding,
the four allowed read endpoint forms, cancellation and a response byte limit enforced during
streaming before parsing. The reader independently checks returned binding, HTTP status,
body byte length, JSON envelope, row identity, decimals, timestamps and row/page budgets.
The caller's cancellation, reader disposal and a component-wide deadline interrupt waiting
even when an injected transport ignores cancellation; late responses cannot be returned.
Transport errors are converted to fixed safe codes. Actual transport resource release and
signature/key admission still need their own implementation and qualification.

Balances require an active spot account with the exact returned account ID. Decimal addition
uses integer arithmetic without floating-point rounding. Unknown balance types, malformed
values and repeated currency/type buckets refuse the component; a successfully returned empty
list is observed zero. Missing opposite trade/frozen buckets in a complete list aggregate as
zero of that bucket. No price, valuation, strategy position, cost basis or PnL is inferred.

Ordinary open orders are paged with an explicit account ID, with every row's returned account
ID checked. Unsupported mechanics refuse the component; market-buy quote amounts are never
relabelled as base quantity. Creation time is retained; update time stays null because the
endpoint supplies no such timestamp. Open orders remain PARTIAL because the separate
pre-trigger conditional-order endpoint is not collected. Page/record limits and repeated
cursor rows also remain PARTIAL, preserving only previously verified rows.

Trades are requested for explicitly configured compact symbols over a bounded recent window.
`BTC/USDT` is explicitly normalized to `BTCUSDT`, then `btcusdt` on the venue request; no
heuristic base/quote inference is used. Match results do not identify their account: each
distinct order is fetched and must prove the exact account, symbol, order ID and side before
its matches are published. Unavailable order details refuse the component, never authorize
relabeling. Internal match IDs drive paging; trade IDs identify rows. The returned match-record
creation timestamp is preserved as the existing trade DTO's reported time; it is not a
snapshot timestamp or an independent proof of exchange execution timing. Recent history is
always PARTIAL, including an empty response. Rebates and additional fee-point payments cannot
fit the current single nonnegative fee field, so those rows refuse the component.

All sourceAsOfMs values remain null: these endpoints provide no shared account snapshot time.
The service records its own collection windows. This reader never produces a complete
whole-account observation, because orders and trade-history coverage are deliberately partial.
Scheduling must distinguish expected partial coverage from actual collection errors.

Reference checked 2026-09-09: the official [HTX spot REST reference](https://huobiapi.github.io/docs/spot/v1/en/),
specifically balance, open orders, order detail and match results. It documents account IDs
on balances/orders, match-history window/paging, and signed read permissions. Live compatibility
and account permissions remain unverified. The existing broader connector was inspected but
is not reused: it exposes write capabilities, has a default network client, converts balances
through floating point and can substitute missing open-order data with an empty list.
