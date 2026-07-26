import { describe, expect, it } from "vitest";

import {
  assertFhvT4aPostRestartInvocationChanged,
  assertFhvT4aQualificationIdentityCapture,
  assertFhvT4aQualificationIdentityStability,
  FhvT4aQualificationIdentityError,
  parseFhvT4aQualificationObserverIdentity,
} from "@/lib/trader/observability/fhv-t4a-qualification-identity";
import { FhvT4BootIdError } from "@/lib/trader/observability/fhv-t4-boot-id";
import type { FhvT4ObserverQualificationIdentityCapture } from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";

const ACTIVE_CAPTURE: FhvT4ObserverQualificationIdentityCapture = {
  invocationId: "11111111111111111111111111111111",
  mainPid: 1001,
  activeEnterTimestampMonotonicUs: "1000000",
  activeState: "active",
};

describe("fhv-t4 qualification identity negatives (DEE-436 F-09)", () => {
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

  it("assertFhvT4aQualificationIdentityCapture rejects inactive and malformed captures", () => {
    try {
      assertFhvT4aQualificationIdentityCapture(
        { ...ACTIVE_CAPTURE, activeState: "inactive" },
        "before",
      );
      expect.unreachable("inactive capture should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_NOT_ACTIVE",
      );
    }

    try {
      assertFhvT4aQualificationIdentityCapture({ ...ACTIVE_CAPTURE, mainPid: 0 }, "after");
      expect.unreachable("invalid mainPid should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_MAIN_PID_INVALID",
      );
    }

    try {
      assertFhvT4aQualificationIdentityCapture({ ...ACTIVE_CAPTURE, invocationId: "  " }, "before");
      expect.unreachable("missing invocationId should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_INVOCATION_REQUIRED",
      );
    }
  });

  it("assertFhvT4aQualificationIdentityStability rejects drift and wrong unit", () => {
    try {
      assertFhvT4aQualificationIdentityStability({
        before: ACTIVE_CAPTURE,
        after: { ...ACTIVE_CAPTURE, mainPid: 1002 },
        bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        unitName: "waia-fhv-observer.service",
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
        bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        unitName: "waia-fhv-observer.service",
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
        after: ACTIVE_CAPTURE,
        bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        unitName: "waia-fhv-campaign.service",
      });
      expect.unreachable("wrong unit should fail");
    } catch (error) {
      expect((error as FhvT4aQualificationIdentityError).code).toBe(
        "FHV_T4_OBSERVER_QUALIFICATION_UNIT_MISMATCH",
      );
    }

    try {
      assertFhvT4aQualificationIdentityStability({
        before: ACTIVE_CAPTURE,
        after: ACTIVE_CAPTURE,
        bootId: "not-a-boot-id",
        unitName: "waia-fhv-observer.service",
      });
      expect.unreachable("invalid bootId should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4BootIdError);
      expect((error as FhvT4BootIdError).code).toBe("FHV_T4_BOOT_ID_INVALID");
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
