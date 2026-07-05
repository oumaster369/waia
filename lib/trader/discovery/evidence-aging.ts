import { compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";
import type { EpistemicEvidenceRecord } from "@/lib/trader/discovery/evidence.types";

export type EvidenceAgingInput = {
  record: EpistemicEvidenceRecord;
  barsElapsed: number;
  halfLifeBars?: number;
};

const DEFAULT_HALF_LIFE_BARS = 1440;

function clamp01(value: string): string {
  if (compareDecimal(value, "0") < 0) {
    return "0";
  }
  if (compareDecimal(value, "1") > 0) {
    return "1";
  }
  return value;
}

/** Bar-based relevance decay — independent of capital outcomes. */
export function computeEvidenceRelevanceScore(input: EvidenceAgingInput): string {
  const halfLife = input.halfLifeBars ?? DEFAULT_HALF_LIFE_BARS;
  if (input.barsElapsed <= 0) {
    return input.record.relevanceScore;
  }
  const decayFactor = Math.pow(0.5, input.barsElapsed / halfLife);
  const aged = multiplyDecimal(input.record.relevanceScore, decayFactor.toFixed(8));
  return clamp01(aged);
}

export function applyEvidenceAging(
  records: readonly EpistemicEvidenceRecord[],
  barsElapsed: number,
  halfLifeBars?: number,
): EpistemicEvidenceRecord[] {
  return records.map((record) => ({
    ...record,
    relevanceScore: computeEvidenceRelevanceScore({ record, barsElapsed, halfLifeBars }),
  }));
}
