import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/health/alerting/drill/route";
import * as alertRouter from "@/lib/observability/alerting/alert-router";

describe("POST /api/health/alerting/drill", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns live delivery outcome without secrets", async () => {
    vi.spyOn(alertRouter, "runAlertDrill").mockResolvedValue({
      configured: true,
      dryRun: false,
      message: "WAIA AI-TRADER CRITICAL\nDrill: true",
      deliveryOutcome: "success",
    });

    const response = await POST(new Request("https://waia.life/api/health/alerting/drill?send=1"));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      configured: true,
      dry_run: false,
      outcome: "success",
      sink: "telegram",
      alert_type: "paper_loop_critical",
      drill: true,
    });
    expect(JSON.stringify(body)).not.toMatch(/bot\d|TELEGRAM_ALERTS/);
  });

  it("rejects conflicting query flags", async () => {
    const response = await POST(
      new Request("https://waia.life/api/health/alerting/drill?send=1&dry_run=1"),
    );
    expect(response.status).toBe(400);
  });
});
