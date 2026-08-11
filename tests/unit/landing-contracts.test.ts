import { describe, expect, it } from "vitest";

import {
  deriveBreathFundingMarkerRatio,
  formatBreathAmount,
  formatBreathCountdown,
  formatBreathRunway,
  getBreathPublicSnapshot,
  isBreathAnnualTargetMet,
} from "@/lib/landing/breath-public";
import { getBreathSupportChannel } from "@/lib/landing/breath-support";
import {
  FINAL_VISUAL_ALT,
  FINAL_VISUAL_BUDGET_BYTES,
  FINAL_VISUAL_INTRINSIC,
  FINAL_VISUAL_PATHS,
} from "@/lib/landing/final-visuals";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { WAIA_PUBLIC_GITHUB_URL } from "@/lib/landing/homepage-links";
import {
  HOMEPAGE_MODULE_READINESS,
  MATURITY_SCALE,
  getModuleReadiness,
} from "@/lib/landing/module-readiness";
import { LANDING_PRIMARY_CTA_CLASS } from "@/components/landing/landing-primary-cta";

describe("breath-public contract", () => {
  it("returns pending empty full public surface until the treasury ledger publishes", () => {
    const snap = getBreathPublicSnapshot();
    expect(snap.status).toBe("pending");
    expect(snap.lastUpdatedAt).toBeNull();
    expect(snap.stageLabel).toBeNull();
    expect(snap.idealAnnualBudget.amount).toBeNull();
    expect(snap.idealAnnualBudget.currency).toBeNull();
    expect(snap.currentFreeFunds.amount).toBeNull();
    expect(snap.currentFreeFunds.currency).toBeNull();
    expect(snap.resources.entered).toBeNull();
    expect(snap.budget.fillRatio).toBeNull();
    expect(snap.runway.value).toBeNull();
    expect(snap.runway.endsAt).toBeNull();
    expect(snap.recentActivity.inflows).toEqual([]);
    expect(snap.work.githubUrl).toBe(WAIA_PUBLIC_GITHUB_URL);
    expect(formatBreathAmount(null, null)).toBe("Not yet published");
    expect(formatBreathRunway(snap.runway)).toBe("Not yet published");
    expect(snap.methodologyNote).not.toMatch(/DEE-\d+/i);
    expect(
      deriveBreathFundingMarkerRatio(snap.currentFreeFunds, snap.idealAnnualBudget),
    ).toBeNull();
  });

  it("derives funding marker ratio only from matching authoritative money values", () => {
    expect(
      deriveBreathFundingMarkerRatio(
        { amount: 42_000, currency: "USD" },
        { amount: 100_000, currency: "USD" },
      ),
    ).toBeCloseTo(0.42);

    expect(
      deriveBreathFundingMarkerRatio(
        { amount: 150_000, currency: "USD" },
        { amount: 100_000, currency: "USD" },
      ),
    ).toBe(1);

    expect(
      deriveBreathFundingMarkerRatio(
        { amount: -10, currency: "USD" },
        { amount: 100_000, currency: "USD" },
      ),
    ).toBe(0);

    expect(
      deriveBreathFundingMarkerRatio(
        { amount: 42_000, currency: "USD" },
        { amount: 100_000, currency: null },
      ),
    ).toBeNull();

    expect(
      deriveBreathFundingMarkerRatio(
        { amount: 42_000, currency: "USD" },
        { amount: 0, currency: "USD" },
      ),
    ).toBeNull();

    expect(JSON.stringify(getBreathPublicSnapshot())).not.toContain("42000");
    expect(JSON.stringify(getBreathPublicSnapshot())).not.toContain("100000");
  });

  it("meets annual target only at free >= ideal with matching currencies", () => {
    expect(
      isBreathAnnualTargetMet(
        { amount: 100_000, currency: "USD" },
        { amount: 100_000, currency: "USD" },
      ),
    ).toBe(true);
    expect(
      isBreathAnnualTargetMet(
        { amount: 99_999, currency: "USD" },
        { amount: 100_000, currency: "USD" },
      ),
    ).toBe(false);
    expect(
      isBreathAnnualTargetMet(
        { amount: 100_000, currency: "USD" },
        { amount: 100_000, currency: null },
      ),
    ).toBe(false);
  });

  it("formats countdown without negatives or seconds", () => {
    expect(formatBreathCountdown(73 * 24 * 60 * 60_000 + 14 * 60 * 60_000 + 28 * 60_000)).toBe(
      "73d 14h 28m",
    );
    expect(formatBreathCountdown(-5_000)).toBe("0d 0h 0m");
    expect(formatBreathCountdown(0)).toBe("0d 0h 0m");
  });
});

describe("breath public copy hygiene", () => {
  it("exposes no internal Linear issue IDs in homepage Breath strings", () => {
    const breathBlob = JSON.stringify(HOMEPAGE_COPY.breath);
    expect(breathBlob).not.toMatch(/DEE-\d+/i);
    expect(HOMEPAGE_COPY.breath.updatedPending).toBe("Awaiting first ledger publication");
    expect(HOMEPAGE_COPY.breath.supportCta).toBe("KEEP WAIA BREATHING");
    expect(HOMEPAGE_COPY.breath.supportFullyFunded).toBe("WAIA IS FULLY FUNDED");
    expect(breathBlob).not.toMatch(/Treasury figures pending publication/i);
  });
});

describe("breath-support channel", () => {
  it("remains pending with no invented destination until Finance publishes", () => {
    const channel = getBreathSupportChannel();
    expect(channel.status).toBe("pending");
    expect(channel.href).toBeNull();
  });
});

describe("landing primary CTA contract", () => {
  it("matches Auth gold gradient language", () => {
    expect(LANDING_PRIMARY_CTA_CLASS).toContain("rounded-xl");
    expect(LANDING_PRIMARY_CTA_CLASS).toContain("linear-gradient(180deg,#dcc065_0%,#b8942e_98%)");
    expect(LANDING_PRIMARY_CTA_CLASS).toContain("text-[#0b1018]");
    expect(LANDING_PRIMARY_CTA_CLASS).toContain("hover:brightness-[1.06]");
  });
});

describe("DEE-608 B2 final visual path contract", () => {
  it("locks stable public paths, public alt text, and actual 1120×1400 intrinsic geometry", () => {
    expect(FINAL_VISUAL_PATHS.twin.webp).toBe("/landing/visuals/ai-twin.webp");
    expect(FINAL_VISUAL_PATHS.legacy.webp).toBe("/landing/visuals/living-legacy.webp");
    expect(FINAL_VISUAL_INTRINSIC.width).toBe(1120);
    expect(FINAL_VISUAL_INTRINSIC.height).toBe(1400);
    expect(FINAL_VISUAL_INTRINSIC.width / FINAL_VISUAL_INTRINSIC.height).toBeCloseTo(0.8);
    expect(FINAL_VISUAL_BUDGET_BYTES).toBe(180_000);
    expect(FINAL_VISUAL_ALT.twin).toMatch(/co-researcher/i);
    expect(FINAL_VISUAL_ALT.legacy).toMatch(/continuity of meaning/i);
    expect(FINAL_VISUAL_ALT.twin).not.toMatch(/DEE-608|Human-approved|V-TWIN/i);
    expect(FINAL_VISUAL_ALT.legacy).not.toMatch(/immortality|DEE-608|Human-approved/i);
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
