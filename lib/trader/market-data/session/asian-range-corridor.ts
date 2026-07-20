import type { BarInterval } from "@/lib/trader/intelligence/types";
import type {
  AsianRangeCorridorMetadata,
  NormalizedObservation,
  SessionPhase,
} from "@/lib/trader/market-data/observation-types";

function parseClose(payload: Record<string, unknown>): number | null {
  const close = payload.latestClose;
  if (typeof close === "string") {
    const value = Number(close);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/**
 * Asian Session Range Corridor metadata — research seed only (never a trading rule).
 */
export function computeAsianRangeCorridorMetadata(input: {
  sessionPhase: SessionPhase;
  mtfBars: Partial<Record<BarInterval, NormalizedObservation[]>>;
}): AsianRangeCorridorMetadata | undefined {
  if (input.sessionPhase !== "ASIA" && input.sessionPhase !== "OVERLAP") {
    return undefined;
  }

  const hourBars = input.mtfBars["1h"] ?? [];
  const closes = hourBars
    .map((observation) => parseClose(observation.payload))
    .filter((value): value is number => value !== null);

  if (closes.length < 2) {
    return undefined;
  }

  const rangeHigh = Math.max(...closes);
  const rangeLow = Math.min(...closes);
  const mid = (rangeHigh + rangeLow) / 2;
  const rangeWidthBps = mid > 0 ? ((rangeHigh - rangeLow) / mid) * 10_000 : 0;

  return {
    hypothesisId: "asian_session_range_corridor_v0",
    sessionPhase: input.sessionPhase,
    rangeHigh: String(rangeHigh),
    rangeLow: String(rangeLow),
    rangeWidthBps,
    corridorConfidence: Math.min(1, closes.length / 4),
    isResearchSeedOnly: true,
  };
}
