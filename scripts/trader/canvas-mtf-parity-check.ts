/**
 * HTR-WP07 — Canvas MTF parity verification CLI.
 */

import {
  assertCanvasMtfParityHarness,
  runCanvasMtfParityHarness,
  writeCanvasMtfParityBaseline,
} from "@/lib/trader/market-data/canvas/canvas-mtf-parity-harness";

async function main(): Promise<void> {
  const harness = runCanvasMtfParityHarness();
  assertCanvasMtfParityHarness(harness);
  const paths = writeCanvasMtfParityBaseline(harness);
  console.log("[htr-wp07-mtf] terminal state:", harness.terminalState);
  console.log("[htr-wp07-mtf] baseline:", paths.baselineDir);
  console.log("[htr-wp07-mtf] perInterval:", harness.perIntervalMatch);
  if (harness.terminalState !== "CANVAS_MTF_PARITY_OK") {
    process.exitCode = 1;
  }
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp07-mtf] failed:", error);
    process.exitCode = 1;
  });
}
