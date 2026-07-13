/**
 * HTR-WP06 — Canvas state contract verification CLI.
 *
 * Usage:
 *   pnpm trader:canvas:state-check
 */

import {
  assertCanvasStateCheckHarness,
  runCanvasStateCheckHarness,
  writeCanvasStateCheckBaseline,
} from "@/lib/trader/market-data/canvas/canvas-state-check-harness";

async function main(): Promise<void> {
  const harness = runCanvasStateCheckHarness();
  assertCanvasStateCheckHarness(harness);
  const paths = writeCanvasStateCheckBaseline(harness);

  console.log("[htr-wp06-canvas] terminal state:", harness.terminalState);
  console.log("[htr-wp06-canvas] baseline:", paths.baselineDir);
  console.log("[htr-wp06-canvas] contentDigest:", harness.canvasStateContentDigest);
  console.log(
    `[htr-wp06-canvas] ring=${harness.oneMinuteRingLength} closed=${harness.closedBarCount} sidecarOk=${harness.sidecarRoundTripOk}`,
  );

  if (harness.terminalState !== "CANVAS_STATE_OK") {
    process.exitCode = 1;
  }
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp06-canvas] failed:", error);
    process.exitCode = 1;
  });
}
