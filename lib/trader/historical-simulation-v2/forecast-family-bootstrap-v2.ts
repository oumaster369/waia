import { COMPONENT_LAYOUT_VERSION, MODEL_TRANSFORM_VERSION, QUANTIZER_VERSION } from
  "@/lib/trader/intelligence/forecast-v2/constants";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { ReplicaRootFamilyInput } from
  "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { FEATURE_VERSION, OUTCOME_VERSION } from
  "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

export const HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2 =
  "waia.trader.historical_forecast_family_bootstrap.v2" as const;

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** Build the frozen Forecast V2 family identity without placeholder or test-only digests. */
export function buildHistoricalForecastFamilyV2(input: Readonly<{
  organizationId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
  developmentDatasetDigestHex: string;
  releaseSha: string;
}>): ReplicaRootFamilyInput {
  const releaseSha = input.releaseSha.toLowerCase();
  if (!SHA.test(releaseSha) || !DIGEST.test(input.developmentDatasetDigestHex)) {
    throw new Error("HISTORICAL_FORECAST_FAMILY_REFUSED:IDENTITY");
  }
  const executionHorizonMinutes = input.primaryHorizonMinutes + 3;
  const terminalTargetDefinitionDigestHex = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.terminal_return_target_definition.v2",
    venue: "htx", market: "spot", symbol: input.symbol,
    returnDefinition: "log(P_t_plus_h/P_t)",
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    bucketCeremony: "development-type7-7-bucket/v1",
  });
  const executionOpportunityTargetDefinitionDigestHex = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.execution_opportunity_target_definition.v2",
    venue: "htx", market: "spot", symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    executionHorizonMinutes,
    componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
    outcomeVersion: OUTCOME_VERSION,
  });
  const normalizationVersionDigestHex = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.forecast_normalization.v2",
    componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
    quantizerVersion: QUANTIZER_VERSION,
    priceReturnEncoding: "natural-log-return",
    volumeEncoding: "qualified-htx-base-volume",
  });
  return Object.freeze({
    organizationId: input.organizationId,
    venue: "htx",
    market: "spot",
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    executionHorizonMinutes,
    packageSubjectVersion: HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2,
    terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex,
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: input.developmentDatasetDigestHex,
    featureVersion: FEATURE_VERSION,
    normalizationVersionDigestHex,
    codeReleaseSha: releaseSha,
  });
}
