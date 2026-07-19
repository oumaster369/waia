/**
 * WP21 G2 cost-vector delta CLI.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  runWp21G2CostVectorComparison,
  WP21_BOUND_VECTOR_FIXTURE_SHA256,
} from "@/lib/trader/research/wp21-g2-cost-vector-comparison";

async function main() {
  const fixturePath =
    process.argv
      .find((arg) => arg.startsWith("--fixture-path="))
      ?.slice("--fixture-path=".length) ?? "tests/fixtures/trader/wp21-g2-cost-vectors-v1.json";
  const outPath = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  if (!outPath) {
    throw new Error("WP21_G2_COST_VECTOR_DELTA_CLI_MISSING_OUT");
  }
  const abs = path.isAbsolute(fixturePath) ? fixturePath : path.join(process.cwd(), fixturePath);
  const fixture = JSON.parse(readFileSync(abs, "utf8")) as {
    vectors: Array<{
      vectorId: string;
      side: "buy" | "sell";
      grossFillPrice: string;
      quantity: string;
    }>;
  };
  const comparison = runWp21G2CostVectorComparison({
    vectors: fixture.vectors,
    vectorFixtureSha256: WP21_BOUND_VECTOR_FIXTURE_SHA256,
  });
  writeFileSync(outPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

export { main as runWp21G2CostVectorDeltaCli };
