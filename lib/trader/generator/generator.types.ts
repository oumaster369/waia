export const GENERATOR_SCHEMA_VERSION = "waia.trader.strategy-generator.v1" as const;

export type StrategyTemplateId = "mean_reversion_v0";

export type MeanReversionTemplateParams = {
  zscoreBuyThreshold: string;
  zscoreSellThreshold: string;
  allowedRegimes: readonly string[];
};

export type StrategyTemplateParams = MeanReversionTemplateParams;

export type StrategySynthesisOutput = {
  schemaVersion: typeof GENERATOR_SCHEMA_VERSION;
  synthesisId: string;
  strategyId: string;
  strategyVersion: string;
  templateId: StrategyTemplateId;
  paramsJson: string;
  paramDigest: string;
  parentStrategyId: string | null;
  parentStrategyVersion: string | null;
  contentDigest: string;
  createdAt: string;
};

export type StrategyLineageRecord = {
  strategyId: string;
  strategyVersion: string;
  parentStrategyId: string | null;
  parentStrategyVersion: string | null;
  templateId: StrategyTemplateId;
  paramDigest: string;
};

export type StrategySynthesizerInput = {
  templateId: StrategyTemplateId;
  params: StrategyTemplateParams;
  parentStrategyId?: string | null;
  parentStrategyVersion?: string | null;
  priorStrategyVersion?: string;
  synthesisId: string;
  createdAt?: string;
};
