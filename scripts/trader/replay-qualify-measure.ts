/**
 * Single fresh-process qualification measurement (spawned by replay-qualify orchestrator).
 *
 * Usage: node replay-qualify-measure.ts N1|N2 <runLabel> cold|warm
 */
import { writeFileSync } from "node:fs";

import {
  HTR_WP09_MEASUREMENT_MARKER,
  runQualificationMeasurement,
  type QualificationDatasetSize,
} from "@/lib/trader/backtest/replay-qualification-harness";

async function main(): Promise<void> {
  const size = (process.argv[2] === "N2" ? "N2" : "N1") as QualificationDatasetSize;
  const runLabel = process.argv[3] ?? "unlabeled";
  const isCold = process.argv[4] === "cold";
  const outPath = process.argv[5];
  const contractEnv = process.env.WAIA_QUALIFICATION_CONTRACT;
  const contract =
    contractEnv === "ORIGINAL_D11B" ? "ORIGINAL_D11B" : "D11B_MEMORY_GATE_AMENDMENT_V1";
  const observation = await runQualificationMeasurement({
    size,
    runLabel,
    isCold,
    contract,
  });
  const payload = JSON.stringify(observation);
  if (outPath) {
    writeFileSync(outPath, payload, "utf8");
  }
  process.stdout.write(`${HTR_WP09_MEASUREMENT_MARKER}${payload}\n`);
}

main().catch((error: unknown) => {
  console.error("[htr-wp09-qualify-measure] failed:", error);
  process.exitCode = 1;
});
