import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRecordingLinuxSystemdCampaignControlExecutor } from "@/lib/trader/observability/fhv-linux-systemd-executor";
import { createFhvObserverRuntime } from "@/lib/trader/observability/fhv-observer-runtime";
import { FHV_OPERATOR_COMMAND_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
  readFhvT4PauseArmedRecord,
  writeFhvT4PauseArmedRecord,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import { writeFhvSystemdDeployedRevisionAtomic } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  buildFhvT4SignedOperatorCommand,
  FhvT4OperatorCliError,
  forwardFhvT4OperatorCommand,
  parseFhvT4OperatorSubcommand,
  resolveFhvT4OperatorCliConfig,
  runFhvT4OperatorCli,
  runFhvT4OperatorVerify,
  type FhvT4OperatorCliConfig,
} from "@/scripts/trader/fhv-t4-operator-cli";

const TARGET_SHA = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const RUN_ID = "fhv-t4-operator-cli";
const ORG_ID = "00000000-0000-4000-8000-000000000435";
const COMMAND_SECRET = "fhv-t4-operator-command-secret";
const TUNNEL_SECRET = "fhv-t4-operator-tunnel-secret";
const RELEASE_TAG = "v2026.07.24.test435";

function buildConfig(
  runDir: string,
  repoRoot: string,
  subcommand: FhvT4OperatorCliConfig["subcommand"],
  overrides: Partial<FhvT4OperatorCliConfig> = {},
): FhvT4OperatorCliConfig {
  return {
    subcommand,
    runRoot: runDir,
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    commandSecret: COMMAND_SECRET,
    observerTunnelSecret: TUNNEL_SECRET,
    operatorId: "t4-operator",
    observerHost: "127.0.0.1",
    observerPort: 0,
    repoRoot,
    ...overrides,
  };
}

describe("fhv-t4-operator-cli (DEE-435)", () => {
  let root = "";
  let runtime: ReturnType<typeof createFhvObserverRuntime> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.stop();
      runtime = null;
    }
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  async function startObserver(runDir: string): Promise<FhvT4OperatorCliConfig> {
    const executor = createRecordingLinuxSystemdCampaignControlExecutor({
      hostOsQualified: true,
      deploymentEnabled: true,
      runRoot: runDir,
    });
    runtime = createFhvObserverRuntime({
      env: {
        NODE_ENV: "test",
        FHV_RUN_ROOT: runDir,
        FHV_RUN_ID: RUN_ID,
        FHV_ORGANIZATION_ID: ORG_ID,
        FHV_TARGET_SHA: TARGET_SHA,
        FHV_OPERATOR_COMMAND_SECRET: COMMAND_SECRET,
        FHV_OBSERVER_TUNNEL_SECRET: TUNNEL_SECRET,
        FHV_OBSERVER_BIND_HOST: "127.0.0.1",
        FHV_OBSERVER_PORT: "0",
        FHV_HOST_OS_QUALIFIED: "true",
        FHV_COMMAND_ENFORCEMENT_ENABLED: "true",
      },
      campaignControlExecutor: executor,
      startServer: true,
    });
    await runtime.start();
    return buildConfig(runDir, root, "status", { observerPort: runtime.getBoundPort() });
  }

  function prepareT4RunDir(): string {
    const config = buildFhvRehearsalLaunchConfig({
      fixtureId: "HTR_WP03_BENCHMARK",
      targetSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      artifactRoot: root,
      t4DeterministicPause: true,
    });
    return materializeFhvRehearsalManifest(config).runDir;
  }

  it("parses supported subcommands", () => {
    expect(parseFhvT4OperatorSubcommand(["status"])).toBe("status");
    expect(parseFhvT4OperatorSubcommand(["arm-pause", "--run-root", "/tmp"])).toBe("arm-pause");
    expect(() => parseFhvT4OperatorSubcommand(["invalid"])).toThrow(FhvT4OperatorCliError);
  });

  it("rejects incomplete CLI config", () => {
    expect(() =>
      resolveFhvT4OperatorCliConfig(
        {
          FHV_RUN_ROOT: "/tmp/run",
          FHV_RUN_ID: RUN_ID,
        } as unknown as NodeJS.ProcessEnv,
        ["status"],
      ),
    ).toThrow(FhvT4OperatorCliError);
  });

  it("returns observer status over localhost bridge", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-status-"));
    const runDir = prepareT4RunDir();
    const config = await startObserver(runDir);
    const result = await runFhvT4OperatorCli({ ...config, subcommand: "status" });
    expect(result.exitCode).toBe(0);
    expect(result.lines.some((line) => line.startsWith("phase="))).toBe(true);
  });

  it("pre-arms deterministic pause via arm-pause subcommand", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-arm-"));
    const runDir = prepareT4RunDir();
    const config = await startObserver(runDir);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FHV_HOST_OS_QUALIFIED", "true");
    vi.stubEnv("FHV_COMMAND_ENFORCEMENT_ENABLED", "true");
    try {
      const result = await runFhvT4OperatorCli({ ...config, subcommand: "arm-pause" });
      expect(result.exitCode).toBe(0);
      expect(result.lines).toContain("status=executed");
      const armed = readFhvT4PauseArmedRecord(runDir);
      expect(armed?.schemaVersion).toBe(FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("verify succeeds when armed pause and systemd record match target sha", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-verify-"));
    const runDir = prepareT4RunDir();
    writeFhvT4PauseArmedRecord(runDir, {
      schemaVersion: FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      fixtureId: "HTR_WP03_BENCHMARK",
      deterministicPauseAtCycle: 40,
      commandId: "cmd-verify",
      idempotencyKey: "idem-verify",
      operatorId: "t4-operator",
      armedAtUtc: new Date().toISOString(),
    });
    const { writeFhvCampaignControlRequest } =
      await import("@/lib/trader/observability/fhv-campaign-control-files");
    writeFhvCampaignControlRequest(runDir, {
      schemaVersion: "fhv-campaign-control-request/v1",
      action: "PAUSE_AT_CHECKPOINT",
      runId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      reason: "verify pending pause",
      requestedAtUtc: new Date().toISOString(),
    });
    writeFhvSystemdDeployedRevisionAtomic(root, {
      releaseSha: TARGET_SHA,
      releaseTag: "v2026.07.24.test435",
      runId: RUN_ID,
      organizationId: ORG_ID,
      renderedUnitDigests: {
        "waia-fhv-campaign.service": "a".repeat(64),
        "waia-fhv-observer.service": "b".repeat(64),
      },
      installedAtUtc: new Date().toISOString(),
      operatorId: "t4-operator",
      serviceUser: "waia-fhv",
      legacyContainerRunning: true,
    });
    const config = buildConfig(runDir, root, "verify");
    await expect(runFhvT4OperatorVerify(config)).resolves.toBeUndefined();
    const result = await runFhvT4OperatorCli(config);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toContain("classification=T4_VERIFY_OK");
  });

  it("rejects arm-pause when NODE_ENV=test barrier is active", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-arm-neg-"));
    const runDir = prepareT4RunDir();
    const config = await startObserver(runDir);
    vi.stubEnv("NODE_ENV", "test");
    try {
      const result = await runFhvT4OperatorCli({ ...config, subcommand: "arm-pause" });
      expect(result.exitCode).toBe(1);
      expect(result.lines.join("\n")).toContain("FHV_T4_TEST_BARRIER_FORBIDDEN");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects verify when systemd record sha mismatches", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-verify-neg-"));
    const runDir = prepareT4RunDir();
    writeFhvT4PauseArmedRecord(runDir, {
      schemaVersion: FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      fixtureId: "HTR_WP03_BENCHMARK",
      deterministicPauseAtCycle: 40,
      commandId: "cmd-verify-neg",
      idempotencyKey: "idem-verify-neg",
      operatorId: "t4-operator",
      armedAtUtc: new Date().toISOString(),
    });
    const { writeFhvCampaignControlRequest } =
      await import("@/lib/trader/observability/fhv-campaign-control-files");
    writeFhvCampaignControlRequest(runDir, {
      schemaVersion: "fhv-campaign-control-request/v1",
      action: "PAUSE_AT_CHECKPOINT",
      runId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      reason: "verify pending pause",
      requestedAtUtc: new Date().toISOString(),
    });
    writeFhvSystemdDeployedRevisionAtomic(root, {
      releaseSha: "ffffffffffffffffffffffffffffffffffffffff",
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      renderedUnitDigests: {
        "waia-fhv-campaign.service": "a".repeat(64),
        "waia-fhv-observer.service": "b".repeat(64),
      },
      installedAtUtc: new Date().toISOString(),
      operatorId: "t4-operator",
      serviceUser: "waia-fhv",
      legacyContainerRunning: true,
    });
    const config = buildConfig(runDir, root, "verify");
    const result = await runFhvT4OperatorCli(config);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("FHV_SYSTEMD_REVISION_SHA_MISMATCH");
  });

  it("rejects observer command forwarding with invalid tunnel secret", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-auth-neg-"));
    const runDir = prepareT4RunDir();
    const config = await startObserver(runDir);
    const command = buildFhvT4SignedOperatorCommand(
      { ...config, subcommand: "arm-pause" },
      { action: "PAUSE_AT_CHECKPOINT", expectedPhase: "validation" },
    );
    await expect(
      forwardFhvT4OperatorCommand({ ...config, observerTunnelSecret: "wrong-secret" }, command),
    ).rejects.toThrow(FhvT4OperatorCliError);
  });

  it("rejects resume when stale expected campaign state is signed", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-resume-neg-"));
    const runDir = prepareT4RunDir();
    const config = await startObserver(runDir);
    const command = buildFhvT4SignedOperatorCommand(
      { ...config, subcommand: "resume" },
      { action: "RESUME_FROM_CHECKPOINT", expectedPhase: "stale-phase", checkpointSeq: 9999 },
    );
    const result = await forwardFhvT4OperatorCommand(config, command);
    expect(result.status).toBe("rejected");
  });

  it("builds signed operator commands with schema version", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-build-"));
    const config = buildConfig("/tmp/run", root, "arm-pause");
    const command = buildFhvT4SignedOperatorCommand(config, {
      action: "PAUSE_AT_CHECKPOINT",
      expectedPhase: "validation",
    });
    expect(command.schemaVersion).toBe(FHV_OPERATOR_COMMAND_SCHEMA_VERSION);
    expect(command.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});
