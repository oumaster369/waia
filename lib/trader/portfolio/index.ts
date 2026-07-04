export { PORTFOLIO_RISK_SEMANTICS_VERSION_V1 } from "@/lib/trader/portfolio/portfolio-semantics";
export type { PortfolioRiskSemanticsVersionV1 } from "@/lib/trader/portfolio/portfolio-semantics";

export {
  DEFAULT_PORTFOLIO_RUN_CONFIG,
  type PortfolioRunConfig,
} from "@/lib/trader/portfolio/portfolio-run-config.types";

export type {
  StopDistanceProvider,
  StopDistanceProviderInput,
  StopDistanceResult,
  StopDistanceSource,
} from "@/lib/trader/portfolio/stop-distance-provider.types";

export {
  defaultStopDistanceProvider,
  InvalidStopDistancePctError,
  resolveDefaultStopDistance,
} from "@/lib/trader/portfolio/default-stop-distance-provider";

export type {
  PortfolioAccountState,
  PortfolioPositionSnapshot,
  PortfolioSizingLimits,
} from "@/lib/trader/portfolio/portfolio-account.types";

export {
  computeStopBasedQuantity,
  trimQtyToAffordable,
  type ComputeStopBasedQuantityInput,
  type StopBasedSizingFailure,
  type StopBasedSizingResult,
  type StopBasedSizingSkipReason,
  type StopBasedSizingSuccess,
} from "@/lib/trader/portfolio/stop-based-sizing";

export {
  computeQuoteExposureUsdt,
  createInitialPortfolioAccountState,
  derivePortfolioAccountState,
  type DerivePortfolioAccountStateInput,
  type DerivePortfolioAccountStateSyncDeps,
} from "@/lib/trader/portfolio/derive-portfolio-account-state";

export {
  mergeProjectedOpenRisk,
  toAccountRiskState,
  withProjectedOrderRisk,
  type ToAccountRiskStateInput,
} from "@/lib/trader/portfolio/to-account-risk-state";
