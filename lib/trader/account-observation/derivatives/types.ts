/** Derivatives account display identities are deliberately separate from spot account IDs. */
export const HTX_DERIVATIVES_ACCOUNT_FAMILIES = [
  "usdt_isolated_perpetual",
  "usdt_cross_shared",
  "coin_perpetual",
  "coin_delivery_futures",
] as const;

export type HtxDerivativesAccountFamily = (typeof HTX_DERIVATIVES_ACCOUNT_FAMILIES)[number];

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

/** Official match-results queries allow 48 hours. This display uses a stricter window. */
export const HTX_DERIVATIVES_FILL_LOOKBACK_MS = 86_400_000;
export const HTX_DERIVATIVES_FILL_MAX_PAGES = 3;
export const HTX_DERIVATIVES_FILL_MAX_ROWS = 100;
export const HTX_DERIVATIVES_FILL_CONTRACT_LIMIT = 8;

/** Closed contract identity for fill history. Open positions are not this set. */
export type HtxDerivativesFillContract = Readonly<{
  family: HtxDerivativesAccountFamily;
  contract: string;
}>;

/** One executed fill. `id` is the unique fill identity; match and order ids are not. */
export type HtxDerivativesFillRow = Readonly<{
  id: string;
  matchId: string | null;
  orderId: string | null;
  symbol: string;
  contractCode: string;
  contractType: string | null;
  direction: "buy" | "sell";
  offset: "open" | "close" | "both";
  volume: string | null;
  price: string | null;
  fee: string | null;
  feeAsset: string | null;
  realizedPnl: string | null;
  offsetPnl: string | null;
  executedAtMs: number | null;
  orderSource: string | null;
}>;

export type HtxDerivativesFillsPage = Readonly<{
  schemaVersion: "htx-derivatives-fills/v1";
  family: HtxDerivativesAccountFamily;
  contractCode: string;
  fills: readonly HtxDerivativesFillRow[];
  /** Safe max query_id for the next page. Null means pagination cannot continue. */
  nextFromId: string | null;
  responseGeneratedAtMs: number | null;
}>;

export function isHtxDerivativesFillContract(
  family: HtxDerivativesAccountFamily,
  contract: string,
): boolean {
  if (family === "usdt_isolated_perpetual") return /^[A-Z0-9]+-USDT$/.test(contract);
  if (family === "usdt_cross_shared") return /^[A-Z0-9]+-USDT(?:-\d{6})?$/.test(contract);
  if (family === "coin_perpetual") return /^[A-Z0-9]+-USD$/.test(contract);
  return /^[A-Z0-9]+\d{6}$/.test(contract);
}
