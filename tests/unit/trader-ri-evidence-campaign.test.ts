import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_TRACK_A,
  CAMPAIGN_TRACK_B,
  resolveCampaignTracks,
} from "../../scripts/trader/ri-evidence-campaign";

describe("ri-evidence-campaign (RI-P7)", () => {
  it("defaults to Track A only", () => {
    expect(resolveCampaignTracks(undefined)).toEqual([CAMPAIGN_TRACK_A]);
  });

  it("resolves both tracks", () => {
    expect(resolveCampaignTracks("both")).toEqual([CAMPAIGN_TRACK_A, CAMPAIGN_TRACK_B]);
  });
});
