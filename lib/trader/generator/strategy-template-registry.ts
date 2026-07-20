import type {
  MeanReversionTemplateParams,
  StrategyTemplateId,
  StrategyTemplateParams,
} from "@/lib/trader/generator/generator.types";

export type StrategyTemplateDefinition = {
  templateId: StrategyTemplateId;
  strategyId: string;
  defaultParams: StrategyTemplateParams;
  paramSchemaVersion: string;
};

const MEAN_REVERSION_V0_TEMPLATE: StrategyTemplateDefinition = {
  templateId: "mean_reversion_v0",
  strategyId: "mean_reversion_v0",
  paramSchemaVersion: "1.0.0",
  defaultParams: {
    zscoreBuyThreshold: "-1.5",
    zscoreSellThreshold: "0",
    allowedRegimes: ["RANGE", "CHOP", "TREND_BEAR", "STRESS"],
  } satisfies MeanReversionTemplateParams,
};

const TEMPLATE_REGISTRY: Record<StrategyTemplateId, StrategyTemplateDefinition> = {
  mean_reversion_v0: MEAN_REVERSION_V0_TEMPLATE,
};

export function getStrategyTemplate(templateId: StrategyTemplateId): StrategyTemplateDefinition {
  const template = TEMPLATE_REGISTRY[templateId];
  if (!template) {
    throw new Error(`[generator] unknown template: ${templateId}`);
  }
  return template;
}

export function listStrategyTemplates(): readonly StrategyTemplateDefinition[] {
  return Object.values(TEMPLATE_REGISTRY);
}
