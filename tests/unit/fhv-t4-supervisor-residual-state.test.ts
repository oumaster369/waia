import { describe, expect, it } from "vitest";

import {
  assertFhvT4aSupervisorResidualStateSafe,
  assertResidualProofMatchesFreshRunBindings,
  classifyFhvT4aSupervisorResidualState,
  parseFhvT4aSupervisorResidualStateProof,
} from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";
import { FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL } from "@/lib/trader/observability/fhv-t4a-operator-contract";

const TARGET_SHA = "a".repeat(40);
const RUN_ID = "fhv-t4a-residual-test";
const ORG_ID = "00000000-0000-4000-8000-000000000436";

function unit(
  overrides: Partial<{
    unitName: "waia-fhv-observer.service" | "waia-fhv-campaign.service";
    enabledState: string;
    activeClass: string;
    isFailed: boolean;
    activeState: string;
    subState: string;
    unitFileExists: boolean;
    embeddedRunId: string | null;
    embeddedTargetSha: string | null;
    embeddedOrganizationId: string | null;
  }> = {},
) {
  const unitName = overrides.unitName ?? "waia-fhv-observer.service";
  return {
    unitName,
    unitFileExists: overrides.unitFileExists ?? false,
    unitFilePath: `/etc/systemd/system/${unitName}`,
    unitFileSha256: null,
    loadState: overrides.unitFileExists ? "loaded" : "not-found",
    unitFileState: overrides.unitFileExists ? "enabled" : "absent",
    activeState: overrides.activeState ?? "inactive",
    subState: overrides.subState ?? "dead",
    fragmentPath: "",
    enabledState: overrides.enabledState ?? "not-found",
    activeClass: overrides.activeClass ?? "inactive",
    isFailed: overrides.isFailed ?? false,
    execStart: "",
    workingDirectory: "",
    environmentFilePath: "/etc/waia/fhv.env",
    embeddedRunId: overrides.embeddedRunId ?? null,
    embeddedTargetSha: overrides.embeddedTargetSha ?? null,
    embeddedOrganizationId: overrides.embeddedOrganizationId ?? null,
  };
}

function proof(
  units: ReturnType<typeof unit>[],
  hostOverrides: Partial<{ hostname: string; machineIdSha256: string }> = {},
) {
  return {
    schemaVersion: "fhv-t4-supervisor-residual-state/v1" as const,
    expectedRunId: RUN_ID,
    expectedTargetSha: TARGET_SHA,
    expectedOrganizationId: ORG_ID,
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "b".repeat(64),
    observedHostname: hostOverrides.hostname ?? "exec.test",
    observedMachineIdSha256: hostOverrides.machineIdSha256 ?? "b".repeat(64),
    hostBootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    units,
  };
}

describe("fhv-t4 supervisor residual state (DEE-436)", () => {
  it("accepts absent/disabled/inactive units as safe", () => {
    const parsed = parseFhvT4aSupervisorResidualStateProof(
      proof([
        unit({ unitName: "waia-fhv-observer.service" }),
        unit({ unitName: "waia-fhv-campaign.service" }),
      ]),
    );
    expect(classifyFhvT4aSupervisorResidualState(parsed)).toBe("FHV_T4A_SUPERVISOR_RESIDUAL_SAFE");
    expect(() => assertFhvT4aSupervisorResidualStateSafe(parsed)).not.toThrow();
  });

  it("accepts present disabled/inactive residual unit files as safe", () => {
    const parsed = parseFhvT4aSupervisorResidualStateProof(
      proof([
        unit({
          unitName: "waia-fhv-observer.service",
          unitFileExists: true,
          enabledState: "disabled",
          embeddedRunId: "old-run",
          embeddedTargetSha: "c".repeat(40),
        }),
        unit({
          unitName: "waia-fhv-campaign.service",
          unitFileExists: true,
          enabledState: "disabled",
        }),
      ]),
    );
    expect(classifyFhvT4aSupervisorResidualState(parsed)).toBe("FHV_T4A_SUPERVISOR_RESIDUAL_SAFE");
  });

  it("blocks enabled residual units", () => {
    const parsed = parseFhvT4aSupervisorResidualStateProof(
      proof([
        unit({
          unitName: "waia-fhv-observer.service",
          enabledState: "enabled",
          unitFileExists: true,
        }),
        unit({ unitName: "waia-fhv-campaign.service" }),
      ]),
    );
    expect(classifyFhvT4aSupervisorResidualState(parsed)).toBe(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_ENABLED",
    );
  });

  it("blocks active residual units", () => {
    const parsed = parseFhvT4aSupervisorResidualStateProof(
      proof([
        unit({
          unitName: "waia-fhv-observer.service",
          activeClass: "active",
          activeState: "active",
          unitFileExists: true,
        }),
        unit({ unitName: "waia-fhv-campaign.service" }),
      ]),
    );
    expect(classifyFhvT4aSupervisorResidualState(parsed)).toBe(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_ACTIVE",
    );
  });

  it("blocks failed residual units", () => {
    const parsed = parseFhvT4aSupervisorResidualStateProof(
      proof([
        unit({
          unitName: "waia-fhv-campaign.service",
          isFailed: true,
          activeState: "failed",
          subState: "failed",
          unitFileExists: true,
        }),
        unit({ unitName: "waia-fhv-observer.service" }),
      ]),
    );
    expect(classifyFhvT4aSupervisorResidualState(parsed)).toBe(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_FAILED",
    );
  });

  it("blocks host identity drift", () => {
    const parsed = parseFhvT4aSupervisorResidualStateProof(
      proof(
        [
          unit({ unitName: "waia-fhv-observer.service" }),
          unit({ unitName: "waia-fhv-campaign.service" }),
        ],
        { hostname: "wrong.host" },
      ),
    );
    expect(classifyFhvT4aSupervisorResidualState(parsed)).toBe(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_HOST_IDENTITY",
    );
  });

  it("binds residual proof to fresh run identity", () => {
    const parsed = parseFhvT4aSupervisorResidualStateProof(
      proof([
        unit({ unitName: "waia-fhv-observer.service" }),
        unit({ unitName: "waia-fhv-campaign.service" }),
      ]),
    );
    assertResidualProofMatchesFreshRunBindings({
      proof: parsed,
      runId: RUN_ID,
      targetSha: TARGET_SHA,
      organizationId: ORG_ID,
      expectedHostname: "exec.test",
      expectedMachineIdSha256: "b".repeat(64),
    });
  });

  it("documents the recovery authorization literal", () => {
    expect(FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL).toBe(
      "AUTHORIZE-FHV-T4A-RESIDUAL-UNIT-RECOVERY",
    );
  });
});
