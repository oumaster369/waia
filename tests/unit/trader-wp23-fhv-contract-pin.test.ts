import { describe, expect, it } from "vitest";

import {
  HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN,
  HTR_FHV_RUN_CONTRACT_V0,
  assertHtrFhvRunContractMatch,
  computeHtrFhvRunContractDigest,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

describe("HTR-WP23 FHV Run Contract v0 pin", () => {
  it("pins HTX-only shared multi-instrument portfolio", () => {
    expect(HTR_FHV_RUN_CONTRACT_V0.venueScope).toBe("HTX_ONLY");
    expect(HTR_FHV_RUN_CONTRACT_V0.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(HTR_FHV_RUN_CONTRACT_V0.initialPortfolio.cashUsdt).toBe("100000");
    expect(HTR_FHV_RUN_CONTRACT_V0.initialPortfolio.portfolioMode).toBe("SHARED_MULTI_INSTRUMENT");
  });

  it("pins dataset manifest semantic digest from WP12 evidence", () => {
    expect(HTR_FHV_RUN_CONTRACT_V0.datasetManifestSemanticDigestPin).toBe(
      HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN,
    );
    expect(HTR_FHV_RUN_CONTRACT_V0.datasetSourceClassification).toBe("NOT_AVAILABLE");
    expect(HTR_FHV_RUN_CONTRACT_V0.blindHoldout.status).toBe("SEALED_NOT_ACCESSED");
  });

  it("rejects holdout access and D-11B substitution", () => {
    expect(() =>
      assertHtrFhvRunContractMatch({
        holdoutAccessRequested: true,
      }),
    ).toThrow(/HTR_WP23_FHV_CONTRACT:HOLDOUT_ACCESS_PROHIBITED/);

    expect(() =>
      assertHtrFhvRunContractMatch({
        d11bDatasetAsFhvSubstitute: true,
      }),
    ).toThrow(/HTR_WP23_FHV_CONTRACT:D11B_DATASET_SUBSTITUTION_PROHIBITED/);
  });

  it("computes stable contract digest", () => {
    const first = computeHtrFhvRunContractDigest();
    const second = computeHtrFhvRunContractDigest(HTR_FHV_RUN_CONTRACT_V0);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });
});
