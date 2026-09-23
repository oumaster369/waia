import { describe, expect, it } from "vitest";

import {
  emergencyEffect,
  emergencyTripBody,
} from "@/components/trader/admin-console/primitives/emergency-stop";
import { killSwitchEnforcementModeEnum, killSwitchTypeEnum } from "@/db/schema";

describe("admin console emergency stop", () => {
  it("uses switch types and enforcement modes the kill switch already stores", () => {
    for (const type of ["PAUSE", "CLOSE_ONLY", "EMERGENCY_STOP"]) {
      expect(killSwitchTypeEnum).toContain(type);
    }
    expect([...killSwitchEnforcementModeEnum]).toEqual(["STOP_ACCOUNT", "CLOSE_ONLY", "REJECT"]);
  });

  it("does not build a trip until the reason is confirmed, and says the command does not close positions", () => {
    const incomplete = emergencyTripBody({
      organizationId: "org-1",
      switchType: "EMERGENCY_STOP",
      enforcementMode: "STOP_ACCOUNT",
      expectedStateVersion: 3,
      reason: "биржа не отвечает",
      confirmed: false,
    });
    expect(incomplete.ok).toBe(false);
    const ready = emergencyTripBody({
      organizationId: "org-1",
      switchType: "EMERGENCY_STOP",
      enforcementMode: "STOP_ACCOUNT",
      expectedStateVersion: 3,
      reason: "биржа не отвечает",
      confirmed: true,
    });
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.body.command).toBe("trip");
    expect(emergencyEffect("EMERGENCY_STOP", "STOP_ACCOUNT")).toContain(
      "Закрытие позиций эта команда не выполняет.",
    );
  });
});
