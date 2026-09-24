import { fearGreedValue } from "@/lib/trader/admin-console/collectors/fear-greed";

export type FearGreedPoint = {
  value: string;
  value_classification: string;
  timestamp: string;
  time_until_update?: string;
};

export type FearGreedRow = {
  day: string;
  value: number;
  classification: string;
  sourceTs: string | null;
  nextUpdateAt: string | null;
  observedAt: string;
};

export function fearGreedRows(
  points: readonly FearGreedPoint[],
  observedAt: string,
): FearGreedRow[] {
  const byDay = new Map<string, FearGreedRow & { stamp: number }>();
  for (const point of points) {
    const row = fearGreedRow(point, observedAt);
    if (!row) continue;
    const known = byDay.get(row.day);
    if (!known || row.stamp >= known.stamp) byDay.set(row.day, row);
  }
  return [...byDay.values()].map((row) => ({
    day: row.day,
    value: row.value,
    classification: row.classification,
    sourceTs: row.sourceTs,
    nextUpdateAt: row.nextUpdateAt,
    observedAt: row.observedAt,
  }));
}

function fearGreedRow(
  point: FearGreedPoint,
  observedAt: string,
): (FearGreedRow & { stamp: number }) | null {
  if (!/^\d+$/.test(point.timestamp)) return null;
  const stamp = Number(point.timestamp);
  if (!Number.isSafeInteger(stamp)) return null;
  const classification = point.value_classification.trim();
  if (classification.length === 0) return null;
  let value: number;
  try {
    value = fearGreedValue(Number(point.value));
  } catch {
    return null;
  }
  const sourceTs = new Date(stamp * 1000).toISOString();
  return {
    day: sourceTs.slice(0, 10),
    value,
    classification,
    sourceTs,
    nextUpdateAt: nextUpdateAt(observedAt, point.time_until_update),
    observedAt,
    stamp,
  };
}

function nextUpdateAt(observedAt: string, raw: string | undefined): string | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const seconds = Number(raw);
  const observed = Date.parse(observedAt);
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(observed)) return null;
  return new Date(observed + seconds * 1000).toISOString();
}
