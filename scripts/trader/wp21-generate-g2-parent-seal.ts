/**
 * WP21 G2 parent seal generation CLI.
 */

import { writeFileSync } from "node:fs";

import {
  assertExpectedParentSealDigests,
  generateWp21G2ParentSeal,
} from "@/lib/trader/research/wp21-g2-parent-seal-orchestrator";

async function main() {
  const result = generateWp21G2ParentSeal();
  assertExpectedParentSealDigests(result);
  const outPath = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  if (!outPath) {
    throw new Error("WP21_G2_PARENT_SEAL_CLI_MISSING_OUT");
  }
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

export { main as runWp21GenerateG2ParentSealCli };
