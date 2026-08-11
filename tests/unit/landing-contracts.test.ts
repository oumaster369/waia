import { describe, expect, it } from "vitest";

import {
  formatBreathAmount,
  getBreathPublicSnapshot,
} from "@/lib/landing/breath-public";
import { WAIA_PUBLIC_GITHUB_URL } from "@/lib/landing/homepage-links";
import {
  HOMEPAGE_MODULE_READINESS,
  MATURITY_SCORE,
  getModuleReadiness,
} from "@/lib/landing/module-readiness";

describe("breath-public contract", () => {
  it("returns pending empty resources until DEE-606 publishes", () => {
    const snap = getBreathPublicSnapshot();
    expect(snap.status).toBe("pending");
    expect(snap.lastUpdatedAt).toBeNull();
    expect(snap.resources.entered).toBeNull();
    expect(snap.resources.allocated).toBeNull();
    expect(snap.resources.spent).toBeNull();
    expect(snap.resources.remaining).toBeNull();
    expect(snap.resources.neededNext).toBeNull();
    expect(snap.work.githubUrl).toBe(WAIA_PUBLIC_GITHUB_URL);
    expect(formatBreathAmount(null, null)).toBe("Not yet published");
  });
});

describe("module-readiness methodology", () => {
  it("maps maturity labels to declared scores", () => {
    expect(MATURITY_SCORE.Concept).toBe(10);
    expect(MATURITY_SCORE.Research).toBe(25);
    expect(MATURITY_SCORE.Prototype).toBe(45);
    expect(MATURITY_SCORE.Operational).toBe(70);
    expect(MATURITY_SCORE.Production).toBe(95);
  });

  it("exposes every homepage module with methodology text", () => {
    expect(HOMEPAGE_MODULE_READINESS.length).toBeGreaterThanOrEqual(6);
    for (const row of HOMEPAGE_MODULE_READINESS) {
      expect(row.percent).toBeGreaterThanOrEqual(0);
      expect(row.percent).toBeLessThanOrEqual(100);
      expect(row.methodology.length).toBeGreaterThan(10);
      expect(getModuleReadiness(row.id).id).toBe(row.id);
    }
  });
});
