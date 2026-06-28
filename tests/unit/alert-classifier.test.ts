import { afterEach, describe, expect, it } from "vitest";

import { classifyAlertLine } from "@/lib/observability/alerting/alert-classifier";

describe("alert-classifier", () => {
  afterEach(() => {
    // no env mutation
  });

  it("classifies execution conflict as duplicate_order_risk", () => {
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "execution",
      organization_id: "org-1",
      outcome: "conflict",
      severity: "critical",
    });
    const alert = classifyAlertLine(line);
    expect(alert?.alertType).toBe("duplicate_order_risk");
  });

  it("classifies reconciliation critical mismatch", () => {
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "reconciliation",
      organization_id: "org-1",
      outcome: "UNKNOWN_POSITION",
      severity: "critical",
      escalation_kind: "kill_switch",
    });
    expect(classifyAlertLine(line)?.alertType).toBe("reconciliation_mismatch");
  });

  it("classifies kill-switch data quality counter", () => {
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "counter",
      organization_id: "org-1",
      outcome: "increment",
      severity: "critical",
      domain: "kill_switch",
      code: "auto:data_quality",
    });
    expect(classifyAlertLine(line)?.alertType).toBe("data_quality_breach");
  });

  it("classifies paper loop STOP_ACCOUNT as drawdown_stop_account", () => {
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "paper_loop",
      organization_id: "org-1",
      outcome: "cycle_complete",
      severity: "critical",
      risk_outcome: "STOP_ACCOUNT",
    });
    expect(classifyAlertLine(line)?.alertType).toBe("drawdown_stop_account");
  });

  it("classifies other paper loop critical events", () => {
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "paper_loop",
      organization_id: "org-1",
      outcome: "cycle_complete",
      severity: "critical",
      execution_status: "conflict",
    });
    expect(classifyAlertLine(line)?.alertType).toBe("paper_loop_critical");
  });

  it("classifies payment watcher cycle_error", () => {
    const line = JSON.stringify({
      event: "waia_payment_watcher",
      phase: "cycle_error",
      network: "TRC-20",
      error: "provider down",
    });
    const alert = classifyAlertLine(line);
    expect(alert?.alertType).toBe("payment_watcher_failure");
    expect(alert?.organizationId).toBeNull();
  });

  it("classifies payment watcher provider_error noop", () => {
    const line = JSON.stringify({
      event: "waia_payment_watcher",
      phase: "cycle_noop",
      reason: "provider_error",
    });
    expect(classifyAlertLine(line)?.alertType).toBe("payment_watcher_failure");
  });

  it("classifies health_payment_watcher stale route", () => {
    const line = JSON.stringify({
      event: "waia_runtime_route",
      route: "health_payment_watcher",
      outcome: "stale",
      http_status: 503,
      duration_ms: 12,
    });
    expect(classifyAlertLine(line)?.alertType).toBe("payment_watcher_offline");
  });

  it("ignores info trader telemetry", () => {
    const line = JSON.stringify({
      event: "waia_trader_event",
      kind: "execution",
      organization_id: "org-1",
      outcome: "submitted",
      severity: "info",
    });
    expect(classifyAlertLine(line)).toBeNull();
  });

  it("ignores non-json lines", () => {
    expect(classifyAlertLine("not-json")).toBeNull();
  });
});
