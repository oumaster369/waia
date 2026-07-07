import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import type {
  MtfAlignment,
  MtfDirection,
} from "@/lib/trader/intelligence/market-understanding.types";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

const DIRECTION_THRESHOLD_PCT = 0.15;

function directionFromBars(bars: readonly Bar[]): MtfDirection {
  if (bars.length < 2) {
    return "UNCLEAR";
  }
  const first = Number(bars[0]!.close);
  const last = Number(bars.at(-1)!.close);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) {
    return "UNCLEAR";
  }
  const changePct = ((last - first) / first) * 100;
  if (Math.abs(changePct) < DIRECTION_THRESHOLD_PCT) {
    return "FLAT";
  }
  return changePct > 0 ? "UP" : "DOWN";
}

export function classifyMtfBackdropFromObservations(
  mtfBars: Partial<Record<BarInterval, NormalizedObservation[]>>,
): Partial<Record<BarInterval, MtfDirection>> {
  const backdrop: Partial<Record<BarInterval, MtfDirection>> = {};
  for (const [interval, observations] of Object.entries(mtfBars)) {
    const observation = observations?.[0];
    const barCount = observation?.payload.barCount;
    if (typeof barCount !== "number" || barCount < 2) {
      backdrop[interval as BarInterval] = "UNCLEAR";
      continue;
    }
    const latestClose = observation.payload.latestClose;
    const latestBarCloseTime = observation.payload.latestBarCloseTime;
    if (typeof latestClose !== "string" || typeof latestBarCloseTime !== "string") {
      backdrop[interval as BarInterval] = "UNCLEAR";
      continue;
    }
    backdrop[interval as BarInterval] = inferDirectionFromPayload(observation.payload);
  }
  return backdrop;
}

function inferDirectionFromPayload(payload: Record<string, unknown>): MtfDirection {
  const openCloseDelta = payload.openCloseDeltaPct;
  if (typeof openCloseDelta === "number" && Number.isFinite(openCloseDelta)) {
    if (Math.abs(openCloseDelta) < DIRECTION_THRESHOLD_PCT) {
      return "FLAT";
    }
    return openCloseDelta > 0 ? "UP" : "DOWN";
  }
  return "UNCLEAR";
}

export function classifyMtfBackdropFromBars(
  barsByInterval: Partial<Record<BarInterval, readonly Bar[]>>,
): Partial<Record<BarInterval, MtfDirection>> {
  const backdrop: Partial<Record<BarInterval, MtfDirection>> = {};
  for (const [interval, bars] of Object.entries(barsByInterval)) {
    if (!bars || bars.length < 2) {
      backdrop[interval as BarInterval] = "UNCLEAR";
      continue;
    }
    backdrop[interval as BarInterval] = directionFromBars(bars);
  }
  return backdrop;
}

export function classifyMtfAlignment(
  backdrop: Partial<Record<BarInterval, MtfDirection>>,
): MtfAlignment {
  const htf = backdrop["4h"] ?? backdrop["1d"];
  const ltf = backdrop["1m"] ?? backdrop["15m"];

  if (!htf || htf === "UNCLEAR" || !ltf || ltf === "UNCLEAR") {
    return "UNCLEAR";
  }
  if (htf === "FLAT" || ltf === "FLAT") {
    return "UNCLEAR";
  }
  return htf === ltf ? "ALIGNED" : "CONFLICTING";
}
