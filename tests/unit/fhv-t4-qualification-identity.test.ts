import { describe, expect, it } from "vitest";

import {
  assertFhvT4aPostRestartInvocationChanged,
  assertFhvT4aQualificationIdentityCapture,
  assertFhvT4aQualificationIdentityStability,
  FHV_T4A_OBSERVER_QUALIFICATION_UNIT,
  FhvT4aQualificationIdentityError,
  parseFhvT4aQualificationObserverIdentity,
  projectFhvT4ObserverQualificationIdentityCapture,
} from "@/lib/trader/observability/fhv-t4a-qualification-identity";
import type { FhvT4ObserverQualificationIdentityCapture } from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";

const BOOT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ACTIVE_CAPTURE: FhvT4ObserverQualificationIdentityCapture = {
  unitName: FHV_T4A_OBSERVER_QUALIFICATION_UNIT,
  bootId: BOOT_ID,
  invocationId: "11111111111111111111111111111111",
  mainPid: 1001,
  activeEnterTimestampMonotonicUs: "1000000",
  activeState: "active",
};

describe("fhv-t4 qualification identity negatives (DEE-436 Q-01)", () => {
  it("parseFhvT4aQualificationObserverIdentity wraps observer parser failures", () => {
    try {
      parseFhvT4aQualificationObserverIdentity({ mainPid: -1 });
      expect.unreachable("invalid observer identity should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4aQualificationIdentityError);
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "QUALIFICATION_IDENTITY_NOT_CANONICALLY_PARSED",
      );
    }
  });

  it("projectFhvT4ObserverQualificationIdentityCapture preserves unitName and bootId", () => {
    const projected = projectFhvT4ObserverQualificationIdentityCapture({
      schemaVersion: "fhv-t4-observer-systemd-identity/v1",
      unitName: FHV_T4A_OBSERVER_QUALIFICATION_UNIT,
      bootId: BOOT_ID,
      invocationId: ACTIVE_CAPTURE.invocationId,
      mainPid: ACTIVE_CAPTURE.mainPid,
      activeEnterTimestampMonotonicUs: ACTIVE_CAPTURE.activeEnterTimestampMonotonicUs,
      activeState: ACTIVE_CAPTURE.activeState,
    });
    expect(projected.unitName).toBe(FHV_T4A_OBSERVER_QUALIFICATION_UNIT);
    expect(projected.bootId).toBe(BOOT_ID);
  });

  it("assertFhvT4aQualificationIdentityCapture rejects inactive and malformed captures", () => {
    try {
      assertFhvT4aQualificationIdentityCapture(
        { ...ACTIVE_CAPTURE, activeState: "inactive" },
        "before",
        BOOT_ID,
      );
      expect.unreachable("inactive capture should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_NOT_ACTIVE",
      );
    }

    try {
      assertFhvT4aQualificationIdentityCapture({ ...ACTIVE_CAPTURE, mainPid: 0 }, "after", BOOT_ID);
      expect.unreachable("invalid mainPid should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_MAIN_PID_INVALID",
      );
    }

    try {
      assertFhvT4aQualificationIdentityCapture(
        { ...ACTIVE_CAPTURE, invocationId: "  " },
        "before",
        BOOT_ID,
      );
      expect.unreachable("missing invocationId should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_INVOCATION_REQUIRED",
      );
    }

    try {
      assertFhvT4aQualificationIdentityCapture(
        { ...ACTIVE_CAPTURE, unitName: "" },
        "before",
        BOOT_ID,
      );
      expect.unreachable("missing unitName should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "QUALIFICATION_CAPTURE_UNIT_NAME_NOT_PERSISTED",
      );
    }

    try {
      assertFhvT4aQualificationIdentityCapture(
        { ...ACTIVE_CAPTURE, bootId: "" },
        "before",
        BOOT_ID,
      );
      expect.unreachable("missing bootId should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "QUALIFICATION_CAPTURE_BOOT_ID_NOT_PERSISTED",
      );
    }
  });

  it("assertFhvT4aQualificationIdentityStability rejects drift and wrong unit", () => {
    try {
      assertFhvT4aQualificationIdentityStability({
        before: ACTIVE_CAPTURE,
        after: { ...ACTIVE_CAPTURE, mainPid: 1002 },
        proofBootId: BOOT_ID,
      });
      expect.unreachable("pid drift should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_PID_DRIFT",
      );
    }

    try {
      assertFhvT4aQualificationIdentityStability({
        before: ACTIVE_CAPTURE,
        after: { ...ACTIVE_CAPTURE, invocationId: "22222222222222222222222222222222" },
        proofBootId: BOOT_ID,
      });
      expect.unreachable("invocation drift should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_INVOCATION_DRIFT",
      );
    }

    try {
      assertFhvT4aQualificationIdentityStability({
        before: ACTIVE_CAPTURE,
        after: { ...ACTIVE_CAPTURE, activeEnterTimestampMonotonicUs: "2000000" },
        proofBootId: BOOT_ID,
      });
      expect.unreachable("active-enter drift should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "QUALIFICATION_ACTIVE_ENTER_TIMESTAMP_DRIFT",
      );
    }

    try {
      assertFhvT4aQualificationIdentityStability({
        before: ACTIVE_CAPTURE,
        after: { ...ACTIVE_CAPTURE, unitName: "waia-fhv-campaign.service" },
        proofBootId: BOOT_ID,
      });
      expect.unreachable("unit drift should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_UNIT_MISMATCH",
      );
    }

    try {
      assertFhvT4aQualificationIdentityStability({
        before: ACTIVE_CAPTURE,
        after: { ...ACTIVE_CAPTURE, bootId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
        proofBootId: BOOT_ID,
      });
      expect.unreachable("boot id drift should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "QUALIFICATION_PROOF_BOOT_ID_CAPTURE_MISMATCH",
      );
    }

    try {
      assertFhvT4aQualificationIdentityStability({
        before: ACTIVE_CAPTURE,
        after: ACTIVE_CAPTURE,
        proofBootId: "not-a-boot-id",
      });
      expect.unreachable("invalid proof bootId should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "QUALIFICATION_BOOT_ID_INTERNAL_MISMATCH",
      );
    }

    try {
      assertFhvT4aQualificationIdentityCapture(
        { ...ACTIVE_CAPTURE, bootId: "not-a-boot-id" },
        "before",
        BOOT_ID,
      );
      expect.unreachable("invalid capture bootId should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4aQualificationIdentityError);
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "QUALIFICATION_BOOT_ID_INTERNAL_MISMATCH",
      );
    }
  });

  it("assertFhvT4aPostRestartInvocationChanged requires invocation change", () => {
    try {
      assertFhvT4aPostRestartInvocationChanged({
        preCampaignInvocationId: "11111111111111111111111111111111",
        postRestartInvocationId: "11111111111111111111111111111111",
      });
      expect.unreachable("unchanged invocation should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_CEREMONY_OBSERVER_RESTART_NOT_PROVEN",
      );
    }

    expect(() =>
      assertFhvT4aPostRestartInvocationChanged({
        preCampaignInvocationId: "11111111111111111111111111111111",
        postRestartInvocationId: "22222222222222222222222222222222",
      }),
    ).not.toThrow();
  });
});
