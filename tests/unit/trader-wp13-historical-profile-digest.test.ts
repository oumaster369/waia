import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeHistoricalProfileDigest } from "@/lib/trader/intelligence/historical-profile/serialize-historical-profile";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1, HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";

describe("trader wp13 historical profile digest", () => {
  it("matches human-bound canonical digest", () => {
    expect(HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST).toBe(
      "9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe",
    );
    expect(computeHistoricalProfileDigest(HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1)).toBe(
      HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    );
  });

  it("independently reproduces staging raw sha and canonical digest", () => {
    const raw = readFileSync(
      ".cursor/plans/dee-415-htr-wp13-wp16-staging/htr-historical-intelligence-profile-v1.json",
      "utf8",
    );
    expect(createHash("sha256").update(raw, "utf8").digest("hex")).toBe(
      "72ed9b17d773e1be2bc55f659c1d0ec39e9e0c8a3e5dc0f7c02795103db2cc8a",
    );
    const parsed = JSON.parse(raw);
    expect(createHash("sha256").update(canonicalizeSemanticJsonString(parsed), "utf8").digest("hex")).toBe(
      HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    );
  });
});
