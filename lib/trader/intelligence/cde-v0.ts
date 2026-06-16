import { FEATURE_ENGINE_QUALITY_THRESHOLD } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  MEAN_REVERSION_V0,
  cdeReasonCodes,
  type FeatureSnapshot,
  type MsvEnvelope,
  type Regime,
  type TradingPermission,
} from "@/lib/trader/intelligence/types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const QUALITY_PAPER_ONLY_THRESHOLD = FEATURE_ENGINE_QUALITY_THRESHOLD;

function classifyRegime(features: FeatureSnapshot): Regime {
  const zscore = features.features.zscoreVsSma20;
  if (compareDecimal(zscore, "-2") <= 0) {
    return "TREND_BEAR";
  }
  if (compareDecimal(zscore, "2") >= 0) {
    return "TREND_BULL";
  }
  if (compareDecimal(zscore, "-0.5") >= 0 && compareDecimal(zscore, "0.5") <= 0) {
    return "CHOP";
  }
  return "RANGE";
}

function resolveTradingPermission(dataQualityScore: number): {
  permission: TradingPermission;
  reasonCodes: string[];
} {
  if (dataQualityScore < QUALITY_PAPER_ONLY_THRESHOLD) {
    return {
      permission: "PAPER_ONLY",
      reasonCodes: [cdeReasonCodes.qualityPaperOnly],
    };
  }
  return {
    permission: "ALLOW_TRADING",
    reasonCodes: [cdeReasonCodes.qualityAllowTrading],
  };
}

function regimeReasonCode(regime: Regime): string {
  switch (regime) {
    case "RANGE":
      return cdeReasonCodes.regimeRange;
    case "TREND_BEAR":
      return cdeReasonCodes.regimeTrendBear;
    default:
      return cdeReasonCodes.regimeUnknown;
  }
}

export type BuildMsvEnvelopeInput = {
  features: FeatureSnapshot;
  newId?: () => string;
};

/**
 * Chief Decision Engine v0 — aggregates features into an MSV envelope.
 * Does not recompute {@link FeatureSnapshot.dataQualityScore}.
 */
export function buildMsvEnvelope(input: BuildMsvEnvelopeInput): MsvEnvelope {
  const { features } = input;
  const regime = classifyRegime(features);
  const permission = resolveTradingPermission(features.dataQualityScore);
  const reasonCodes = [...permission.reasonCodes, regimeReasonCode(regime)];

  return {
    msvId: (input.newId ?? crypto.randomUUID.bind(crypto))(),
    instrumentId: features.instrumentId,
    evaluatedAt: features.evaluatedAt,
    featureSetId: features.featureSetId,
    physics: {
      close: features.features.close,
      zscoreVsSma20: features.features.zscoreVsSma20,
      realizedVol20: features.features.realizedVol20,
    },
    liquidity: {
      spreadBps: features.features.spreadBps,
    },
    crowd: {
      fearGreedIndex: null,
      newsSentiment: "0",
    },
    futureContext: {
      eventRiskScore: "0",
    },
    derived: {
      regime,
      tradingPermission: permission.permission,
      allowedStrategyIds: [MEAN_REVERSION_V0],
      riskMultiplier: "1.0",
      dataQualityScore: features.dataQualityScore,
      reasonCodes,
    },
  };
}

export { QUALITY_PAPER_ONLY_THRESHOLD };
