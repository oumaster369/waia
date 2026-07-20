import fs from "node:fs";
import path from "node:path";

import { collectIncrementalClosedBars } from "@/lib/trader/market-data/canvas/incremental-mtf";
import type { HtfInterval } from "@/lib/trader/market-data/canvas/incremental-mtf";
import { resampleReplayMtfBars } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import type { Bar } from "@/lib/trader/intelligence/types";

export const HTR_WP07_MTF_BASELINE_DIR = "replay-runs/RI-P7/htr-wp07-incremental-mtf-baseline";

function sampleBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: "42000",
    high: "42100",
    low: "41900",
    close: "42050",
    volume: "12.5",
    barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1) - 1).toISOString(),
  }));
}

export type CanvasMtfParityHarness = {
  terminalState: "CANVAS_MTF_PARITY_OK" | "CANVAS_MTF_PARITY_FAILED";
  perIntervalMatch: Record<HtfInterval, boolean>;
  gapCount: number;
  intentionalDefectCorrection: true;
};

export function runCanvasMtfParityHarness(): CanvasMtfParityHarness {
  const bars = sampleBars(120);
  const { emitted, finalState } = collectIncrementalClosedBars(bars);
  const grouped: Record<HtfInterval, Bar[]> = { "15m": [], "1h": [], "4h": [], "1d": [] };
  for (const item of emitted) {
    grouped[item.interval].push(item.bar);
  }

  const perIntervalMatch = {} as Record<HtfInterval, boolean>;
  for (const interval of ["15m", "1h", "4h", "1d"] as const) {
    const oracle = resampleReplayMtfBars({ bars1m: bars })[interval] ?? [];
    const expected =
      finalState.forming[interval] && oracle.length > 0 ? oracle.slice(0, -1) : oracle;
    perIntervalMatch[interval] = JSON.stringify(grouped[interval]) === JSON.stringify(expected);
  }

  const ok = Object.values(perIntervalMatch).every(Boolean);
  return {
    terminalState: ok ? "CANVAS_MTF_PARITY_OK" : "CANVAS_MTF_PARITY_FAILED",
    perIntervalMatch,
    gapCount: finalState.gapCount,
    intentionalDefectCorrection: true,
  };
}

export function assertCanvasMtfParityHarness(harness: CanvasMtfParityHarness): void {
  if (harness.terminalState !== "CANVAS_MTF_PARITY_OK") {
    throw new Error(`MTF parity failed: ${JSON.stringify(harness.perIntervalMatch)}`);
  }
}

export function writeCanvasMtfParityBaseline(harness: CanvasMtfParityHarness): {
  baselineDir: string;
} {
  const baselineDir = path.join(process.cwd(), HTR_WP07_MTF_BASELINE_DIR);
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(
    path.join(baselineDir, "mtf-parity-report.json"),
    `${JSON.stringify(harness, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(baselineDir, "README.md"),
    `# HTR-WP07 incremental MTF baseline\n\nTerminal: ${harness.terminalState}\n`,
  );
  return { baselineDir };
}
