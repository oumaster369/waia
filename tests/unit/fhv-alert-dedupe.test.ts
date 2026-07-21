import { describe, expect, it } from "vitest";

import { dedupeFhvAlerts } from "@/lib/trader/observability/fhv-alert-catalogue.v1";

describe("DEE-416 FHV alert dedupe", () => {
  it("fires alert on first observation", () => {
    const lastFiredAtById = new Map<string, number>();
    const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
    const fired = dedupeFhvAlerts(["FHV-ALERT-001"], lastFiredAtById, nowMs);
    expect(fired).toEqual(["FHV-ALERT-001"]);
    expect(lastFiredAtById.get("FHV-ALERT-001")).toBe(nowMs);
  });

  it("suppresses duplicate alerts inside the dedupe window", () => {
    const lastFiredAtById = new Map<string, number>();
    const firstMs = Date.parse("2026-07-21T12:00:00.000Z");
    dedupeFhvAlerts(["FHV-ALERT-001"], lastFiredAtById, firstMs);

    const withinWindowMs = firstMs + 60_000;
    const suppressed = dedupeFhvAlerts(["FHV-ALERT-001"], lastFiredAtById, withinWindowMs);
    expect(suppressed).toEqual([]);
  });

  it("refires alert after dedupe window elapses", () => {
    const lastFiredAtById = new Map<string, number>();
    const firstMs = Date.parse("2026-07-21T12:00:00.000Z");
    dedupeFhvAlerts(["FHV-ALERT-001"], lastFiredAtById, firstMs);

    const afterWindowMs = firstMs + 301_000;
    const refired = dedupeFhvAlerts(["FHV-ALERT-001"], lastFiredAtById, afterWindowMs);
    expect(refired).toEqual(["FHV-ALERT-001"]);
    expect(lastFiredAtById.get("FHV-ALERT-001")).toBe(afterWindowMs);
  });

  it("treats null dedupeSec as zero-second dedupe (immediate refire allowed)", () => {
    const lastFiredAtById = new Map<string, number>();
    const firstMs = Date.parse("2026-07-21T12:00:00.000Z");
    dedupeFhvAlerts(["FHV-ALERT-010"], lastFiredAtById, firstMs);

    const immediateMs = firstMs + 1;
    const refired = dedupeFhvAlerts(["FHV-ALERT-010"], lastFiredAtById, immediateMs);
    expect(refired).toEqual(["FHV-ALERT-010"]);
  });
});
