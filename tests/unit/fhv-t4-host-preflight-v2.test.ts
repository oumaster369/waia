import { describe, expect, it } from "vitest";

import {
  FHV_T4_HOST_PREFLIGHT_SCHEMA_VERSION,
  FhvT4HostPreflightError,
  parseFhvT4HostPreflightV2,
} from "@/lib/trader/observability/fhv-t4-host-preflight";
import { FHV_T4_TEST_BOOT_ID } from "../helpers/fhv-t4-test-fixtures";

function validPreflight(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: FHV_T4_HOST_PREFLIGHT_SCHEMA_VERSION,
    classification: "FHV_T4_HOST_PREFLIGHT_PASS",
    hostname: "exec.test",
    machineIdSha256: "a".repeat(64),
    serviceUser: "fhv",
    serviceUid: 1001,
    serviceGid: 1001,
    servicePrimaryGroup: "fhv",
    environmentFile: "/etc/fhv.env",
    artifactRoot: "/var/fhv/artifacts",
    checkoutParent: "/var/fhv/checkouts",
    nodeBin: "/usr/bin/node",
    corepackBin: "/usr/bin/corepack",
    gitBin: "/usr/bin/git",
    pythonBin: "/usr/bin/python3",
    dockerBin: "/usr/bin/docker",
    systemctlBin: "/usr/bin/systemctl",
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
    legacyContainerName: "ai-trader-execution-host",
    legacyContainerImage: "waia-execution-host:test",
    legacyContainerState: "running",
    hostBootId: FHV_T4_TEST_BOOT_ID,
    minimumFreeKiB: 1000,
    observedFreeKiB: 5000,
    hostMonotonicSample: {
      schemaVersion: "fhv-t4-host-monotonic-sample/v1",
      clockSource: "CLOCK_BOOTTIME",
      bootId: FHV_T4_TEST_BOOT_ID,
      monotonicNs: "1000000",
    },
    ...overrides,
  };
}

describe("parseFhvT4HostPreflightV2 (DEE-436 F-06)", () => {
  it("requires systemctlBin, systemdAnalyzeBin, and hostBootId", () => {
    const parsed = parseFhvT4HostPreflightV2(validPreflight());
    expect(parsed.systemctlBin).toBe("/usr/bin/systemctl");
    expect(parsed.systemdAnalyzeBin).toBe("/usr/bin/systemd-analyze");
    expect(parsed.hostBootId).toBe(FHV_T4_TEST_BOOT_ID);
  });

  it("rejects missing hostBootId", () => {
    expect(() => parseFhvT4HostPreflightV2(validPreflight({ hostBootId: "" }))).toThrow(
      FhvT4HostPreflightError,
    );
    try {
      parseFhvT4HostPreflightV2(validPreflight({ hostBootId: "" }));
    } catch (error) {
      expect((error as FhvT4HostPreflightError).code).toBe("FHV_T4_PREFLIGHT_FIELD_MISSING");
    }
  });

  it("rejects malformed hostBootId", () => {
    expect(() => parseFhvT4HostPreflightV2(validPreflight({ hostBootId: "not-a-uuid" }))).toThrow();
  });

  it("rejects hostBootId mismatch with hostMonotonicSample.bootId", () => {
    expect(() =>
      parseFhvT4HostPreflightV2(
        validPreflight({
          hostMonotonicSample: {
            schemaVersion: "fhv-t4-host-monotonic-sample/v1",
            clockSource: "CLOCK_BOOTTIME",
            bootId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            monotonicNs: "1000000",
          },
        }),
      ),
    ).toThrow(FhvT4HostPreflightError);

    try {
      parseFhvT4HostPreflightV2(
        validPreflight({
          hostMonotonicSample: {
            schemaVersion: "fhv-t4-host-monotonic-sample/v1",
            clockSource: "CLOCK_BOOTTIME",
            bootId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            monotonicNs: "1000000",
          },
        }),
      );
    } catch (error) {
      expect((error as FhvT4HostPreflightError).code).toBe("PREFLIGHT_HOST_BOOT_ID_DROPPED");
    }
  });

  it("rejects missing mandatory systemd tool paths", () => {
    expect(() => parseFhvT4HostPreflightV2(validPreflight({ systemctlBin: "" }))).toThrow(
      FhvT4HostPreflightError,
    );
    expect(() => parseFhvT4HostPreflightV2(validPreflight({ systemdAnalyzeBin: "  " }))).toThrow(
      FhvT4HostPreflightError,
    );
    try {
      parseFhvT4HostPreflightV2(validPreflight({ systemctlBin: "" }));
    } catch (error) {
      expect((error as FhvT4HostPreflightError).code).toBe("FHV_T4_PREFLIGHT_FIELD_MISSING");
    }
  });
});
