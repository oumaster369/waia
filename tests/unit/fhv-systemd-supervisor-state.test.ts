import { describe, expect, it } from "vitest";

import {
  classifyHostEnforcedCampaignTimeout,
  parseSystemctlShowOutput,
} from "@/lib/trader/observability/fhv-systemd-supervisor-state";

describe("fhv-systemd-supervisor-state", () => {
  it("parses systemctl show output", () => {
    const parsed = parseSystemctlShowOutput(
      "ActiveState=failed\nSubState=failed\nResult=timeout\nExecMainCode=1\n",
    );
    expect(parsed.result).toBe("timeout");
    expect(parsed.activeState).toBe("failed");
  });

  it("classifies host-enforced timeout markers", () => {
    expect(
      classifyHostEnforcedCampaignTimeout({
        activeState: "failed",
        subState: "failed",
        result: "timeout",
        execMainCode: 1,
        execMainStatus: null,
        inactiveExitStatus: null,
      }),
    ).toBe(true);
    expect(
      classifyHostEnforcedCampaignTimeout({
        activeState: "inactive",
        subState: "dead",
        result: "success",
        execMainCode: 0,
        execMainStatus: 0,
        inactiveExitStatus: 143,
      }),
    ).toBe(false);
  });
});
