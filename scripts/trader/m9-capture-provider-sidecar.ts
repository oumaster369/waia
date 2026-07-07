#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { captureProviderSnapshot } from "@/lib/trader/market-data/capture/capture-provider-snapshot";
import { computeSidecarContentDigest } from "@/lib/trader/market-data/replay/sidecar-content-digest";
import { assertResearchRuntime } from "@/lib/trader/research/assert-research-runtime";

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      flags.set(body, "true");
    } else {
      flags.set(body.slice(0, eqIndex), body.slice(eqIndex + 1));
    }
  }
  return flags;
}

async function main(): Promise<void> {
  assertResearchRuntime("m9-capture-provider-sidecar");
  const flags = parseFlags(process.argv.slice(2));
  const instrumentId = flags.get("instrument-id")?.trim() || "BTC/USDT";
  const outputPath = resolve(
    flags.get("output")?.trim() ||
      "replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-provider-sidecar.json",
  );

  const sidecar = await captureProviderSnapshot({
    instrumentId,
    generatedBy: "scripts/trader/m9-capture-provider-sidecar.ts",
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

  const digest = computeSidecarContentDigest(sidecar);
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        schemaVersion: sidecar.schemaVersion,
        captureAsOfUtc: sidecar.captureAsOfUtc,
        contentDigest: digest,
        laneKeys: Object.keys(sidecar.lanes),
        captureOutcomeCount: Object.keys(sidecar.captureOutcomes ?? {}).length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
