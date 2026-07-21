import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  buildFhvRehearsalLaunchConfig,
  FHV_REHEARSAL_MAX_RUNTIME_MS,
  materializeFhvRehearsalManifest,
  rejectExternalDatasetPath,
  resolveFhvRehearsalRunDirectory,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  assertFhvSystemdAllowedUnit,
  FHV_SYSTEMD_ALLOWED_UNITS,
  type FhvSystemdUnitConfigV1,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import {
  buildSystemctlArgumentArray,
  createLinuxSystemdCampaignControlExecutor,
  createRecordingLinuxSystemdCampaignControlExecutor,
  assertFhvSystemdAllowedAction,
  FHV_SYSTEMD_ALLOWED_ACTIONS,
} from "@/lib/trader/observability/fhv-linux-systemd-executor";
import { renderFhvSystemdUnits } from "@/lib/trader/observability/fhv-systemd-unit-renderer";

const TARGET_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function sampleUnitConfig(overrides: Partial<FhvSystemdUnitConfigV1> = {}): FhvSystemdUnitConfigV1 {
  return {
    schemaVersion: "fhv-systemd-unit-config/v1",
    hostOs: "linux",
    qualifiedSupervisor: "SYSTEMD",
    repoRoot: "/srv/waia",
    workingDirectory: "/srv/waia",
    serviceUser: "waia-fhv",
    environmentFile: "/etc/waia/fhv.env",
    targetSha: TARGET_SHA,
    nodeBin: "/usr/bin/node",
    fhvRunRoot: "/var/lib/waia/fhv-runs/rehearsal-1",
    fhvRunId: "rehearsal-1",
    fhvOrganizationId: "00000000-0000-4000-8000-0000000416",
    observerPort: 9471,
    ...overrides,
  };
}

describe("DEE-424 FHV systemd supervisor", () => {
  it("renders deterministic campaign and observer units without secret literals", () => {
    const first = renderFhvSystemdUnits(sampleUnitConfig());
    const second = renderFhvSystemdUnits(sampleUnitConfig());
    expect(first.campaignUnit).toBe(second.campaignUnit);
    expect(first.observerUnit).toBe(second.observerUnit);
    expect(first.campaignUnit).toContain("Description=WAIA FHV rehearsal campaign");
    expect(first.campaignUnit).toContain(
      "ExecStartPre=/srv/waia/scripts/ops/execution-server-preflight.sh",
    );
    expect(first.campaignUnit).toContain(`--target-sha ${TARGET_SHA}`);
    expect(first.campaignUnit).not.toMatch(/bash\s+-c|\.env=|SECRET|PASSWORD/);
    expect(first.observerUnit).toContain("fhv-observer-cli.ts");
  });

  it("enforces fixed unit and action allowlists", () => {
    expect(FHV_SYSTEMD_ALLOWED_UNITS).toEqual([
      "waia-fhv-campaign.service",
      "waia-fhv-observer.service",
    ]);
    expect(FHV_SYSTEMD_ALLOWED_ACTIONS).toEqual(["start", "stop", "restart", "is-active", "show"]);
    expect(() => assertFhvSystemdAllowedUnit("waia-fhv-campaign.service")).not.toThrow();
    expect(() => assertFhvSystemdAllowedUnit("evil.service")).toThrow(/Unit not allowlisted/);
    expect(() => assertFhvSystemdAllowedAction("start")).not.toThrow();
    expect(() => assertFhvSystemdAllowedAction("enable")).toThrow(/Action not allowlisted/);
  });

  it("rejects shell injection in systemctl argument builder", () => {
    expect(() =>
      buildSystemctlArgumentArray("start", "waia-fhv-campaign.service; rm -rf /"),
    ).toThrow(/Unit not allowlisted|INVALID_UNIT/);
    expect(buildSystemctlArgumentArray("stop", "waia-fhv-campaign.service")).toEqual([
      "systemctl",
      "stop",
      "waia-fhv-campaign.service",
    ]);
  });

  it("fails closed when host qualification or deployment is disabled", async () => {
    const executor = createLinuxSystemdCampaignControlExecutor({
      hostOsQualified: false,
      deploymentEnabled: false,
      runRoot: "/tmp/fhv",
    });
    const result = await executor.execute({
      action: "GRACEFUL_STOP",
      runId: "run-1",
      organizationId: "00000000-0000-4000-8000-0000000416",
      operatorId: "op",
      reason: "test",
    });
    expect(result.enforcementApplied).toBe(false);
    expect(result.message).toBe("HOST_QUALIFICATION_REQUIRED");
  });

  it("records control-file requests for pause without systemctl", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-systemd-"));
    try {
      const executor = createRecordingLinuxSystemdCampaignControlExecutor({
        hostOsQualified: true,
        deploymentEnabled: true,
        runRoot: root,
        spawnSystemctl: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
      });
      const result = await executor.execute({
        action: "PAUSE_AT_CHECKPOINT",
        runId: "run-1",
        organizationId: "00000000-0000-4000-8000-0000000416",
        operatorId: "op",
        reason: "pause drill",
      });
      expect(result.enforcementApplied).toBe(true);
      expect(executor.systemctlCalls).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("maps graceful stop to bounded systemctl stop", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-systemd-"));
    try {
      const executor = createRecordingLinuxSystemdCampaignControlExecutor({
        hostOsQualified: true,
        deploymentEnabled: true,
        runRoot: root,
        spawnSystemctl: async () => ({
          exitCode: 0,
          stdout: "active",
          stderr: "",
          timedOut: false,
        }),
      });
      const result = await executor.execute({
        action: "GRACEFUL_STOP",
        runId: "run-1",
        organizationId: "00000000-0000-4000-8000-0000000416",
        operatorId: "op",
        reason: "stop drill",
      });
      expect(result.enforcementApplied).toBe(true);
      expect(executor.systemctlCalls[0]?.args).toEqual([
        "systemctl",
        "stop",
        "waia-fhv-campaign.service",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("respects bounded timeout from systemctl spawn", async () => {
    const executor = createLinuxSystemdCampaignControlExecutor({
      hostOsQualified: true,
      deploymentEnabled: true,
      runRoot: "/tmp/fhv",
      spawnSystemctl: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "",
        timedOut: true,
      }),
    });
    const result = await executor.execute({
      action: "EMERGENCY_STOP",
      runId: "run-1",
      organizationId: "00000000-0000-4000-8000-0000000416",
      operatorId: "op",
      reason: "timeout",
    });
    expect(result.message).toBe("SYSTEMCTL_TIMEOUT");
  });
});

describe("DEE-424 FHV rehearsal launcher", () => {
  it("rejects external dataset paths and enforces fixture allowlist", () => {
    expect(() => rejectExternalDatasetPath("/data/external.csv", process.cwd())).toThrow(
      /Only approved repository fixtures|EXTERNAL_DATASET_REJECTED/,
    );
  });

  it("rejects run directory collision and bounds runtime", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-rehearsal-"));
    const runId = "rehearsal-collision-test";
    resolveFhvRehearsalRunDirectory(root, runId);
    materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId,
        organizationId: "00000000-0000-4000-8000-0000000416",
        artifactRoot: root,
      }),
    );
    expect(() =>
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId,
        organizationId: "00000000-0000-4000-8000-0000000416",
        artifactRoot: root,
      }),
    ).toThrow(/Rehearsal run directory already exists|RUN_DIRECTORY_COLLISION/);
    expect(() =>
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: "another-run",
        organizationId: "00000000-0000-4000-8000-0000000416",
        artifactRoot: root,
        maxRuntimeMs: FHV_REHEARSAL_MAX_RUNTIME_MS + 1,
      }),
    ).toThrow(/Rehearsal runtime must be >0 and <= 300000ms/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("DEE-424 guarded installer scripts", () => {
  it("install-units.sh exits without mutation when --confirm is absent", () => {
    const script = join(process.cwd(), "scripts/ops/fhv-supervisor/install-units.sh");
    let stderr = "";
    try {
      execFileSync(
        "bash",
        [
          script,
          "--target-sha",
          TARGET_SHA,
          "--working-directory",
          process.cwd(),
          "--service-user",
          "waia-fhv",
          "--environment-file",
          "/etc/waia/fhv.env",
          "--fhv-run-root",
          "/var/lib/waia/fhv-runs/test",
          "--fhv-run-id",
          "test-run",
          "--fhv-organization-id",
          "00000000-0000-4000-8000-0000000416",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const err = error as { stderr?: string; stdout?: string; status?: number };
      stderr = `${err.stderr ?? ""}${err.stdout ?? ""}`;
      expect(err.status).not.toBe(0);
    }
    expect(stderr).toContain("NO-OP");
  });
});
