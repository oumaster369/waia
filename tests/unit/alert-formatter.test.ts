import { describe, expect, it } from "vitest";

import { createDrillAlertEnvelope } from "@/lib/observability/alerting/alert-classifier";
import { formatAlertMessage } from "@/lib/observability/alerting/alert-formatter";

describe("alert-formatter", () => {
  it("formats drill envelope without forbidden fields", () => {
    const envelope = createDrillAlertEnvelope();
    const text = formatAlertMessage(envelope);
    expect(text).toContain("WAIA AI-TRADER CRITICAL");
    expect(text).toContain("Paper loop critical");
    expect(text).toContain("Org:");
    expect(text).toContain("Ref:");
    expect(text.toLowerCase()).not.toContain("token");
    expect(text.toLowerCase()).not.toContain("password");
  });

  it("truncates very long messages", () => {
    const envelope = createDrillAlertEnvelope();
    envelope.extensions.note = "x".repeat(5000);
    const text = formatAlertMessage(envelope);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.endsWith("…")).toBe(true);
  });
});
