/**
 * DEE-424 — FHV rehearsal launcher (repository fixture only).
 *
 * Prepares a deterministic rehearsal manifest under replay-runs/RI-P7/.
 * Does not connect to Execution Server or install systemd units.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
  type FhvRehearsalFixtureId,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1]?.trim();
}

async function main(): Promise<void> {
  const targetSha = parseArg("--target-sha") ?? process.env.FHV_TARGET_SHA?.trim();
  const runId = parseArg("--run-id") ?? `fhv-rehearsal-${Date.now()}`;
  const organizationId = parseArg("--organization-id") ?? "00000000-0000-4000-8000-0000000416";
  const fixtureId = (parseArg("--fixture") ?? "HTR_WP03_BENCHMARK") as FhvRehearsalFixtureId;
  const artifactRoot = parseArg("--artifact-root") ?? join(process.cwd(), "replay-runs");

  if (!targetSha) {
    process.stderr.write("[fhv-rehearsal] --target-sha or FHV_TARGET_SHA is required\n");
    process.exit(2);
  }

  const config = buildFhvRehearsalLaunchConfig({
    fixtureId,
    targetSha,
    runId,
    organizationId,
    artifactRoot,
  });
  const { runDir, manifestPath } = materializeFhvRehearsalManifest(config);
  mkdirSync(join(runDir, "streaming-evidence"), { recursive: true });

  process.stdout.write(`[fhv-rehearsal] manifest=${manifestPath}\n`);
  process.stdout.write(`[fhv-rehearsal] runDir=${runDir}\n`);
  process.stdout.write(`[fhv-rehearsal] alertPolicyDigest=${config.alertPolicyDigest}\n`);
  process.stdout.write(`[fhv-rehearsal] classification=REHEARSAL_PREPARED\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[fhv-rehearsal] failed: ${String(error)}\n`);
  process.exitCode = 1;
});
