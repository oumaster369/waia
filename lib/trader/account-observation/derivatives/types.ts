/** Derivatives account display identities are deliberately separate from spot account IDs. */
export const HTX_DERIVATIVES_ACCOUNT_FAMILIES = [
  "usdt_isolated_perpetual",
  "usdt_cross_shared",
  "coin_perpetual",
  "coin_delivery_futures",
] as const;

export type HtxDerivativesAccountFamily = typeof HTX_DERIVATIVES_ACCOUNT_FAMILIES[number];

export type HtxDerivativesObservationBinding = Readonly<{
  organizationId: string;
  credentialId: string;
  credentialRevision: string;
}>;

export type HtxDerivativesReadAdmissionRequest = Readonly<{
  binding: HtxDerivativesObservationBinding;
  family: HtxDerivativesAccountFamily;
  accessKeySha256: string;
}>;

/** No aggregate valuation is computed across collateral assets or account families. */
export type HtxDerivativesAccountRow = Readonly<{
  accountCode: string;
  collateralAsset: string | null;
  marginMode: "isolated" | "cross" | null;
  marginBalance: string | null;
  marginAvailable: string | null;
  /** Venue transfer availability, distinct from margin available to open positions. */
  withdrawAvailable: string | null;
  marginPosition: string | null;
  marginFrozen: string | null;
  marginStatic: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  riskRate: string | null;
  liquidationPrice: string | null;
  leverage: string | null;
}>;

export type HtxDerivativesAccountSnapshot = Readonly<{
  schemaVersion: "htx-derivatives-account/v1";
  family: HtxDerivativesAccountFamily;
  accounts: readonly HtxDerivativesAccountRow[];
  /** HTX ts is response-generation time, not a per-balance freshness timestamp. */
  responseGeneratedAtMs: number | null;
}>;

/** One venue-reported open futures position; all quantities/prices remain exact
 * decimal strings. Collateral identity is data, not a cross-family total. */
export type HtxDerivativesPositionRow = Readonly<{
  symbol: string;
  contractCode: string;
  contractType: string | null;
  direction: "buy" | "sell";
  volume: string | null;
  available: string | null;
  frozen: string | null;
  costOpen: string | null;
  costHold: string | null;
  unrealizedPnl: string | null;
  profitRate: string | null;
  positionMargin: string | null;
  marginAsset: string | null;
  leverage: string | null;
  lastPrice: string | null;
  liquidationPrice: string | null;
}>;

export type HtxDerivativesPositionsSnapshot = Readonly<{
  schemaVersion: "htx-derivatives-positions/v1";
  family: HtxDerivativesAccountFamily;
  positions: readonly HtxDerivativesPositionRow[];
  /** HTX ts labels response generation, not per-position freshness. */
  responseGeneratedAtMs: number | null;
}>;
