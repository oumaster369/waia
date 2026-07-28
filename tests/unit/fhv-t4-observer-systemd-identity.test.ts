import { describe, expect, it } from "vitest";

import {
  assertFhvT4CampaignProcessUnchanged,
  assertFhvT4ObserverRestartProven,
  FHV_T4_OBSERVER_SYSTEMD_IDENTITY_SCHEMA_VERSION,
  FhvT4ObserverSystemdIdentityError,
  parseFhvT4ObserverSystemdIdentity,
} from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";

const LINUX_BOOT_ID = "f4707dfd-dea7-421f-a27f-a5e1c54015c5";
const LINUX_BOOT_ID_HEX = "f4707dfddea7421fa27fa5e1c54015c5";

function validIdentity(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: FHV_T4_OBSERVER_SYSTEMD_IDENTITY_SCHEMA_VERSION,
    unitName: "waia-fhv-observer.service",
    bootId: LINUX_BOOT_ID,
    invocationId: "11111111111111111111111111111111",
    mainPid: 1001,
    activeEnterTimestampMonotonicUs: "1000000",
    activeState: "active",
    ...overrides,
  };
}

describe("fhv-t4 observer systemd identity parser (DEE-436 boot-id contract)", () => {
  it("accepts hyphenated lowercase Linux UUID and returns canonical bootId", () => {
    const parsed = parseFhvT4ObserverSystemdIdentity(validIdentity());
    expect(parsed.bootId).toBe(LINUX_BOOT_ID);
  });

  it("accepts 32-char lowercase hex and normalizes to canonical hyphenated UUID", () => {
    const parsed = parseFhvT4ObserverSystemdIdentity(validIdentity({ bootId: LINUX_BOOT_ID_HEX }));
    expect(parsed.bootId).toBe(LINUX_BOOT_ID);
  });

  it("rejects malformed bootId with FHV_T4_OBSERVER_IDENTITY_BOOT_ID_INVALID", () => {
    try {
      parseFhvT4ObserverSystemdIdentity(validIdentity({ bootId: "not-a-boot-id" }));
      expect.unreachable("malformed bootId should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4ObserverSystemdIdentityError);
      expect((error as FhvT4ObserverSystemdIdentityError).code).toBe(
        "FHV_T4_OBSERVER_IDENTITY_BOOT_ID_INVALID",
      );
    }
  });

  it("rejects non-string, empty, and whitespace-only bootId values", () => {
    for (const bootId of [null, 42, "", "   "]) {
      try {
        parseFhvT4ObserverSystemdIdentity(validIdentity({ bootId }));
        expect.unreachable(`bootId ${String(bootId)} should fail`);
      } catch (error) {
        expect(error).toBeInstanceOf(FhvT4ObserverSystemdIdentityError);
        expect((error as FhvT4ObserverSystemdIdentityError).code).toBe(
          "FHV_T4_OBSERVER_IDENTITY_BOOT_ID_INVALID",
        );
      }
    }
  });

  it("normalizes uppercase UUID according to canonical utility contract", () => {
    const parsed = parseFhvT4ObserverSystemdIdentity(
      validIdentity({ bootId: LINUX_BOOT_ID.toUpperCase() }),
    );
    expect(parsed.bootId).toBe(LINUX_BOOT_ID);
  });

  it("still enforces other required observer identity fields", () => {
    try {
      parseFhvT4ObserverSystemdIdentity(validIdentity({ mainPid: 0 }));
      expect.unreachable("invalid mainPid should fail");
    } catch (error) {
      expect((error as FhvT4ObserverSystemdIdentityError).code).toBe(
        "FHV_T4_OBSERVER_IDENTITY_MAIN_PID_INVALID",
      );
    }
  });

  it("assertFhvT4ObserverRestartProven treats mixed boot-id representations as equal", () => {
    const before = parseFhvT4ObserverSystemdIdentity(
      validIdentity({
        bootId: LINUX_BOOT_ID_HEX,
        invocationId: "11111111111111111111111111111111",
        mainPid: 1001,
      }),
    );
    const after = parseFhvT4ObserverSystemdIdentity(
      validIdentity({
        bootId: LINUX_BOOT_ID,
        invocationId: "22222222222222222222222222222222",
        mainPid: 1002,
        activeEnterTimestampMonotonicUs: "2000000",
      }),
    );
    expect(() => assertFhvT4ObserverRestartProven({ before, after })).not.toThrow();
  });

  it("assertFhvT4ObserverRestartProven rejects genuinely different boot IDs", () => {
    const before = parseFhvT4ObserverSystemdIdentity(validIdentity());
    const after = parseFhvT4ObserverSystemdIdentity(
      validIdentity({
        bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        invocationId: "22222222222222222222222222222222",
        mainPid: 1002,
        activeEnterTimestampMonotonicUs: "2000000",
      }),
    );
    try {
      assertFhvT4ObserverRestartProven({ before, after });
      expect.unreachable("boot id change should fail restart proof");
    } catch (error) {
      expect((error as FhvT4ObserverSystemdIdentityError).code).toBe(
        "FHV_T4_OBSERVER_RESTART_BOOT_ID_CHANGED",
      );
    }
  });

  it("assertFhvT4CampaignProcessUnchanged treats mixed boot-id representations as equal", () => {
    const before = parseFhvT4ObserverSystemdIdentity(validIdentity({ bootId: LINUX_BOOT_ID_HEX }));
    const after = parseFhvT4ObserverSystemdIdentity(validIdentity({ bootId: LINUX_BOOT_ID }));
    expect(() => assertFhvT4CampaignProcessUnchanged({ before, after })).not.toThrow();
  });
});
