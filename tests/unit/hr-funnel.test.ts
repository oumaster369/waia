import { describe, expect, it } from "vitest";

import { HR_APPLICATION_STATUSES, isHrStatusTransitionAllowed } from "@/lib/waia-core/hr/service";

describe("DEE-747 HR funnel", () => {
  it("keeps the Human-approved ordered status vocabulary", () => {
    expect(HR_APPLICATION_STATUSES).toEqual([
      "NEW_APPLICATION",
      "INTERVIEW",
      "CONTRACT",
      "WORK",
      "PAYMENT",
      "TERMINATION",
    ]);
  });

  it("allows the next accountable step and termination, never skips or rewinds", () => {
    expect(isHrStatusTransitionAllowed("NEW_APPLICATION", "INTERVIEW")).toBe(true);
    expect(isHrStatusTransitionAllowed("INTERVIEW", "CONTRACT")).toBe(true);
    expect(isHrStatusTransitionAllowed("WORK", "TERMINATION")).toBe(true);
    expect(isHrStatusTransitionAllowed("NEW_APPLICATION", "WORK")).toBe(false);
    expect(isHrStatusTransitionAllowed("CONTRACT", "INTERVIEW")).toBe(false);
    expect(isHrStatusTransitionAllowed("TERMINATION", "WORK")).toBe(false);
  });
});
