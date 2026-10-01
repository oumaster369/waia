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
