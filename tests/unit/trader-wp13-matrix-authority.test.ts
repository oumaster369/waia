import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST, countMatrixLanes } from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix-v1";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";

describe("trader wp13 matrix authority", () => {
  it("has 16 lanes and profile matrix binding", () => {
    const counts = countMatrixLanes();
    expect(TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST).toBe(
      "6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6",
    );
    expect(counts.laneCount).toBe(16);
    expect(counts.qualifiedPrimaryPriceLanes).toBe(1);
    expect(counts.unavailableHistoricalSidecarLanes).toBe(15);
    expect(HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1.providerEvidenceLanePolicy.matrixDigestCanonical).toBe(
      TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST,
    );
  });

  it("independently reproduces matrix staging digest", () => {
    const raw = readFileSync(
      ".cursor/plans/dee-415-htr-wp13-wp16-staging/timeframe-evidence-lane-authority-matrix-v1.json",
      "utf8",
    );
    expect(createHash("sha256").update(raw, "utf8").digest("hex")).toBe(
      "4aed27c0bfeaa853641330378962dce019a63eea22548ac4616bf03b396bfa97",
    );
    expect(createHash("sha256").update(canonicalizeSemanticJsonString(JSON.parse(raw)), "utf8").digest("hex")).toBe(
      TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST,
    );
  });
});
