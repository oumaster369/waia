/** v1 == sell-fill-only closed trade counting (legacy, pre-M0 repair). */
export const CLOSED_TRADE_SEMANTICS_VERSION_V1 = "waia.trader.closed-trade.v1" as const;

/** v2 == explicit round-trip taxonomy + forced-flat mark-to-close (M0 Phase 2). */
export const CLOSED_TRADE_SEMANTICS_VERSION = "waia.trader.closed-trade.v2" as const;

/** v1 == nominal placeholder before persisted entity model (pre-M1). */
export const TRADE_LIFECYCLE_SEMANTICS_VERSION_V1 = "waia.trader.trade-lifecycle.v1" as const;

export {
  TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
  TRADE_LIFECYCLE_SEMANTICS_VERSION,
} from "@/lib/trader/lifecycle/trade-lifecycle-semantics";
