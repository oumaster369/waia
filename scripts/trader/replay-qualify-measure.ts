/**
 * Single fresh-process qualification measurement (spawned by replay-qualify orchestrator).
 *
 * Usage: node replay-qualify-measure.ts N1|N2 <runLabel> cold|warm
 */
import {
  runQualificationMeasurement,
  type QualificationDatasetSize,
} from "@/lib/trader/backtest/replay-qualification-harness";

async function main(): Promise<void> {
  const size = (process.argv[2] === "N2" ? "N2" : "N1") as QualificationDatasetSize;
  const runLabel = process.argv[3] ?? "unlabeled";
  const isCold = process.argv[4] === "cold";
  const observation = await runQualificationMeasurement({ size, runLabel, isCold });
  console.log(JSON.stringify(observation));
}

main().catch((error: unknown) => {
  console.error("[htr-wp09-qualify-measure] failed:", error);
  process.exitCode = 1;
});
