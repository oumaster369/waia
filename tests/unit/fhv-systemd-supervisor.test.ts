import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    fhvOrganizationId: "00000000-0000-4000-8000-000000000416",
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
      "ExecStartPre=/srv/waia/scripts/ops/execution-server-preflight.sh --repo-path /srv/waia",
    );
    expect(first.campaignUnit).toContain(`--target-sha ${TARGET_SHA}`);
    expect(first.campaignUnit).toContain("RuntimeMaxSec=300");
    expect(first.campaignUnit).toContain("Restart=no");
    expect(first.campaignUnit).not.toContain("Restart=on-failure");
    expect(first.campaignUnit).not.toContain("StartLimitIntervalSec=");
    expect(first.observerUnit).not.toContain("RuntimeMaxSec=");
    expect(first.observerUnit).toContain("Restart=on-failure");
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

  it("rejects repoRoot and workingDirectory mismatch", () => {
    expect(() =>
      renderFhvSystemdUnits(
        sampleUnitConfig({ repoRoot: "/srv/waia", workingDirectory: "/srv/waia-other" }),
      ),
    ).toThrow(/REPO_WORKING_DIRECTORY_MISMATCH|must identify the same/);
  });

  it("rejects unsafe systemd path characters", () => {
    const cases = [
      { field: "environmentFile" as const, value: "/etc/waia/fhv.env" },
      { field: "environmentFile" as const, value: "/etc/waia/evil path" },
      { field: "environmentFile" as const, value: "/etc/waia/%n" },
      { field: "environmentFile" as const, value: "/etc/waia/evil#comment" },
      { field: "environmentFile" as const, value: "/etc/waia/evil=inject" },
      { field: "environmentFile" as const, value: '/etc/waia/"quoted"' },
    ];
    expect(() =>
      renderFhvSystemdUnits(sampleUnitConfig({ environmentFile: cases[0]!.value })),
    ).not.toThrow();
    for (const unsafe of cases.slice(1)) {
      expect(() =>
        renderFhvSystemdUnits(sampleUnitConfig({ [unsafe.field]: unsafe.value })),
      ).toThrow(/absolute safe path|UNSAFE_PATH_CHARACTERS|INVALID_ABSOLUTE_PATH/);
    }
  });

  it("rejects newline injection in environmentFile", () => {
    expect(() =>
      renderFhvSystemdUnits(
        sampleUnitConfig({ environmentFile: "/etc/waia/fhv.env\nExecStart=evil" }),
      ),
    ).toThrow(/UNSAFE_PATH_CHARACTERS|absolute safe path/);
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
      organizationId: "00000000-0000-4000-8000-000000000416",
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
        organizationId: "00000000-0000-4000-8000-000000000416",
        operatorId: "op",
        reason: "pause drill",
      });
      expect(result.enforcementApplied).toBe(true);
      expect(executor.systemctlCalls).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes resume marker before systemctl start on RESUME_FROM_CHECKPOINT", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-systemd-resume-"));
    try {
      const executor = createRecordingLinuxSystemdCampaignControlExecutor({
        hostOsQualified: true,
        deploymentEnabled: true,
        runRoot: root,
        spawnSystemctl: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
      });
      const result = await executor.execute({
        action: "RESUME_FROM_CHECKPOINT",
        runId: "run-1",
        organizationId: "00000000-0000-4000-8000-000000000416",
        operatorId: "op",
        reason: "resume drill",
      });
      expect(result.enforcementApplied).toBe(true);
      expect(result.outcome).toBe("executed");
      expect(executor.systemctlCalls).toHaveLength(1);
      const marker = join(root, "control", "resume_from_checkpoint-request.v1.json");
      expect(existsSync(marker)).toBe(true);
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
        organizationId: "00000000-0000-4000-8000-000000000416",
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
      organizationId: "00000000-0000-4000-8000-000000000416",
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
        organizationId: "00000000-0000-4000-8000-000000000416",
        artifactRoot: root,
      }),
    );
    expect(() =>
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId,
        organizationId: "00000000-0000-4000-8000-000000000416",
        artifactRoot: root,
      }),
    ).toThrow(/Rehearsal run directory already exists|RUN_DIRECTORY_COLLISION/);
    expect(() =>
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: "another-run",
        organizationId: "00000000-0000-4000-8000-000000000416",
        artifactRoot: root,
        maxRuntimeMs: FHV_REHEARSAL_MAX_RUNTIME_MS + 1,
      }),
    ).toThrow(/Rehearsal runtime must be >0 and <= 300000ms/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("DEE-424 guarded installer scripts", () => {
  const installArgs = [
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
    "00000000-0000-4000-8000-000000000416",
  ];

  function runScript(
    scriptRel: string,
    args: string[],
    mockBin: string,
    extraEnv: Record<string, string> = {},
  ): { stdout: string; stderr: string; status: number } {
    const script = join(process.cwd(), scriptRel);
    const result = spawnSync("bash", [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${mockBin}:${process.env.PATH ?? ""}`, ...extraEnv },
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      status: result.status ?? 1,
    };
  }

  function writeMockBin(
    overrides: {
      analyzeExit?: number;
      systemctl?: string;
    } = {},
  ): string {
    const mockBin = mkdtempSync(join(tmpdir(), "fhv-mock-bin-"));
    writeFileSync(
      join(mockBin, "systemd-analyze"),
      `#!/usr/bin/env bash\nexit ${overrides.analyzeExit ?? 0}\n`,
    );
    chmodSync(join(mockBin, "systemd-analyze"), 0o755);
    writeFileSync(
      join(mockBin, "systemctl"),
      overrides.systemctl ??
        `#!/usr/bin/env bash
case "$1" in
  daemon-reload) exit 0 ;;
  enable) exit 0 ;;
  stop) exit 0 ;;
  disable) exit 0 ;;
  is-active) exit 1 ;;
  is-enabled) exit 1 ;;
  *) exit 0 ;;
esac
`,
    );
    chmodSync(join(mockBin, "systemctl"), 0o755);
    return mockBin;
  }

  it("install-units.sh exits without mutation when --confirm is absent", () => {
    const mockBin = writeMockBin();
    const result = runScript("scripts/ops/fhv-supervisor/install-units.sh", installArgs, mockBin);
    const combined = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(0);
    expect(combined).toContain("No mutation performed");
    expect(combined).toContain("planned: install");
    rmSync(mockBin, { recursive: true, force: true });
  });

  it("rollback-units.sh exits without mutation when --confirm is absent", () => {
    const mockBin = writeMockBin();
    const result = runScript("scripts/ops/fhv-supervisor/rollback-units.sh", [], mockBin);
    const combined = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(0);
    expect(combined).toContain("No mutation performed");
    expect(combined).toContain("planned: systemctl stop");
    rmSync(mockBin, { recursive: true, force: true });
  });

  it("render-units.sh fails when systemd-analyze verify fails", () => {
    const mockBin = writeMockBin({ analyzeExit: 1 });
    const outputDir = mkdtempSync(join(tmpdir(), "fhv-render-out-"));
    const result = runScript(
      "scripts/ops/fhv-supervisor/render-units.sh",
      [...installArgs, "--output-dir", outputDir],
      mockBin,
    );
    expect(result.status).not.toBe(0);
    rmSync(mockBin, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });

  it("install-units.sh with --confirm does not install when verify fails", () => {
    const mockBin = writeMockBin({ analyzeExit: 1 });
    const systemdDir = mkdtempSync(join(tmpdir(), "fhv-systemd-dir-"));
    const result = runScript(
      "scripts/ops/fhv-supervisor/install-units.sh",
      [...installArgs, "--confirm", "--systemd-dir", systemdDir],
      mockBin,
    );
    expect(result.status).not.toBe(0);
    expect(readdirSync(systemdDir)).toHaveLength(0);
    rmSync(mockBin, { recursive: true, force: true });
    rmSync(systemdDir, { recursive: true, force: true });
  });

  it("install-units.sh with --confirm installs only allowlisted units when verify passes", () => {
    const mockBin = writeMockBin();
    const systemdDir = mkdtempSync(join(tmpdir(), "fhv-systemd-dir-"));
    const result = runScript(
      "scripts/ops/fhv-supervisor/install-units.sh",
      [...installArgs, "--confirm", "--systemd-dir", systemdDir],
      mockBin,
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Install complete");
    const installed = readdirSync(systemdDir).sort();
    expect(installed).toEqual(["waia-fhv-campaign.service", "waia-fhv-observer.service"]);
    rmSync(mockBin, { recursive: true, force: true });
    rmSync(systemdDir, { recursive: true, force: true });
  });
});
