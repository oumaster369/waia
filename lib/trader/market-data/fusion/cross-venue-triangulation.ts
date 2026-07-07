import type { CrossVenueTriangulation } from "@/lib/trader/intelligence/market-understanding.types";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

const ALIGN_THRESHOLD_BPS = 25;
const PARTIAL_THRESHOLD_BPS = 75;

function readDislocationBps(observation: NormalizedObservation | undefined): number | null {
  if (!observation || observation.health === "UNAVAILABLE") {
    return null;
  }
  const value = observation.payload.dislocationBps;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildCrossVenueTriangulation(input: {
  binance?: NormalizedObservation;
  bybit?: NormalizedObservation;
}): CrossVenueTriangulation {
  const binanceDeltaBps = readDislocationBps(input.binance);
  const bybitDeltaBps = readDislocationBps(input.bybit);
  const reasonCodes: string[] = [];

  if (binanceDeltaBps === null && bybitDeltaBps === null) {
    return {
      agreement: "UNAVAILABLE",
      binanceDeltaBps,
      bybitDeltaBps,
      triangulationConfidence: 0,
      reasonCodes: ["CROSS_VENUE_UNAVAILABLE"],
    };
  }

  const deltas = [binanceDeltaBps, bybitDeltaBps].filter(
    (delta): delta is number => delta !== null,
  );

  const maxDelta = deltas.length > 0 ? Math.max(...deltas) : Number.POSITIVE_INFINITY;

  if (maxDelta <= ALIGN_THRESHOLD_BPS) {
    reasonCodes.push("CROSS_VENUE_AGREE");
    return {
      agreement: "AGREE",
      binanceDeltaBps,
      bybitDeltaBps,
      triangulationConfidence: 0.95,
      reasonCodes,
    };
  }

  if (maxDelta <= PARTIAL_THRESHOLD_BPS) {
    reasonCodes.push("CROSS_VENUE_PARTIAL");
    const bothPresent = binanceDeltaBps !== null && bybitDeltaBps !== null;
    if (bothPresent && Math.abs(binanceDeltaBps - bybitDeltaBps) > ALIGN_THRESHOLD_BPS) {
      reasonCodes.push("CROSS_VENUE_VENUE_MISMATCH");
    }
    return {
      agreement: "PARTIAL",
      binanceDeltaBps,
      bybitDeltaBps,
      triangulationConfidence: 0.55,
      reasonCodes,
    };
  }

  reasonCodes.push("CROSS_VENUE_DISAGREE");
  return {
    agreement: "DISAGREE",
    binanceDeltaBps,
    bybitDeltaBps,
    triangulationConfidence: 0.25,
    reasonCodes,
  };
}
