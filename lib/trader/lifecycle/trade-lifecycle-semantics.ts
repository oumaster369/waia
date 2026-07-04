/** v1 == nominal placeholder before persisted entity model (pre-M1). */
export const TRADE_LIFECYCLE_SEMANTICS_VERSION_V1 = "waia.trader.trade-lifecycle.v1" as const;

/** v2 == persisted Trade / PositionLot / TradeLeg entity model (M1). */
export const TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 = "waia.trader.trade-lifecycle.v2" as const;

/** Default for new lifecycle rows. */
export const TRADE_LIFECYCLE_SEMANTICS_VERSION = TRADE_LIFECYCLE_SEMANTICS_VERSION_V2;
