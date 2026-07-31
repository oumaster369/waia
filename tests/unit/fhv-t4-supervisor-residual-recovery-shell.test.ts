import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  assertFhvT4aSupervisorResidualStateSafe,
  parseFhvT4aSupervisorResidualStateProof,
} from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";

const ROOT = process.cwd();
const RECOVERY_SCRIPT = join(ROOT, "scripts/ops/fhv-t4-supervisor-residual-recovery.sh");
const IS_LINUX = process.platform === "linux";

function resolveRecoveryShellPythonBin(): string {
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

function writeMockTooling(binDir: string, logPath: string, statePath: string): void {
  writeFileSync(statePath, "failed\n");
  writeFileSync(
    join(binDir, "uname"),
    `#!/usr/bin/env bash
echo Linux
`,
  );
  chmodSync(join(binDir, "uname"), 0o755);

  const systemctl = `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${logPath}"
cmd="$1"
shift || true
state_file="${statePath}"
read -r campaign_state < "$state_file" || campaign_state=failed
case "$cmd" in
  is-active)
    unit="$1"
    if [[ "$unit" == "waia-fhv-campaign.service" && "$campaign_state" == "failed" ]]; then
      echo failed
      exit 1
    fi
    echo inactive
    exit 3
    ;;
  is-enabled)
    unit="$1"
    if [[ "$unit" == "waia-fhv-campaign.service" && "$campaign_state" == "failed" ]]; then
      echo enabled
      exit 0
    fi
    echo disabled
    exit 1
    ;;
  show)
    unit=""
    field=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -p) field="$2"; shift 2 ;;
        *) unit="$1"; shift ;;
      esac
    done
    if [[ "$unit" == "waia-fhv-campaign.service" && "$campaign_state" == "failed" ]]; then
      case "$field" in
        ActiveState) echo failed ;;
        SubState) echo failed ;;
        Result) echo failed ;;
        LoadState) echo loaded ;;
        FragmentPath) echo "/etc/systemd/system/$unit" ;;
        ExecStart) echo "/usr/bin/node campaign" ;;
        WorkingDirectory) echo "/opt/waia/waia-failed" ;;
        EnvironmentFile) echo "/etc/waia/fhv.env" ;;
        *) echo "" ;;
      esac
      exit 0
    fi
    case "$field" in
      ActiveState) echo inactive ;;
      SubState) echo dead ;;
      Result) echo success ;;
      LoadState) echo loaded ;;
      FragmentPath) echo "/etc/systemd/system/$unit" ;;
      ExecStart) echo "/usr/bin/node observer" ;;
      WorkingDirectory) echo "/opt/waia/waia-failed" ;;
      EnvironmentFile) echo "/etc/waia/fhv.env" ;;
      *) echo "" ;;
    esac
    ;;
  reset-failed)
    echo recovered > "$state_file"
    ;;
  stop|disable|daemon-reload)
    ;;
  *)
    ;;
esac
`;
  writeFileSync(join(binDir, "systemctl"), systemctl);
  chmodSync(join(binDir, "systemctl"), 0o755);
}

describe("fhv-t4 supervisor residual recovery shell (DEE-436)", () => {
  it.skipIf(!IS_LINUX)(
    "executes reset-failed for failed campaign unit and leaves PRE_AUTH-safe after-state",
    () => {
      const work = mkdtempSync(join(tmpdir(), "fhv-t4-recovery-shell-"));
      const binDir = join(work, "bin");
      const systemdDir = join(work, "systemd");
      const logPath = join(work, "systemctl.log");
      const statePath = join(work, "campaign.state");
      mkdirSync(binDir, { recursive: true });
      mkdirSync(systemdDir, { recursive: true });
      writeMockTooling(binDir, logPath, statePath);

      writeFileSync(
        join(systemdDir, "waia-fhv-campaign.service"),
        `[Service]
Environment=FHV_RUN_ID=fhv-t4a-failed-run
Environment=FHV_TARGET_SHA=${"a".repeat(40)}
Environment=FHV_ORGANIZATION_ID=00000000-0000-4000-8000-000000000436
`,
      );
      writeFileSync(join(systemdDir, "waia-fhv-observer.service"), "[Service]\n");

      const hostname = execFileSync("hostname", [], { encoding: "utf8" }).trim();
      const machineIdSha256 = execFileSync(
        "sh",
        ["-c", "sha256sum /etc/machine-id | awk '{print $1}'"],
        {
          encoding: "utf8",
        },
      ).trim();

      const env = {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION: "AUTHORIZE-FHV-T4A-RESIDUAL-UNIT-RECOVERY",
      };

      const stdout = execFileSync(
        "bash",
        [
          RECOVERY_SCRIPT,
          "--confirm",
          "--systemctl-bin",
          join(binDir, "systemctl"),
          "--python-bin",
          resolveRecoveryShellPythonBin(),
          "--systemd-dir",
          systemdDir,
          "--failed-run-id",
          "fhv-t4a-failed-run",
          "--failed-target-sha",
          "a".repeat(40),
          "--failed-release-tag",
          "v2026.test.failed",
          "--expected-hostname",
          hostname,
          "--expected-machine-id-sha256",
          machineIdSha256,
          "--expected-organization-id",
          "00000000-0000-4000-8000-000000000436",
          "--expected-operator-id",
          "operator-test",
        ],
        { encoding: "utf8", env },
      );

      const log = readFileSync(logPath, "utf8");
      expect(log).toContain("reset-failed waia-fhv-campaign.service");

      const payloadLine = stdout
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.includes("fhv-t4-supervisor-residual-recovery/v1"));
      expect(payloadLine).toBeDefined();
      const payload = JSON.parse(payloadLine!) as {
        classification: string;
        afterState: { units: Array<Record<string, unknown>> };
      };
      expect(payload.classification).toBe("FHV_T4A_RESIDUAL_RECOVERY_OK");
      for (const unit of payload.afterState.units) {
        expect(unit.enabledState).not.toBe("enabled");
        expect(unit.activeClass).not.toBe("active");
        expect(unit.isFailed).toBe(false);
        expect(unit.activeState).not.toBe("failed");
        expect(unit.subState).not.toBe("failed");
      }

      const proof = parseFhvT4aSupervisorResidualStateProof({
        schemaVersion: "fhv-t4-supervisor-residual-state/v1",
        expectedRunId: "fresh-run",
        expectedTargetSha: "b".repeat(40),
        expectedOrganizationId: "00000000-0000-4000-8000-000000000436",
        expectedHostname: hostname,
        expectedMachineIdSha256: machineIdSha256,
        observedHostname: hostname,
        observedMachineIdSha256: machineIdSha256,
        hostBootId: "test-boot",
        units: payload.afterState.units,
      });
      expect(() => assertFhvT4aSupervisorResidualStateSafe(proof)).not.toThrow();

      if (existsSync(work)) {
        rmSync(work, { recursive: true, force: true });
      }
    },
  );
});
