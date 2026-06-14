import { describe, expect, it } from "vitest";

import {
  assertAllowedTransition,
  failClosedEffectiveState,
  IllegalKillSwitchTransitionError,
  mergeEffectiveContributions,
  mostRestrictiveEnforcementMode,
} from "@/lib/trader/risk/kill-switch";
import type { KillSwitchRow } from "@/lib/trader/risk/kill-switch";

function row(partial: Partial<KillSwitchRow> & Pick<KillSwitchRow, "id">): KillSwitchRow {
  return {
    organizationId: partial.organizationId ?? "org-a",
    scopeType: partial.scopeType ?? "organization",
    scopeRef: partial.scopeRef ?? "",
    switchType: partial.switchType ?? "EMERGENCY_STOP",
    enforcementMode: partial.enforcementMode ?? "REJECT",
    state: partial.state ?? "ACTIVE",
    origin: partial.origin ?? "manual",
    reason: partial.reason ?? "",
    clearingStartedAt: partial.clearingStartedAt ?? null,
    coolingOffMs: partial.coolingOffMs ?? null,
    trippedAt: partial.trippedAt ?? null,
    clearedAt: partial.clearedAt ?? null,
    stateVersion: partial.stateVersion ?? 1,
    createdAt: partial.createdAt ?? new Date("2026-06-14T00:00:00.000Z"),
    updatedAt: partial.updatedAt ?? new Date("2026-06-14T00:00:00.000Z"),
    ...partial,
  };
}

describe("kill switch transitions (DEE-243)", () => {
  it("ranks STOP_ACCOUNT as most restrictive", () => {
    expect(mostRestrictiveEnforcementMode("REJECT", "STOP_ACCOUNT")).toBe("STOP_ACCOUNT");
    expect(mostRestrictiveEnforcementMode("CLOSE_ONLY", "REJECT")).toBe("CLOSE_ONLY");
  });

  it("allows trip and clear lifecycle transitions", () => {
    expect(() => assertAllowedTransition("INACTIVE", "ACTIVE")).not.toThrow();
    expect(() => assertAllowedTransition("ACTIVE", "CLEARING")).not.toThrow();
    expect(() => assertAllowedTransition("CLEARING", "INACTIVE")).not.toThrow();
    expect(() => assertAllowedTransition("CLEARING", "ACTIVE")).not.toThrow();
    expect(() => assertAllowedTransition("ACTIVE", "ACTIVE")).not.toThrow();
  });

  it("rejects illegal transitions", () => {
    expect(() => assertAllowedTransition("INACTIVE", "CLEARING")).toThrow(
      IllegalKillSwitchTransitionError,
    );
  });

  it("merges platform and org contributors with most-restrictive-wins", () => {
    const resolvedAt = "2026-06-14T12:00:00.000Z";
    const effective = mergeEffectiveContributions(
      [
        row({
          id: "platform-1",
          organizationId: null,
          scopeType: "platform",
          enforcementMode: "REJECT",
          state: "ACTIVE",
        }),
        row({
          id: "org-1",
          organizationId: "org-a",
          scopeType: "organization",
          enforcementMode: "STOP_ACCOUNT",
          state: "ACTIVE",
        }),
      ],
      "org-a",
      resolvedAt,
    );

    expect(effective.blocked).toBe(true);
    expect(effective.enforcementMode).toBe("STOP_ACCOUNT");
    expect(effective.contributors).toHaveLength(2);
  });

  it("ignores reserved scopes and inactive rows", () => {
    const effective = mergeEffectiveContributions(
      [
        row({
          id: "venue-1",
          scopeType: "venue",
          state: "ACTIVE",
        }),
        row({
          id: "inactive-1",
          state: "INACTIVE",
        }),
      ],
      "org-a",
      "2026-06-14T12:00:00.000Z",
    );

    expect(effective.blocked).toBe(false);
    expect(effective.contributors).toHaveLength(0);
  });

  it("treats CLEARING as enforcing", () => {
    const effective = mergeEffectiveContributions(
      [
        row({
          id: "clearing-1",
          state: "CLEARING",
          enforcementMode: "CLOSE_ONLY",
        }),
      ],
      "org-a",
      "2026-06-14T12:00:00.000Z",
    );

    expect(effective.blocked).toBe(true);
    expect(effective.bindingState).toBe("CLEARING");
  });

  it("returns fail-closed effective state shape", () => {
    const effective = failClosedEffectiveState("org-a", "2026-06-14T12:00:00.000Z");
    expect(effective.resolutionStatus).toBe("fail_closed");
    expect(effective.blocked).toBe(true);
    expect(effective.enforcementMode).toBe("STOP_ACCOUNT");
  });
});
