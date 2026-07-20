import type {
  MeanReversionTemplateParams,
  StrategyTemplateParams,
} from "@/lib/trader/generator/generator.types";

export type MutationOperator =
  | "tighten_zscore_buy"
  | "widen_zscore_buy"
  | "restrict_regime_scope"
  | "expand_regime_scope";

const MUTATION_OPERATORS: readonly MutationOperator[] = [
  "tighten_zscore_buy",
  "widen_zscore_buy",
  "restrict_regime_scope",
  "expand_regime_scope",
] as const;

export function listMutationOperators(): readonly MutationOperator[] {
  return MUTATION_OPERATORS;
}

function adjustThreshold(value: string, delta: string): string {
  return (Number(value) + Number(delta)).toFixed(2);
}

export function applyMutationOperator(
  params: StrategyTemplateParams,
  operator: MutationOperator,
): StrategyTemplateParams {
  switch (operator) {
    case "tighten_zscore_buy":
      return {
        ...params,
        zscoreBuyThreshold: adjustThreshold(params.zscoreBuyThreshold, "0.25"),
      };
    case "widen_zscore_buy":
      return {
        ...params,
        zscoreBuyThreshold: adjustThreshold(params.zscoreBuyThreshold, "-0.25"),
      };
    case "restrict_regime_scope":
      return {
        ...params,
        allowedRegimes: params.allowedRegimes.filter((regime) => regime !== "CHOP"),
      };
    case "expand_regime_scope":
      return {
        ...params,
        allowedRegimes: [...new Set([...params.allowedRegimes, "TREND_BEAR", "STRESS"])],
      };
    default:
      return params;
  }
}

export function isMeanReversionParams(
  params: StrategyTemplateParams,
): params is MeanReversionTemplateParams {
  return "zscoreBuyThreshold" in params && "zscoreSellThreshold" in params;
}
