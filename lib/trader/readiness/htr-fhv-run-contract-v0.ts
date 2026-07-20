import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import {
  assertHtrHistoricalCostModelMatch,
  HTR_HISTORICAL_COST_MODEL_DIGEST,
  HTR_HISTORICAL_COST_MODEL_FEE_BPS,
  HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS,
  HTR_HISTORICAL_COST_MODEL_ID,
  HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS,
  HTR_HISTORICAL_COST_MODEL_SCHEMA_VERSION,
  HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";
import { D20_DRAWDOWN_POLICY_VERSION } from "@/lib/trader/risk/drawdown-policy.types";
import { addDecimal } from "@/lib/trader/risk/numeric";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const HTR_FHV_RUN_CONTRACT_LEGACY_COST_MODEL_VERSION =
  HTR_HISTORICAL_COST_MODEL_SCHEMA_VERSION;

/** WP23 readiness compat pin: combined half-spread + impact for legacy candidate fields. */
export const HTR_FHV_RUN_CONTRACT_LEGACY_COST_MODEL_SLIPPAGE_BPS = addDecimal(
  HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS,
  HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS,
);

export const HTR_FHV_RUN_CONTRACT_SCHEMA_VERSION = "htr-fhv-run-contract/v0" as const;

/** WP12 evidence-bundle manifest semantic digest — pinned for readiness preflight. */
export const HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN =
  "fd7d489595f8fc20e4311c74e5d82b2957e7cca5b80319b8cb8d5f0893544663" as const;

export const HTR_FHV_DATASET_SOURCE_CLASSIFICATION = "NOT_AVAILABLE" as const;

export type HtrFhvRunContractInitialPortfolioV0 = Readonly<{
  quoteCurrency: "USDT";
  cashUsdt: "100000";
  btcQuantity: "0";
  ethQuantity: "0";
  leverage: 0;
  borrowing: "PROHIBITED";
  shortSelling: "PROHIBITED";
  externalDepositsDuringRun: 0;
  externalWithdrawalsDuringRun: 0;
  portfolioMode: "SHARED_MULTI_INSTRUMENT";
}>;

export type HtrFhvRunContractV0 = Readonly<{
  schemaVersion: typeof HTR_FHV_RUN_CONTRACT_SCHEMA_VERSION;
  contractId: "FULL_HISTORICAL_VALIDATION_RUN_CONTRACT_V0";
  executionPhase: "AFTER_DEE_415_AND_CERTIFY_HTR_READY";
  venue: "HTX";
  venueScope: "HTX_ONLY";
  marketType: "SPOT";
  instruments: readonly ["BTCUSDT", "ETHUSDT"];
  symbols: readonly ["BTCUSDT", "ETHUSDT"];
  venueClass: "spot";
  primaryInterval: "1m";
  baseInterval: "1m";
  derivedIntervals: readonly ["15m", "1h", "4h", "1d"];
  derivedIntervalRule: "CLOSED_BARS_ONLY";
  d11bDatasetVenueRole: "D11B_INFRASTRUCTURE_QUALIFICATION_ONLY";
  fullPeriod: { startUtc: "2020-01-01T00:00:00.000Z"; endUtc: "2025-12-31T23:59:00.000Z" };
  developmentCalibration: {
    startUtc: "2020-01-01T00:00:00.000Z";
    endUtc: "2022-12-31T23:59:00.000Z";
  };
  walkForward: {
    startUtc: "2023-01-01T00:00:00.000Z";
    endUtc: "2024-12-31T23:59:00.000Z";
  };
  blindHoldout: {
    startUtc: "2025-01-01T00:00:00.000Z";
    endUtc: "2025-12-31T23:59:00.000Z";
    status: "SEALED_NOT_ACCESSED";
  };
  partitions: typeof FHV_DATASET_PARTITIONS_V1;
  initialPortfolio: HtrFhvRunContractInitialPortfolioV0;
  costModelId: typeof HTR_HISTORICAL_COST_MODEL_ID;
  costModelSchemaVersion: typeof HTR_HISTORICAL_COST_MODEL_SCHEMA_VERSION;
  feeBps: typeof HTR_HISTORICAL_COST_MODEL_FEE_BPS;
  halfSpreadBps: typeof HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS;
  marketImpactBps: typeof HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS;
  slippageModel: typeof HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL;
  costModelDigest: typeof HTR_HISTORICAL_COST_MODEL_DIGEST;
  /** WP23 readiness compat — excluded from contract semantic digest. */
  costModelVersion: typeof HTR_FHV_RUN_CONTRACT_LEGACY_COST_MODEL_VERSION;
  /** WP23 readiness compat — excluded from contract semantic digest. */
  costModelFeesBps: typeof HTR_HISTORICAL_COST_MODEL_FEE_BPS;
  /** WP23 readiness compat — excluded from contract semantic digest. */
  costModelSlippageBps: typeof HTR_FHV_RUN_CONTRACT_LEGACY_COST_MODEL_SLIPPAGE_BPS;
  drawdownPolicyVersion: typeof D20_DRAWDOWN_POLICY_VERSION;
  maxAccountDrawdownPct: 25;
  maxMonthlyDrawdownPct: 15;
  maxStrategyDrawdownPct: 20;
  breachAction: "CLOSE_ONLY_THEN_STOP_ACCOUNT";
  hwmBasis: "PEAK_EQUITY_MARK_TO_MARKET";
  billingHwmDistinct: true;
  datasetManifestSemanticDigestPin: typeof HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN;
  datasetSourceClassification: typeof HTR_FHV_DATASET_SOURCE_CLASSIFICATION;
  holdoutAccess: "PROHIBITED_UNTIL_OPERATOR_PROCEDURE";
  silentDatasetSubstitution: "PROHIBITED";
}>;

export const HTR_FHV_RUN_CONTRACT_V0: HtrFhvRunContractV0 = {
  schemaVersion: HTR_FHV_RUN_CONTRACT_SCHEMA_VERSION,
  contractId: "FULL_HISTORICAL_VALIDATION_RUN_CONTRACT_V0",
  executionPhase: "AFTER_DEE_415_AND_CERTIFY_HTR_READY",
  venue: "HTX",
  venueScope: "HTX_ONLY",
  marketType: "SPOT",
  instruments: ["BTCUSDT", "ETHUSDT"],
  symbols: ["BTCUSDT", "ETHUSDT"],
  venueClass: "spot",
  primaryInterval: "1m",
  baseInterval: "1m",
  derivedIntervals: ["15m", "1h", "4h", "1d"],
  derivedIntervalRule: "CLOSED_BARS_ONLY",
  d11bDatasetVenueRole: "D11B_INFRASTRUCTURE_QUALIFICATION_ONLY",
  fullPeriod: {
    startUtc: "2020-01-01T00:00:00.000Z",
    endUtc: "2025-12-31T23:59:00.000Z",
  },
  developmentCalibration: {
    startUtc: "2020-01-01T00:00:00.000Z",
    endUtc: "2022-12-31T23:59:00.000Z",
  },
  walkForward: {
    startUtc: "2023-01-01T00:00:00.000Z",
    endUtc: "2024-12-31T23:59:00.000Z",
  },
  blindHoldout: {
    startUtc: "2025-01-01T00:00:00.000Z",
    endUtc: "2025-12-31T23:59:00.000Z",
    status: "SEALED_NOT_ACCESSED",
  },
  partitions: FHV_DATASET_PARTITIONS_V1,
  initialPortfolio: {
    quoteCurrency: "USDT",
    cashUsdt: "100000",
    btcQuantity: "0",
    ethQuantity: "0",
    leverage: 0,
    borrowing: "PROHIBITED",
    shortSelling: "PROHIBITED",
    externalDepositsDuringRun: 0,
    externalWithdrawalsDuringRun: 0,
    portfolioMode: "SHARED_MULTI_INSTRUMENT",
  },
  costModelId: HTR_HISTORICAL_COST_MODEL_ID,
  costModelSchemaVersion: HTR_HISTORICAL_COST_MODEL_SCHEMA_VERSION,
  feeBps: HTR_HISTORICAL_COST_MODEL_FEE_BPS,
  halfSpreadBps: HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS,
  marketImpactBps: HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS,
  slippageModel: HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL,
  costModelDigest: HTR_HISTORICAL_COST_MODEL_DIGEST,
  costModelVersion: HTR_FHV_RUN_CONTRACT_LEGACY_COST_MODEL_VERSION,
  costModelFeesBps: HTR_HISTORICAL_COST_MODEL_FEE_BPS,
  costModelSlippageBps: HTR_FHV_RUN_CONTRACT_LEGACY_COST_MODEL_SLIPPAGE_BPS,
  drawdownPolicyVersion: D20_DRAWDOWN_POLICY_VERSION,
  maxAccountDrawdownPct: 25,
  maxMonthlyDrawdownPct: 15,
  maxStrategyDrawdownPct: 20,
  breachAction: "CLOSE_ONLY_THEN_STOP_ACCOUNT",
  hwmBasis: "PEAK_EQUITY_MARK_TO_MARKET",
  billingHwmDistinct: true,
  datasetManifestSemanticDigestPin: HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN,
  datasetSourceClassification: HTR_FHV_DATASET_SOURCE_CLASSIFICATION,
  holdoutAccess: "PROHIBITED_UNTIL_OPERATOR_PROCEDURE",
  silentDatasetSubstitution: "PROHIBITED",
};

export function computeHtrFhvRunContractDigest(
  contract: HtrFhvRunContractV0 = HTR_FHV_RUN_CONTRACT_V0,
): string {
  const {
    costModelVersion: _costModelVersion,
    costModelFeesBps: _costModelFeesBps,
    costModelSlippageBps: _costModelSlippageBps,
    ...digestPayload
  } = contract;
  return computeSemanticSha256Hex(digestPayload as unknown as Record<string, unknown>);
}

export type HtrFhvRunCandidateInput = Partial<{
  venue: string;
  venueScope: string;
  marketType: string;
  symbols: readonly string[];
  baseInterval: string;
  derivedIntervals: readonly string[];
  derivedIntervalRule: string;
  cashUsdt: string;
  btcQuantity: string;
  ethQuantity: string;
  leverage: number;
  borrowing: string;
  shortSelling: string;
  portfolioMode: string;
  costModelId?: string;
  costModelSchemaVersion?: string;
  feeBps?: string;
  halfSpreadBps?: string;
  marketImpactBps?: string;
  slippageModel?: string;
  costModelDigest?: string;
  /** WP23 readiness compat candidate fields. */
  costModelVersion?: string;
  costModelFeesBps?: string;
  costModelSlippageBps?: string;
  drawdownPolicyVersion: string;
  maxAccountDrawdownPct: number;
  maxMonthlyDrawdownPct: number;
  maxStrategyDrawdownPct: number;
  breachAction: string;
  datasetManifestSemanticDigest: string;
  holdoutAccessRequested: boolean;
  blindHoldoutStatus: string;
  datasetSourceClassification: string;
  d11bDatasetAsFhvSubstitute: boolean;
}>;

export function assertHtrFhvRunContractMatch(input: HtrFhvRunCandidateInput): void {
  const contract = HTR_FHV_RUN_CONTRACT_V0;

  if (input.venue !== undefined && input.venue !== contract.venue) {
    throw new Error("HTR_WP23_FHV_CONTRACT:VENUE_MISMATCH");
  }
  if (input.venueScope !== undefined && input.venueScope !== contract.venueScope) {
    throw new Error("HTR_WP23_FHV_CONTRACT:VENUE_SCOPE_MISMATCH");
  }
  if (input.marketType !== undefined && input.marketType !== contract.marketType) {
    throw new Error("HTR_WP23_FHV_CONTRACT:MARKET_TYPE_MISMATCH");
  }
  if (input.symbols !== undefined) {
    const expected = [...contract.symbols].sort().join(",");
    const actual = [...input.symbols].sort().join(",");
    if (expected !== actual) {
      throw new Error("HTR_WP23_FHV_CONTRACT:SYMBOLS_MISMATCH");
    }
  }
  if (input.baseInterval !== undefined && input.baseInterval !== contract.baseInterval) {
    throw new Error("HTR_WP23_FHV_CONTRACT:BASE_INTERVAL_MISMATCH");
  }
  if (
    input.derivedIntervalRule !== undefined &&
    input.derivedIntervalRule !== contract.derivedIntervalRule
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:DERIVED_INTERVAL_RULE_MISMATCH");
  }
  if (input.cashUsdt !== undefined && input.cashUsdt !== contract.initialPortfolio.cashUsdt) {
    throw new Error("HTR_WP23_FHV_CONTRACT:INITIAL_CASH_MISMATCH");
  }
  if (
    input.btcQuantity !== undefined &&
    input.btcQuantity !== contract.initialPortfolio.btcQuantity
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:INITIAL_BTC_MISMATCH");
  }
  if (
    input.ethQuantity !== undefined &&
    input.ethQuantity !== contract.initialPortfolio.ethQuantity
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:INITIAL_ETH_MISMATCH");
  }
  if (input.leverage !== undefined && input.leverage !== contract.initialPortfolio.leverage) {
    throw new Error("HTR_WP23_FHV_CONTRACT:LEVERAGE_MISMATCH");
  }
  if (input.borrowing !== undefined && input.borrowing !== contract.initialPortfolio.borrowing) {
    throw new Error("HTR_WP23_FHV_CONTRACT:BORROWING_MISMATCH");
  }
  if (
    input.shortSelling !== undefined &&
    input.shortSelling !== contract.initialPortfolio.shortSelling
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:SHORT_SELLING_MISMATCH");
  }
  if (
    input.portfolioMode !== undefined &&
    input.portfolioMode !== contract.initialPortfolio.portfolioMode
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:PORTFOLIO_MODE_MISMATCH");
  }
  if (input.costModelId !== undefined && input.costModelId !== contract.costModelId) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_ID_MISMATCH");
  }
  if (
    input.costModelSchemaVersion !== undefined &&
    input.costModelSchemaVersion !== contract.costModelSchemaVersion
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_SCHEMA_VERSION_MISMATCH");
  }
  if (input.feeBps !== undefined && input.feeBps !== contract.feeBps) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_FEE_BPS_MISMATCH");
  }
  if (input.halfSpreadBps !== undefined && input.halfSpreadBps !== contract.halfSpreadBps) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_HALF_SPREAD_BPS_MISMATCH");
  }
  if (input.marketImpactBps !== undefined && input.marketImpactBps !== contract.marketImpactBps) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_MARKET_IMPACT_BPS_MISMATCH");
  }
  if (input.slippageModel !== undefined && input.slippageModel !== contract.slippageModel) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_SLIPPAGE_MODEL_MISMATCH");
  }
  if (input.costModelDigest !== undefined && input.costModelDigest !== contract.costModelDigest) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_DIGEST_MISMATCH");
  }
  if (
    input.costModelVersion !== undefined &&
    input.costModelVersion !== contract.costModelVersion
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_VERSION_MISMATCH");
  }
  if (
    input.costModelFeesBps !== undefined &&
    input.costModelFeesBps !== contract.costModelFeesBps
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_FEE_BPS_MISMATCH");
  }
  if (
    input.costModelSlippageBps !== undefined &&
    input.costModelSlippageBps !== contract.costModelSlippageBps
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:COST_MODEL_SLIPPAGE_BPS_MISMATCH");
  }

  assertHtrHistoricalCostModelMatch({
    modelId: contract.costModelId,
    schemaVersion: contract.costModelSchemaVersion,
    feeBps: contract.feeBps,
    halfSpreadBps: contract.halfSpreadBps,
    marketImpactBps: contract.marketImpactBps,
    slippageModel: contract.slippageModel,
    costModelDigest: contract.costModelDigest,
  });

  if (
    input.drawdownPolicyVersion !== undefined &&
    input.drawdownPolicyVersion !== contract.drawdownPolicyVersion
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:DRAWDOWN_POLICY_VERSION_MISMATCH");
  }
  if (
    input.maxAccountDrawdownPct !== undefined &&
    input.maxAccountDrawdownPct !== contract.maxAccountDrawdownPct
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:MAX_ACCOUNT_DRAWDOWN_MISMATCH");
  }
  if (
    input.maxMonthlyDrawdownPct !== undefined &&
    input.maxMonthlyDrawdownPct !== contract.maxMonthlyDrawdownPct
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:MAX_MONTHLY_DRAWDOWN_MISMATCH");
  }
  if (
    input.maxStrategyDrawdownPct !== undefined &&
    input.maxStrategyDrawdownPct !== contract.maxStrategyDrawdownPct
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:MAX_STRATEGY_DRAWDOWN_MISMATCH");
  }
  if (input.breachAction !== undefined && input.breachAction !== contract.breachAction) {
    throw new Error("HTR_WP23_FHV_CONTRACT:BREACH_ACTION_MISMATCH");
  }
  if (
    input.datasetManifestSemanticDigest !== undefined &&
    input.datasetManifestSemanticDigest !== contract.datasetManifestSemanticDigestPin
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:DATASET_MANIFEST_DIGEST_MISMATCH");
  }
  if (input.holdoutAccessRequested === true) {
    throw new Error("HTR_WP23_FHV_CONTRACT:HOLDOUT_ACCESS_PROHIBITED");
  }
  if (
    input.blindHoldoutStatus !== undefined &&
    input.blindHoldoutStatus !== contract.blindHoldout.status
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:BLIND_HOLDOUT_STATUS_MISMATCH");
  }
  if (
    input.datasetSourceClassification !== undefined &&
    input.datasetSourceClassification !== contract.datasetSourceClassification
  ) {
    throw new Error("HTR_WP23_FHV_CONTRACT:DATASET_SOURCE_CLASSIFICATION_MISMATCH");
  }
  if (input.d11bDatasetAsFhvSubstitute === true) {
    throw new Error("HTR_WP23_FHV_CONTRACT:D11B_DATASET_SUBSTITUTION_PROHIBITED");
  }
}
