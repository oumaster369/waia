import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FHV_T4_COMPLETED_CAMPAIGN_SYSTEMD_IDENTITY_SCHEMA_VERSION,
  FhvT4CompletedCampaignSystemdIdentityError,
  readFhvT4CompletedCampaignSystemdIdentity,
  serializeFhvT4CompletedCampaignSystemdIdentity,
  setFhvT4CompletedCampaignSystemdIdentityReaderForTests,
} from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import {
  FHV_T4_OBSERVER_SYSTEMD_IDENTITY_SCHEMA_VERSION,
  FhvT4ObserverSystemdIdentityError,
  readFhvT4ObserverSystemdIdentity,
  setFhvT4ObserverSystemdIdentityReaderForTests,
} from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";
import {
  buildFhvT4RestrictedChildEnv,
  FHV_T4_RESTRICTED_CHILD_PATH,
} from "@/lib/trader/observability/fhv-t4-restricted-child-env";
import { captureFhvT4ContinuitySnapshot } from "@/lib/trader/observability/fhv-t4-continuity-capture";
import {
  resolveFhvRehearsalAlertPolicyDigest,
  resolveFhvRehearsalRunDirectory,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import {
  fhvT4CompletedCampaignIdentity,
  fhvT4ObserverIdentity,
  writeFhvT4TestCampaignRuntimeProof,
} from "../helpers/fhv-t4-test-fixtures";
import { writeFhvSystemdDeployedRevisionAtomic } from "@/lib/trader/observability/fhv-systemd-deployed-revision";

const ROOT = process.cwd();
const IS_LINUX = process.platform === "linux";

const OBSERVER_UNIT = FHV_SYSTEMD_OBSERVER_UNIT;
const CAMPAIGN_UNIT = FHV_SYSTEMD_CAMPAIGN_UNIT;

function resolvePythonBin(): string {
  const fromEnv = process.env.FHV_PYTHON_BIN?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
  } catch {
    return "/usr/bin/python3";
  }
}

function writeEnvBashFixture(dir: string, name: string, body: string): string {
  const scriptPath = join(dir, name);
  writeFileSync(scriptPath, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeIdentityMockSystemctl(binDir: string): string {
  const systemctlPath = join(binDir, "systemctl");
  writeFileSync(
    systemctlPath,
    `#!/usr/bin/env bash
set -euo pipefail
cmd="$1"
shift || true
unit=""
field=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p) field="$2"; shift 2 ;;
    --value) shift ;;
    *) unit="$1"; shift ;;
  esac
done
if [[ "$unit" == "${OBSERVER_UNIT}" ]]; then
  case "$field" in
    InvocationID) echo "11111111111111111111111111111111" ;;
    MainPID) echo "4242" ;;
    ActiveState) echo "active" ;;
    ActiveEnterTimestampMonotonic) echo "9000000" ;;
    *) echo "" ;;
  esac
  exit 0
fi
if [[ "$unit" == "${CAMPAIGN_UNIT}" ]]; then
  case "$field" in
    InvocationID) echo "22222222222222222222222222222222" ;;
    ActiveState) echo "inactive" ;;
    SubState) echo "dead" ;;
    Result) echo "success" ;;
    ExecMainPID) echo "5151" ;;
    ExecMainStartTimestampMonotonic) echo "8000000" ;;
    ExecMainExitTimestampMonotonic) echo "8100000" ;;
    ExecMainCode) echo "1" ;;
    ExecMainStatus) echo "0" ;;
    NRestarts) echo "0" ;;
    *) echo "" ;;
  esac
  exit 0
fi
echo ""
`,
  );
  chmodSync(systemctlPath, 0o755);
  return systemctlPath;
}

let workDir = "";

afterEach(() => {
  setFhvT4ObserverSystemdIdentityReaderForTests(null);
  setFhvT4CompletedCampaignSystemdIdentityReaderForTests(null);
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = "";
  }
});

describe("fhv-t4 restricted child PATH (DEE-436 Step 26 repair)", () => {
  it("sets exactly /usr/bin:/bin and never inherits ambient PATH", () => {
    const childEnv = buildFhvT4RestrictedChildEnv({
      ...process.env,
      PATH: "/tmp/malicious-bin:/evil",
      FHV_RUN_ID: "fhv-t4a-path-test",
    });
    expect(childEnv.PATH).toBe(FHV_T4_RESTRICTED_CHILD_PATH);
    expect(childEnv.FHV_RUN_ID).toBe("fhv-t4a-path-test");
  });

  it("reproduces /usr/bin/env bash failure under zero-length PATH", () => {
    workDir = mkdtempSync(join(tmpdir(), "fhv-t4-path-empty-"));
    const script = writeEnvBashFixture(workDir, "env-bash-probe.sh", 'echo "resolved"');
    expect(() =>
      execFileSync(script, [], {
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
      }),
    ).toThrow(/bash|ENOENT/i);
  });

  it("resolves /usr/bin/env bash under the restricted PATH", () => {
    workDir = mkdtempSync(join(tmpdir(), "fhv-t4-path-restricted-"));
    const script = writeEnvBashFixture(workDir, "env-bash-probe.sh", 'echo "resolved"');
    const output = execFileSync(script, [], {
      encoding: "utf8",
      env: buildFhvT4RestrictedChildEnv(process.env),
    }).trim();
    expect(output).toBe("resolved");
  });

  it("does not execute a malicious bash from an ambient PATH directory", () => {
    workDir = mkdtempSync(join(tmpdir(), "fhv-t4-path-malicious-"));
    const maliciousBin = join(workDir, "malicious-bin");
    const script = writeEnvBashFixture(workDir, "env-bash-probe.sh", 'echo "resolved"');
    mkdirSync(maliciousBin, { recursive: true });
    writeFileSync(join(maliciousBin, "bash"), `#!/bin/sh\necho "malicious"\n`);
    chmodSync(join(maliciousBin, "bash"), 0o755);

    const baseEnv = { HOME: process.env.HOME ?? "/tmp", PATH: "" } as unknown as NodeJS.ProcessEnv;
    const ambientOutput = execFileSync(script, [], {
      encoding: "utf8",
      env: { ...baseEnv, PATH: `${maliciousBin}:/usr/bin:/bin` },
    }).trim();
    expect(ambientOutput).toBe("malicious");

    const restrictedOutput = execFileSync(script, [], {
      encoding: "utf8",
      env: buildFhvT4RestrictedChildEnv({
        ...baseEnv,
        PATH: `${maliciousBin}:/usr/bin:/bin`,
      }),
    }).trim();
    expect(restrictedOutput).toBe("resolved");
  });

  it("regresses if identity readers revert to zero-length PATH", () => {
    workDir = mkdtempSync(join(tmpdir(), "fhv-t4-path-regression-"));
    const script = writeEnvBashFixture(workDir, "env-bash-probe.sh", 'echo "resolved"');
    expect(() =>
      execFileSync(script, [], {
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
      }),
    ).toThrow(/bash|ENOENT/i);
    expect(
      execFileSync(script, [], {
        encoding: "utf8",
        env: buildFhvT4RestrictedChildEnv(process.env),
      }).trim(),
    ).toBe("resolved");
  });

  it("still requires absolute systemctl and python bindings for observer reader", () => {
    try {
      readFhvT4ObserverSystemdIdentity(ROOT, OBSERVER_UNIT, process.env, {
        systemctlBin: "systemctl",
        pythonBin: resolvePythonBin(),
      });
      expect.unreachable("relative systemctl path should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4ObserverSystemdIdentityError);
      expect((error as FhvT4ObserverSystemdIdentityError).code).toBe(
        "CONTINUITY_IDENTITY_TOOL_BINDING_MISSING",
      );
    }
  });

  it("still requires absolute systemctl and python bindings for completed-campaign reader", () => {
    try {
      readFhvT4CompletedCampaignSystemdIdentity(ROOT, CAMPAIGN_UNIT, process.env, {
        systemctlBin: "systemctl",
        pythonBin: resolvePythonBin(),
      });
      expect.unreachable("relative systemctl path should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4CompletedCampaignSystemdIdentityError);
      expect((error as FhvT4CompletedCampaignSystemdIdentityError).code).toBe(
        "CONTINUITY_IDENTITY_TOOL_BINDING_MISSING",
      );
    }
  });

  it("preserves injected JSON identity paths without shell execution", () => {
    const observer = readFhvT4ObserverSystemdIdentity(ROOT, OBSERVER_UNIT, {
      ...process.env,
      FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON: JSON.stringify({
        schemaVersion: FHV_T4_OBSERVER_SYSTEMD_IDENTITY_SCHEMA_VERSION,
        unitName: OBSERVER_UNIT,
        bootId: "f4707dfd-dea7-421f-a27f-a5e1c54015c5",
        invocationId: "11111111111111111111111111111111",
        mainPid: 1001,
        activeEnterTimestampMonotonicUs: "1000000",
        activeState: "active",
      }),
    });
    expect(observer.mainPid).toBe(1001);

    const campaign = readFhvT4CompletedCampaignSystemdIdentity(ROOT, CAMPAIGN_UNIT, {
      ...process.env,
      FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON: JSON.stringify(
        serializeFhvT4CompletedCampaignSystemdIdentity({
          schemaVersion: FHV_T4_COMPLETED_CAMPAIGN_SYSTEMD_IDENTITY_SCHEMA_VERSION,
          unitName: CAMPAIGN_UNIT,
          bootId: "f4707dfd-dea7-421f-a27f-a5e1c54015c5",
          activeState: "inactive",
          subState: "dead",
          result: "success",
          invocationId: "22222222222222222222222222222222",
          execMainPid: 5151,
          execMainStartTimestampMonotonic: "8000000",
          execMainExitTimestampMonotonic: "8100000",
          execMainCode: 1,
          execMainStatus: 0,
          nRestarts: 0,
        }),
      ),
    });
    expect(campaign.execMainPid).toBe(5151);
  });

  it("continuity-before capture reaches identity parsing with injected identities", () => {
    workDir = mkdtempSync(join(tmpdir(), "fhv-t4-step26-continuity-"));
    const runId = "fhv-t4a-step26-path-test";
    const orgId = "00000000-0000-4000-8000-000000000436";
    const targetSha = "3fa104c03e440a9ccf2949a1a571939eeb2d453f";
    const runDir = resolveFhvRehearsalRunDirectory(workDir, runId);
    mkdirSync(join(runDir, "control"), { recursive: true });
    writeFileSync(
      join(runDir, "fhv-rehearsal-manifest.v1.json"),
      `${JSON.stringify(
        {
          schemaVersion: "fhv-rehearsal-launch/v1",
          fixtureId: "HTR_WP03_BENCHMARK",
          targetSha,
          runId,
          organizationId: orgId,
          artifactRoot: workDir,
          alertPolicyDigest: resolveFhvRehearsalAlertPolicyDigest(),
          maxRuntimeMs: 300_000,
          t4DeterministicPause: true,
          deterministicPauseAtCycle: 40,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(runDir, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_OK" }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "replay-checkpoint.json"),
      `${JSON.stringify(
        {
          rehearsalEconomicFrontierState: {
            mode: "QUIESCENT_NO_ECONOMIC_STATE",
            runId,
            organizationId: orgId,
            safeResumeThroughCycleIndex: 39,
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(runDir, "fhv-resume-runtime-proof.v1.json"),
      `${JSON.stringify({ fullHistoryRescanDelta: 0 }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "run-chain.json"),
      `${JSON.stringify({ schemaVersion: "htr-wp05-run-chain/v1", segments: [] }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "control/command-ledger.jsonl"),
      `${JSON.stringify({ command: { action: "PAUSE_AT_CHECKPOINT" } })}\n`,
    );
    writeFhvT4TestCampaignRuntimeProof(runDir, {
      runId,
      organizationId: orgId,
      targetSha,
    });
    writeFhvSystemdDeployedRevisionAtomic(workDir, {
      releaseSha: targetSha,
      releaseTag: "v2026.07.31.3fa104c",
      runId,
      organizationId: orgId,
      renderedUnitDigests: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "a".repeat(64),
        [FHV_SYSTEMD_OBSERVER_UNIT]: "b".repeat(64),
      },
      installedAtUtc: new Date().toISOString(),
      operatorId: "t4-operator",
      serviceUser: "fhv",
      legacyContainerRunning: true,
    });

    const observer = fhvT4ObserverIdentity({
      invocationId: "11111111111111111111111111111111",
      mainPid: 1001,
    });
    const campaign = fhvT4CompletedCampaignIdentity({ execMainPid: 5151 });

    const snapshot = captureFhvT4ContinuitySnapshot({
      runRoot: runDir,
      repoRoot: workDir,
      runId,
      organizationId: orgId,
      targetSha,
      capturePhase: "before_disconnect",
      observerSystemdIdentity: observer,
      campaignSystemdIdentity: campaign,
    });
    expect(snapshot.capturePhase).toBe("before_disconnect");
    expect(snapshot.observerSystemdIdentity.mainPid).toBe(1001);
    expect(snapshot.campaignSystemdIdentity.execMainPid).toBe(5151);
    expect(snapshot.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(!IS_LINUX)(
    "executes observer identity shell reader under restricted PATH on Linux",
    () => {
      workDir = mkdtempSync(join(tmpdir(), "fhv-t4-observer-identity-linux-"));
      const binDir = join(workDir, "bin");
      const systemctlBin = writeIdentityMockSystemctl(binDir);
      const pythonBin = resolvePythonBin();

      const identity = readFhvT4ObserverSystemdIdentity(ROOT, OBSERVER_UNIT, process.env, {
        systemctlBin,
        pythonBin,
      });
      expect(identity.unitName).toBe(OBSERVER_UNIT);
      expect(identity.activeState).toBe("active");
      expect(identity.mainPid).toBe(4242);
    },
  );

  it.skipIf(!IS_LINUX)(
    "executes completed-campaign identity shell reader under restricted PATH on Linux",
    () => {
      workDir = mkdtempSync(join(tmpdir(), "fhv-t4-campaign-identity-linux-"));
      const binDir = join(workDir, "bin");
      const systemctlBin = writeIdentityMockSystemctl(binDir);
      const pythonBin = resolvePythonBin();

      const identity = readFhvT4CompletedCampaignSystemdIdentity(ROOT, CAMPAIGN_UNIT, process.env, {
        systemctlBin,
        pythonBin,
      });
      expect(identity.unitName).toBe(CAMPAIGN_UNIT);
      expect(identity.activeState).toBe("inactive");
      expect(identity.result).toBe("success");
      expect(identity.execMainPid).toBe(5151);
    },
  );

  it.skipIf(!IS_LINUX)(
    'reproduces Step 26 /usr/bin/env bash failure when repository identity scripts run with PATH=""',
    () => {
      workDir = mkdtempSync(join(tmpdir(), "fhv-t4-step26-empty-path-linux-"));
      const binDir = join(workDir, "bin");
      const systemctlBin = writeIdentityMockSystemctl(binDir);
      const pythonBin = resolvePythonBin();
      const script = join(ROOT, "scripts/ops/fhv-t4-observer-systemd-identity-read.sh");

      expect(() =>
        execFileSync(
          script,
          ["--systemctl-bin", systemctlBin, "--python-bin", pythonBin, OBSERVER_UNIT],
          { encoding: "utf8", env: { ...process.env, PATH: "" } },
        ),
      ).toThrow(/bash|ENOENT/i);

      const output = execFileSync(
        script,
        ["--systemctl-bin", systemctlBin, "--python-bin", pythonBin, OBSERVER_UNIT],
        { encoding: "utf8", env: buildFhvT4RestrictedChildEnv(process.env) },
      ).trim();
      const parsed = JSON.parse(output) as { activeState: string; mainPid: number };
      expect(parsed.activeState).toBe("active");
      expect(parsed.mainPid).toBe(4242);
    },
  );
});
