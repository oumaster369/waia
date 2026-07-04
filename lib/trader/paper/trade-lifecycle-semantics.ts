/** v1 == sell-fill-only closed trade counting (legacy, pre-M0 repair). */
export const CLOSED_TRADE_SEMANTICS_VERSION_V1 = "waia.trader.closed-trade.v1" as const;

/** v2 == explicit round-trip taxonomy + forced-flat mark-to-close (M0 Phase 2). */
export const CLOSED_TRADE_SEMANTICS_VERSION = "waia.trader.closed-trade.v2" as const;

/** Trade lifecycle semantics for open/close pairing and window-boundary valuation. */
export const TRADE_LIFECYCLE_SEMANTICS_VERSION = "waia.trader.trade-lifecycle.v1" as const;
