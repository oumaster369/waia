import type { PatternDefinition } from "@/lib/trader/mi/pattern.types";
import type {
  PatternCatalogFeatureSnapshot,
  PatternCatalogScoreBreakdown,
} from "@/lib/trader/mi/pattern-catalog.types";
import {
  absDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

const SCORE_SCALE = 10000n;

function clampScore(value: string): string {
  if (compareDecimal(value, "0") < 0) {
    return "0";
  }
  if (compareDecimal(value, "1") > 0) {
    return "1";
  }
  return value;
}

function readNumericParam(
  params: Record<string, number | string | boolean> | undefined,
  key: string,
  fallback: string,
): string {
  const raw = params?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return formatDecimal(parseDecimal(String(raw)));
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    return formatDecimal(parseDecimal(raw));
  }
  return fallback;
}

function thresholdComponent(actual: string, threshold: string): string {
  if (compareDecimal(threshold, "0") <= 0) {
    return "0";
  }
  const ratio = divideDecimal(actual, threshold);
  return clampScore(compareDecimal(ratio, "1") >= 0 ? "1" : ratio);
}

function inverseThresholdComponent(actual: string, maxThreshold: string): string {
  if (compareDecimal(maxThreshold, "0") <= 0) {
    return "1";
  }
  const ratio = divideDecimal(actual, maxThreshold);
  if (compareDecimal(ratio, "1") <= 0) {
    return "1";
  }
  return clampScore(subtractDecimal("1", subtractDecimal(ratio, "1")));
}

export function parsePatternDefinitionJson(definitionJson: string): PatternDefinition {
  return JSON.parse(definitionJson) as PatternDefinition;
}

export function computePatternMatchScore(input: {
  definition: PatternDefinition;
  features: PatternCatalogFeatureSnapshot;
}): PatternCatalogScoreBreakdown {
  const params = input.definition.recurrence.params;
  const zscoreAbs = absDecimal(input.features.zscoreVsSma20);
  const zscoreThreshold = readNumericParam(params, "zscoreAbsMin", "1");
  const volThreshold = readNumericParam(params, "volMin", "0");
  const eventRiskMax = readNumericParam(params, "eventRiskMax", "1");

  const zscoreComponent = thresholdComponent(zscoreAbs, zscoreThreshold);
  const volComponent = thresholdComponent(input.features.priceDispersion20, volThreshold);
  const eventRiskComponent = inverseThresholdComponent(input.features.eventRiskScore, eventRiskMax);

  const weighted =
    (parseDecimal(zscoreComponent) * 4n +
      parseDecimal(volComponent) * 3n +
      parseDecimal(eventRiskComponent) * 3n) /
    SCORE_SCALE;

  return {
    zscoreComponent,
    volComponent,
    eventRiskComponent,
    matchScore: clampScore(formatDecimal(weighted)),
  };
}

export const PATTERN_CATALOG_MIN_MATCH_SCORE = "0.3000";

export function meetsPatternMatchThreshold(matchScore: string): boolean {
  return compareDecimal(matchScore, PATTERN_CATALOG_MIN_MATCH_SCORE) >= 0;
}
