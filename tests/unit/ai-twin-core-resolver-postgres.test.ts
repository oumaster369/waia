import { describe, expect, it } from "vitest";

import {
  evaluatePersonalTwinModelAccess,
  TWIN_PERSONAL_MODEL_ACCESS_POLICY,
} from "@/lib/ai-twin/model/core-access";
import { assembleProductionTwinCoreAccessContext } from "@/lib/ai-twin/model/core-resolver-postgres";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";

describe("production Twin Core resolver mapping", () => {
  it("maps present Core rows to current and allows the same Human", () => {
    const resolved = assembleProductionTwinCoreAccessContext({
      target: { organizationId, subjectUserId: actorUserId },
      actorUserId,
      presence: {
        actorUserPresent: true,
        organizationPresent: true,
        actorMembershipPresent: true,
        subjectMembershipPresent: true,
      },
    });
    expect(evaluatePersonalTwinModelAccess(resolved)).toEqual({
      allowed: true,
      reason: "ALLOWED",
      policyVersion: TWIN_PERSONAL_MODEL_ACCESS_POLICY,
      scope: { organizationId, subjectId: actorUserId },
      actor: { kind: "human", subjectId: actorUserId },
    });
    expect(JSON.stringify(resolved)).not.toContain("member_role");
    expect(JSON.stringify(resolved)).not.toContain("entitlement");
  });

  it("fails closed when membership or organization rows are absent", () => {
    expect(
      evaluatePersonalTwinModelAccess(
        assembleProductionTwinCoreAccessContext({
          target: { organizationId, subjectUserId: actorUserId },
          actorUserId,
          presence: {
            actorUserPresent: true,
            organizationPresent: false,
            actorMembershipPresent: true,
            subjectMembershipPresent: true,
          },
        }),
      ),
    ).toEqual({ allowed: false, reason: "TWIN_CORE_CONTEXT_REQUIRED" });
    expect(
      evaluatePersonalTwinModelAccess(
        assembleProductionTwinCoreAccessContext({
          target: { organizationId, subjectUserId: actorUserId },
          actorUserId,
          presence: {
            actorUserPresent: true,
            organizationPresent: true,
            actorMembershipPresent: false,
            subjectMembershipPresent: true,
          },
        }),
      ),
    ).toEqual({ allowed: false, reason: "TWIN_CORE_CONTEXT_REQUIRED" });
  });

  it("does not let another current member act as the subject", () => {
    expect(
      evaluatePersonalTwinModelAccess(
        assembleProductionTwinCoreAccessContext({
          target: { organizationId, subjectUserId: otherUserId },
          actorUserId,
          presence: {
            actorUserPresent: true,
            organizationPresent: true,
            actorMembershipPresent: true,
            subjectMembershipPresent: true,
          },
        }),
      ),
    ).toEqual({ allowed: false, reason: "TWIN_PERSONAL_SUBJECT_MISMATCH" });
  });

  it("treats a missing session as unauthenticated", () => {
    expect(
      evaluatePersonalTwinModelAccess(
        assembleProductionTwinCoreAccessContext({
          target: { organizationId, subjectUserId: actorUserId },
          actorUserId: null,
          presence: {
            actorUserPresent: false,
            organizationPresent: true,
            actorMembershipPresent: false,
            subjectMembershipPresent: true,
          },
        }),
      ),
    ).toEqual({ allowed: false, reason: "TWIN_AUTHENTICATION_REQUIRED" });
  });
});
