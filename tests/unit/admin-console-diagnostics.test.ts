import { describe, expect, it, vi } from "vitest";

import { redactDiagnosticText } from "@/lib/trader/admin-console/diagnostics/redact";
import { fingerprintDiagnostic } from "@/lib/trader/admin-console/diagnostics/fingerprint";
import { nextIncidentStatus } from "@/lib/trader/admin-console/diagnostics/incident-transition";
import {
  newsDedupeKey,
  canonicalNewsUrl,
  newsClusterKey,
} from "@/lib/trader/admin-console/collectors/news-normalize";
import { missedJobRuns } from "@/lib/trader/admin-console/jobs/job-catalog";
import { fearGreedValue } from "@/lib/trader/admin-console/collectors/fear-greed";
import { runAdminConsoleCollectorCycle } from "@/lib/trader/admin-console/collectors/run-collectors-cycle";

describe("admin console diagnostics and collectors", () => {
  it("redacts secrets and keeps a zero fear-greed value meaningful", () => {
    const text = redactDiagnosticText(
      "Bearer abc.def.ghi postgres://user:pass@db/waia apiKey=secret email a@b.co token " +
        "0123456789abcdef0123456789abcdef",
    );
    expect(text).not.toContain("pass@");
    expect(text).not.toContain("apiKey=secret");
    expect(text).toContain("[redacted:");
    expect(fearGreedValue(0)).toBe(0);
  });

  it("fingerprints the same failure after ids change", () => {
    const left = fingerprintDiagnostic({
      service: "worker",
      errorClass: "Error",
      message: "order 11111111-1111-4111-8111-111111111111 failed",
      stack: "at run (file.ts:1:1)",
    });
    const right = fingerprintDiagnostic({
      service: "worker",
      errorClass: "Error",
      message: "order 22222222-2222-4222-8222-222222222222 failed",
      stack: "at run (file.ts:9:9)",
    });
    expect(left).toBe(right);
  });

  it("allows the forward incident path and a regression, and rejects a skip", () => {
    expect(nextIncidentStatus("new", "investigating").ok).toBe(true);
    expect(nextIncidentStatus("resolved", "regressed")).toEqual({ ok: true, status: "regressed" });
    expect(nextIncidentStatus("new", "resolved").ok).toBe(false);
  });

  it("keeps distinct article ids and drops tracking parameters", () => {
    const first = newsDedupeKey("coindesk", null, "https://Example.com/article?id=1&utm_source=x");
    const second = newsDedupeKey("coindesk", null, "https://example.com/article?id=2");
    expect(first).not.toBe(second);
    expect(canonicalNewsUrl("https://Example.com/article?id=1&utm_source=x#top")).toBe(
      "https://example.com/article?id=1",
    );
    expect(newsClusterKey("Bitcoin rises")).toBe(newsClusterKey("rises Bitcoin"));
  });

  it("does not call collectors when the flag is off and continues after one failure", async () => {
    const task = vi.fn(async () => undefined);
    const off = await runAdminConsoleCollectorCycle({
      env: {},
      tasks: [{ key: "quotes", run: task }],
    });
    expect(off.ran).toEqual([]);
    expect(task).not.toHaveBeenCalled();
    const boom = vi.fn(async () => {
      throw new Error("down");
    });
    const ok = vi.fn(async () => undefined);
    const on = await runAdminConsoleCollectorCycle({
      env: { WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED: "1" },
      tasks: [
        { key: "quotes", run: boom },
        { key: "usd", run: ok },
      ],
    });
    expect(on).toEqual({ ran: ["usd"], failed: ["quotes"] });
  });

  it("marks a job missed after two periods", () => {
    expect(
      missedJobRuns([{ jobKey: "admin_news", startedAtMs: 0 }], 21 * 60_000, 10 * 60_000),
    ).toEqual(["admin_news"]);
  });
});
