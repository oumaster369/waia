import {
  compareDecimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from "@/lib/trader/risk/numeric";

function clampScore(value: string): string {
  if (compareDecimal(value, "0") < 0) {
    return "0";
  }
  if (compareDecimal(value, "1") > 0) {
    return "1";
  }
  return value;
}

export const DEFAULT_PATTERN_AGING_HALF_LIFE_BARS = 120;

export function computePatternAgingDecay(input: {
  ageBars: number;
  halfLifeBars?: number;
}): string {
  const halfLife = input.halfLifeBars ?? DEFAULT_PATTERN_AGING_HALF_LIFE_BARS;
  if (halfLife <= 0 || input.ageBars <= 0) {
    return "1";
  }
  const ratio = input.ageBars / halfLife;
  const decay = Math.pow(0.5, ratio);
  return clampScore(formatDecimal(parseDecimal(decay.toFixed(8))));
}

export function computePatternRelevanceScore(input: {
  matchScore: string;
  ageBars: number;
  halfLifeBars?: number;
}): string {
  const decay = computePatternAgingDecay({
    ageBars: input.ageBars,
    halfLifeBars: input.halfLifeBars,
  });
  return clampScore(multiplyDecimal(input.matchScore, decay));
}

export function resolveAgeBars(input: {
  evaluatedAtMs: number;
  lastMatchAtMs: number | null;
  barDurationMs?: number;
}): number {
  if (input.lastMatchAtMs === null) {
    return 0;
  }
  const barDuration = input.barDurationMs ?? 60_000;
  const deltaMs = Math.max(0, input.evaluatedAtMs - input.lastMatchAtMs);
  if (compareDecimal(String(deltaMs), "0") <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(deltaMs / barDuration));
}

export function readHalfLifeBarsFromParams(
  params: Record<string, number | string | boolean> | undefined,
): number | undefined {
  const raw = params?.halfLifeBars;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}
