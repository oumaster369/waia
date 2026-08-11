import { describe, expect, it } from "vitest";

import {
  formatBreathAmount,
  formatBreathRunway,
  getBreathPublicSnapshot,
} from "@/lib/landing/breath-public";
import { WAIA_PUBLIC_GITHUB_URL } from "@/lib/landing/homepage-links";
import {
  HOMEPAGE_MODULE_READINESS,
  MATURITY_SCALE,
  getModuleReadiness,
} from "@/lib/landing/module-readiness";

describe("breath-public contract", () => {
  it("returns pending empty full public surface until DEE-606 publishes", () => {
    const snap = getBreathPublicSnapshot();
    expect(snap.status).toBe("pending");
    expect(snap.lastUpdatedAt).toBeNull();
    expect(snap.stageLabel).toBeNull();
    expect(snap.resources.entered).toBeNull();
    expect(snap.resources.allocated).toBeNull();
    expect(snap.resources.spent).toBeNull();
    expect(snap.resources.remaining).toBeNull();
    expect(snap.resources.neededNext).toBeNull();
    expect(snap.budget.planned).toBeNull();
    expect(snap.budget.funded).toBeNull();
    expect(snap.budget.committed).toBeNull();
    expect(snap.budget.spent).toBeNull();
    expect(snap.budget.remaining).toBeNull();
    expect(snap.budget.fillRatio).toBeNull();
    expect(snap.runway.value).toBeNull();
    expect(snap.runway.unit).toBeNull();
    expect(snap.recentActivity.inflows).toEqual([]);
    expect(snap.recentActivity.outflows).toEqual([]);
    expect(snap.work.githubUrl).toBe(WAIA_PUBLIC_GITHUB_URL);
    expect(formatBreathAmount(null, null)).toBe("Not yet published");
    expect(formatBreathRunway(snap.runway)).toBe("Not yet published");
  });
});

describe("module-readiness qualitative methodology", () => {
  it("exposes the five-stage maturity scale without invented percentages", () => {
    expect(MATURITY_SCALE).toEqual([
      "Concept",
      "Research",
      "Prototype",
      "Operational",
      "Production",
    ]);
  });

  it("exposes every homepage module with qualitative facets only", () => {
    expect(HOMEPAGE_MODULE_READINESS.length).toBeGreaterThanOrEqual(6);
    for (const row of HOMEPAGE_MODULE_READINESS) {
      expect(row.primaryLabel).toBeTruthy();
      expect(row.facets.length).toBeGreaterThan(0);
      expect(row.evidenceNote.length).toBeGreaterThan(10);
      expect(getModuleReadiness(row.id).id).toBe(row.id);
      expect(JSON.stringify(row)).not.toMatch(/%|\bpercent\b/i);
      expect(row).not.toHaveProperty("percent");
    }
  });

  it("keeps mixed maturity as explicit facets rather than averages", () => {
    const twin = getModuleReadiness("ai-twin");
    expect(twin.primaryLabel).toBe("Operational");
    expect(twin.facets.some((f) => f.label === "Operational")).toBe(true);
    expect(twin.facets.some((f) => f.label === "Prototype")).toBe(true);

    const trader = getModuleReadiness("ai-trader");
    expect(trader.facets.some((f) => /Paper/i.test(f.name))).toBe(true);
    expect(trader.facets.some((f) => /Live/i.test(f.name))).toBe(true);
  });
});
