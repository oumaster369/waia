/**
 * DEE-436 — hermetic integration helper: run rehearsal campaign to pause or completion.
 */

import {
  runFhvRehearsalCampaign,
  writeFhvCampaignControlResumeRequest,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { setFhvT4HostMonotonicReaderForTests } from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";

type HermeticCampaignMode = "initial" | "resume";

function installHermeticHostMonotonicReader(bootId: string): void {
  let monotonicNs = 1_000_000_000n;
  setFhvT4HostMonotonicReaderForTests(() => {
    const sample = {
      schemaVersion: "fhv-t4-host-monotonic-sample/v1" as const,
      clockSource: "CLOCK_BOOTTIME" as const,
      bootId,
      monotonicNs: monotonicNs.toString(),
    };
    monotonicNs += 500_000_000n;
    return sample;
  });
}

async function main(): Promise<void> {
  const mode = process.argv[2] as HermeticCampaignMode | undefined;
  const runRoot = process.argv[3];
  const runId = process.argv[4];
  const organizationId = process.argv[5];
  const targetSha = process.argv[6];
  const bootId = process.argv[7] ?? "11111111-2222-4333-8444-555555555555";
  if (
    (mode !== "initial" && mode !== "resume") ||
    !runRoot ||
    !runId ||
    !organizationId ||
    !targetSha
  ) {
    process.stderr.write("FHV_T4A_HERMETIC_CAMPAIGN_SYNC_USAGE\n");
    process.exitCode = 2;
    return;
  }
  installHermeticHostMonotonicReader(bootId);
  if (typeof process.getuid === "function" && typeof process.getgid === "function") {
    process.env.FHV_T4_SERVICE_USER_IDS_JSON = JSON.stringify({
      uid: process.getuid(),
      gid: process.getgid(),
    });
  }
  if (mode === "resume") {
    writeFhvCampaignControlResumeRequest(runRoot, runId, organizationId);
  }
  const expectedClassification = mode === "initial" ? "REHEARSAL_PAUSED" : "REHEARSAL_OK";
  const result = await runFhvRehearsalCampaign({
    runRoot,
    runId,
    organizationId,
    targetSha,
  });
  if (result.classification !== expectedClassification) {
    process.stderr.write(`HERMETIC_CAMPAIGN_UNEXPECTED:${result.classification ?? "null"}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
