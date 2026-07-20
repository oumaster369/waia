import type {
  StrategyLineageRecord,
  StrategyTemplateId,
} from "@/lib/trader/generator/generator.types";

export type BuildStrategyLineageInput = {
  strategyId: string;
  strategyVersion: string;
  parentStrategyId: string | null;
  parentStrategyVersion: string | null;
  templateId: StrategyTemplateId;
  paramDigest: string;
};

export function buildStrategyLineage(input: BuildStrategyLineageInput): StrategyLineageRecord {
  return {
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    parentStrategyId: input.parentStrategyId,
    parentStrategyVersion: input.parentStrategyVersion,
    templateId: input.templateId,
    paramDigest: input.paramDigest,
  };
}

export function lineageKey(lineage: StrategyLineageRecord): string {
  return `${lineage.strategyId}@${lineage.strategyVersion}:${lineage.paramDigest.slice(0, 12)}`;
}
