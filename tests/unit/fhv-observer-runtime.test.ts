import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFhvObserverRuntime } from "@/lib/trader/observability/fhv-observer-runtime";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import * as observerCore from "@/lib/trader/observability/fhv-observer-core";
import { buildFhvConfigurationFreeze } from "@/lib/trader/observability/fhv-configuration-freeze";
import { writeFhvFullLaunchReceipt } from "@/lib/trader/observability/fhv-full-historical-launch";
import { writeFhvOfficialCampaignIdentity } from "@/lib/trader/observability/fhv-official-campaign-identity";
import { resolveFhvOperatorStatusPath } from "@/lib/trader/observability/fhv-status-writer";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-observer-runtime";
const ORG_ID = "00000000-0000-4000-8000-000000000431";
const COMMAND_SECRET = "fhv-observer-runtime-secret";
const TUNNEL_SECRET = "fhv-observer-runtime-tunnel";

function buildEnv(runDir: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    FHV_RUN_ROOT: runDir,
    FHV_RUN_ID: RUN_ID,
    FHV_ORGANIZATION_ID: ORG_ID,
    FHV_TARGET_SHA: TARGET_SHA,
    FHV_OPERATOR_COMMAND_SECRET: COMMAND_SECRET,
    FHV_OBSERVER_TUNNEL_SECRET: TUNNEL_SECRET,
    FHV_OBSERVER_BIND_HOST: "127.0.0.1",
    FHV_OBSERVER_PORT: "0",
    FHV_HOST_OS_QUALIFIED: "false",
    FHV_COMMAND_ENFORCEMENT_ENABLED: "false",
    FHV_OBSERVER_TICK_INTERVAL_MS: "1000",
  };
}

describe("FHV observer runtime error handling (DEE-431)", () => {
  let root = "";
  let runtime: ReturnType<typeof createFhvObserverRuntime> | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (runtime) {
      await runtime.stop();
      runtime = null;
    }
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("writes degraded evidence when startup tick rejects without unhandled rejection", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-observer-startup-"));
    const config = buildFhvRehearsalLaunchConfig({
      fixtureId: "HTR_WP03_BENCHMARK",
      targetSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      artifactRoot: root,
    });
    const runDir = materializeFhvRehearsalManifest(config).runDir;
    vi.spyOn(observerCore, "runFhvObserverTick").mockRejectedValueOnce(
      new Error("startup tick failed"),
    );
    runtime = createFhvObserverRuntime({ env: buildEnv(runDir), tickIntervalMs: 60_000 });
    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const degradedPath = join(runDir, "fhv-observer-degraded.v1.json");
    expect(existsSync(degradedPath)).toBe(true);
    expect(readFileSync(degradedPath, "utf8")).toContain("startup tick failed");
  });

  it("does not run ticks after stop", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-observer-stop-"));
    const config = buildFhvRehearsalLaunchConfig({
      fixtureId: "HTR_WP03_BENCHMARK",
      targetSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      artifactRoot: root,
    });
    const runDir = materializeFhvRehearsalManifest(config).runDir;
    const tickSpy = vi.spyOn(observerCore, "runFhvObserverTick");
    runtime = createFhvObserverRuntime({ env: buildEnv(runDir), tickIntervalMs: 60_000 });
    await runtime.start();
    await runtime.stop();
    const callsBefore = tickSpy.mock.calls.length;
    await runtime.runTickOnce();
    expect(tickSpy.mock.calls.length).toBe(callsBefore);
  });

  it("never clobbers the chronological driver's authoritative official status", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-observer-official-"));
    const freeze = buildFhvConfigurationFreeze({
      releaseSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "op",
      datasetDigest: "d".repeat(64),
      manifestDigest: "e".repeat(64),
      strategyVersions: ["v1"],
      strategyDigests: ["f".repeat(64)],
      checkpointDigest: "a".repeat(64),
    });
    const { receiptPath, receipt } = writeFhvFullLaunchReceipt({
      configurationFreeze: freeze,
      authorizationReceiptDigest: "b".repeat(64),
      datasetQualificationReceiptDigest: "c".repeat(64),
      artifactRoot: root,
      runId: RUN_ID,
    });
    const runDir = join(receiptPath, "..");
    writeFhvOfficialCampaignIdentity({
      runDir,
      releaseSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      launchReceiptDigest: receipt.launchReceiptDigest,
    });
    const statusPath = resolveFhvOperatorStatusPath(runDir);
    mkdirSync(join(statusPath, ".."), { recursive: true });
    const authoritative = {
      campaign: {
        barsProcessed: 41,
        phase: "CONTROL_REPLAY",
        codeSha: TARGET_SHA,
        datasetDigest: "d".repeat(64),
      },
      accountingFrontierState: { cash: "123" },
      positions: [{ symbol: "BTC/USDT" }],
      fills: [{ id: "fill-1" }],
    };
    writeFileSync(statusPath, `${JSON.stringify(authoritative)}\n`);
    runtime = createFhvObserverRuntime({ env: buildEnv(runDir), startServer: false });
    await runtime.runTickOnce();
    expect(JSON.parse(readFileSync(statusPath, "utf8"))).toEqual(authoritative);
  });
});
