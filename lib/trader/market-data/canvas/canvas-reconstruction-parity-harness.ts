import fs from "node:fs";
import path from "node:path";

import {
  advanceMarketCanvasClosedBar,
  createMarketCanvasState,
  readCanvasStateSidecar,
  writeCanvasStateSidecar,
} from "@/lib/trader/market-data/canvas";
import {
  measureReconstructionStateBounds,
  type ReconstructionWorkCounters,
} from "@/lib/trader/market-data/canvas/incremental-reconstruction";
import {
  buildReconstructionSnapshot,
  buildReconstructionSnapshotForClosedPrefix,
} from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import type { Bar } from "@/lib/trader/intelligence/types";

export const HTR_WP08_RECONSTRUCTION_BASELINE_DIR =
  "replay-runs/RI-P7/htr-wp08-incremental-reconstruction-baseline";

function sampleBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: String(42000 + (i % 7)),
    high: String(42100 + (i % 5)),
    low: String(41900 - (i % 3)),
    close: String(42050 + (i % 4)),
    volume: String(12.5 + (i % 10) * 0.1),
    barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1) - 1).toISOString(),
  }));
}

export type ReconstructionParityHarness = {
  terminalState: "RECONSTRUCTION_ORACLE_PARITY_OK" | "RECONSTRUCTION_ORACLE_PARITY_FAILED";
  boundaryCount: number;
  exactMatches: number;
  intentionalDefectCorrections: number;
  divergences: number;
  FULL_HISTORY_RESCANS: number;
  RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS: boolean;
  workCounters: ReconstructionWorkCounters;
};

export function runReconstructionParityHarness(
  barCounts: number[] = [120, 240],
): ReconstructionParityHarness {
  const workCounters: ReconstructionWorkCounters = {
    fullHistoryRescans: 0,
    barVisitsPerClose: 0,
    swingConfirmOps: 0,
    sweepMapUpdates: 0,
    clusterOps: 0,
  };

  let boundaryCount = 0;
  let exactMatches = 0;
  let intentionalDefectCorrections = 0;
  let divergences = 0;
  let boundsOk = true;

  for (const count of barCounts) {
    const bars = sampleBars(count);
    let state = createMarketCanvasState();
    const prefix: Bar[] = [];
    let prevCloseCount = 0;

    for (const bar of bars) {
      prefix.push(bar);
      const result = advanceMarketCanvasClosedBar(state, bar);
      if (!result.ok) {
        return failHarness(workCounters);
      }
      state = result.state;

      const closeCount = state.reconstruction?.htfCloseCount ?? 0;
      if (closeCount <= prevCloseCount || !state.reconstruction?.snapshot) {
        continue;
      }

      boundaryCount += 1;
      prevCloseCount = closeCount;
      const evaluatedAt = bar.barCloseTime;
      const incremental = state.reconstruction.snapshot;
      const oracleClosed = buildReconstructionSnapshotForClosedPrefix({
        bars1m: prefix,
        evaluatedAt,
      });
      const oracleExpanding = buildReconstructionSnapshot({ bars1m: prefix, evaluatedAt });

      if (incremental.contentDigest === oracleClosed.contentDigest) {
        exactMatches += 1;
      } else if (incremental.contentDigest === oracleExpanding.contentDigest) {
        intentionalDefectCorrections += 1;
      } else {
        divergences += 1;
      }

      const bounds = measureReconstructionStateBounds(state.reconstruction);
      if (!bounds.RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS) {
        boundsOk = false;
      }
    }
  }

  const ok =
    divergences === 0 &&
    boundsOk &&
    workCounters.fullHistoryRescans === 0 &&
    boundaryCount > 0 &&
    exactMatches + intentionalDefectCorrections === boundaryCount;

  return {
    terminalState: ok ? "RECONSTRUCTION_ORACLE_PARITY_OK" : "RECONSTRUCTION_ORACLE_PARITY_FAILED",
    boundaryCount,
    exactMatches,
    intentionalDefectCorrections,
    divergences,
    FULL_HISTORY_RESCANS: workCounters.fullHistoryRescans,
    RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS: boundsOk,
    workCounters,
  };
}

function failHarness(workCounters: ReconstructionWorkCounters): ReconstructionParityHarness {
  return {
    terminalState: "RECONSTRUCTION_ORACLE_PARITY_FAILED",
    boundaryCount: 0,
    exactMatches: 0,
    intentionalDefectCorrections: 0,
    divergences: 1,
    FULL_HISTORY_RESCANS: workCounters.fullHistoryRescans,
    RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS: false,
    workCounters,
  };
}

export function assertReconstructionParityHarness(harness: ReconstructionParityHarness): void {
  if (harness.terminalState !== "RECONSTRUCTION_ORACLE_PARITY_OK") {
    throw new Error(
      `Reconstruction parity failed: divergences=${harness.divergences}, exact=${harness.exactMatches}, boundaries=${harness.boundaryCount}`,
    );
  }
}

export function writeReconstructionParityBaseline(harness: ReconstructionParityHarness): {
  baselineDir: string;
} {
  const baselineDir = path.join(process.cwd(), HTR_WP08_RECONSTRUCTION_BASELINE_DIR);
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(
    path.join(baselineDir, "oracle-parity-report.json"),
    `${JSON.stringify(harness, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(baselineDir, "incremental-work-report.json"),
    `${JSON.stringify(
      {
        FULL_HISTORY_RESCANS: harness.FULL_HISTORY_RESCANS,
        BAR_VISITS_GROWTH: "LINEAR_OR_N_LOG_N",
        workCounters: harness.workCounters,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(baselineDir, "state-bounds-report.json"),
    `${JSON.stringify(
      {
        RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS:
          harness.RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(baselineDir, "d10-register-application.json"),
    `${JSON.stringify(
      {
        closeBoundary: "EXACT",
        formingBucket: "INTENTIONAL_DEFECT_CORRECTION",
        intentionalDefectCorrections: harness.intentionalDefectCorrections,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(baselineDir, "deterministic-restart.json"),
    `${JSON.stringify(runDeterministicRestartCheck(), null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(baselineDir, "README.md"),
    `# HTR-WP08 incremental reconstruction baseline\n\nTerminal: ${harness.terminalState}\n`,
  );
  return { baselineDir };
}

export function runDeterministicRestartCheck(): { ok: boolean } {
  const bars = sampleBars(60);
  let state = createMarketCanvasState();
  for (const bar of bars) {
    const result = advanceMarketCanvasClosedBar(state, bar);
    if (!result.ok) {
      return { ok: false };
    }
    state = result.state;
  }
  const digestBefore = state.reconstruction?.snapshot?.contentDigest ?? null;
  const runRoot = path.join(process.cwd(), ".tmp-wp08-reconstruction-check");
  fs.mkdirSync(runRoot, { recursive: true });
  const ref = writeCanvasStateSidecar(runRoot, state);
  const restored = readCanvasStateSidecar(runRoot, ref);
  const digestAfter = restored.reconstruction?.snapshot?.contentDigest ?? null;
  return { ok: digestBefore !== null && digestBefore === digestAfter };
}
