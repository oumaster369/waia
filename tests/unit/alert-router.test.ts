import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAlertRouterSink,
  resetAlertRouterDedupeForTests,
  runAlertDrill,
} from "@/lib/observability/alerting/alert-router";

describe("alert-router", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetAlertRouterDedupeForTests();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.TELEGRAM_ALERTS_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERTS_CHAT_ID;
    delete process.env.TELEGRAM_ALERTS_THREAD_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetAlertRouterDedupeForTests();
  });

  it("does not throw when inner sink runs for non-alert lines", () => {
    const inner = vi.fn();
    const sink = createAlertRouterSink(inner);
    expect(() => sink(JSON.stringify({ event: "other" }))).not.toThrow();
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("does not throw when alerting is disabled and line is critical", () => {
    const inner = vi.fn();
    const sink = createAlertRouterSink(inner);
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "execution",
      organization_id: "org-1",
      outcome: "conflict",
      severity: "critical",
    });
    expect(() => sink(line)).not.toThrow();
  });

  it("schedules delivery without blocking inner sink when configured", async () => {
    process.env.TELEGRAM_ALERTS_BOT_TOKEN = "token";
    process.env.TELEGRAM_ALERTS_CHAT_ID = "-1001";
    process.env.TELEGRAM_ALERTS_THREAD_ID = "7";

    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const inner = vi.fn();
    const sink = createAlertRouterSink(inner);
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "execution",
      organization_id: "org-1",
      outcome: "conflict",
      severity: "critical",
    });

    sink(line);
    expect(inner).toHaveBeenCalledWith(line);

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
  });

  it("runAlertDrill dry-runs without secrets", async () => {
    const result = await runAlertDrill();
    expect(result.dryRun).toBe(true);
    expect(result.deliveryOutcome).toBe("dry_run");
    expect(result.message).toContain("WAIA AI-TRADER CRITICAL");
  });

  it("isolates telegram failures from inner sink", async () => {
    process.env.TELEGRAM_ALERTS_BOT_TOKEN = "token";
    process.env.TELEGRAM_ALERTS_CHAT_ID = "-1001";
    process.env.TELEGRAM_ALERTS_THREAD_ID = "7";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const inner = vi.fn();
    const sink = createAlertRouterSink(inner);
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "execution",
      organization_id: "org-1",
      outcome: "conflict",
      severity: "critical",
    });

    expect(() => sink(line)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
