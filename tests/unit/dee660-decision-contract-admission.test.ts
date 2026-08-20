import { describe, expect, it } from "vitest";

import {
  createScientificAdmissionAuthorityV1,
  resolveDecisionEvaluationContractV2,
} from "@/lib/trader/intelligence/decision-economics/dee660-decision-evaluation-contract-v1";
import { verifyForecastAndScientificAdmissionV1 } from "@/lib/trader/intelligence/decision-economics/dee660-forecast-admission-v1";
import { SCIENTIFIC_ADMISSION_RECEIPT_VERSION } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";

import { dee659TestAnchor } from "./helpers/dee659-execution-payoff-fixtures";
import {
  DEE660_TEST_DIGEST_A,
  DEE660_TEST_DIGEST_C,
  DEE660_TEST_DIGEST_D,
  dee660EvaluationInput,
  dee660Sample13d,
  dee660TestForecast,
  withVerifiedForecast,
} from "./helpers/dee660-decision-evaluator-fixtures";

describe("DEE-660 Decision evaluation contract and admission", () => {
  it("dispatches only the exact DEE-659 registered Forecast family", () => {
    const identity = dee660EvaluationInput().forecast.identity;
    expect(resolveDecisionEvaluationContractV2(identity)).toMatchObject({
      ok: true,
      contract: {
        aggregationPolicy:
          "scale8-exact-rational-mean-type7-q10-lower-q50-base-q90-base/v1",
        cashBaseline: "ZERO_INCREMENTAL_RETURN",
        actionableRule: "ALL_UPSTREAM_GATES_PASS_AND_EV_LOWER_EXACT_GT_ZERO",
      },
    });
    expect(
      resolveDecisionEvaluationContractV2({
        ...identity,
        modelTransformVersion: "unknown-family/v1",
      } as unknown as typeof identity),
    ).toEqual({ ok: false, reasonCode: "FORECAST_CONTRACT_MISMATCH" });
  });

  it("accepts exact content-addressed Forecast and scientific authority", () => {
    const result = verifyForecastAndScientificAdmissionV1(dee660EvaluationInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canonicalSamples).toHaveLength(1);
      expect(result.canonicalSamples[0]).toHaveLength(1);
      expect(result.canonicalSamples[0]?.[0]).toHaveLength(13);
    }
  });

  it("requires purpose-bound verified receipts; raw digests alone never admit", () => {
    const base = dee660EvaluationInput();
    const unverifiedForecast = verifyForecastAndScientificAdmissionV1({
      ...base,
      authorityVerification: {
        ...base.authorityVerification,
        forecast: { ...base.authorityVerification.forecast, verified: false },
      },
    });
    expect(unverifiedForecast).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(["FORECAST_AUTHORITY_NOT_VERIFIED"]),
    });

    const unverifiedScience = verifyForecastAndScientificAdmissionV1({
      ...base,
      authorityVerification: {
        ...base.authorityVerification,
        scientificAdmission: {
          ...base.authorityVerification.scientificAdmission,
          verified: false,
        },
      },
    });
    expect(unverifiedScience).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(["SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED"]),
    });
  });

  it("recomputes K×M distribution/content digests from canonical scale-8 samples", () => {
    const base = dee660EvaluationInput();
    const tamperedSamples = base.forecast.replicaSamples.map((replica) =>
      replica.map((sample) => sample.map((value, index) => (index === 4 ? value + 0.01 : value))),
    );
    const tampered = verifyForecastAndScientificAdmissionV1({
      ...base,
      forecast: { ...base.forecast, replicaSamples: tamperedSamples },
    });
    expect(tampered).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(["FORECAST_DISTRIBUTION_DIGEST_MISMATCH"]),
    });

    const contentMismatch = verifyForecastAndScientificAdmissionV1({
      ...base,
      forecast: { ...base.forecast, forecastContentDigestHex: DEE660_TEST_DIGEST_A },
    });
    expect(contentMismatch).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(["FORECAST_CONTENT_DIGEST_MISMATCH"]),
    });

    const kmMismatch = verifyForecastAndScientificAdmissionV1({
      ...base,
      forecast: { ...base.forecast, k: base.forecast.k + 1 },
    });
    expect(kmMismatch).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(["FORECAST_KM_MISMATCH"]),
    });
  });

  it("rejects stale Forecast verification after a valid subject substitution", () => {
    const base = dee660EvaluationInput();
    const replacement = dee660TestForecast([
      [dee660Sample13d({ exitPrices: [120, 120, 120] })],
    ]);
    const result = verifyForecastAndScientificAdmissionV1({
      ...withVerifiedForecast(base, replacement),
      authorityVerification: base.authorityVerification,
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(["FORECAST_AUTHORITY_NOT_VERIFIED"]),
    });
  });

  it("binds scientific admission to org, package, K, M, source receipt, and verifier", () => {
    const base = dee660EvaluationInput();
    for (const scientificAdmission of [
      { ...base.scientificAdmission, organizationId: "wrong-org" },
      {
        ...base.scientificAdmission,
        selectedPackageContentDigestHex: DEE660_TEST_DIGEST_A,
      },
      { ...base.scientificAdmission, selectedKConfigDec: base.forecast.k + 1 },
      { ...base.scientificAdmission, sourceReceiptContentDigestHex: "invalid" },
    ]) {
      const result = verifyForecastAndScientificAdmissionV1({ ...base, scientificAdmission });
      expect(result).toMatchObject({
        ok: false,
        reasonCodes: expect.arrayContaining(["SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED"]),
      });
    }

    expect(() =>
      createScientificAdmissionAuthorityV1({
        sourceReceiptSchemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
        organizationId: base.forecast.organizationId,
        wfPartition: "WF_PREDICTIVE",
        terminalStatus: "QUALIFIED",
        selectedPackageGenerationIdentityDigestHex:
          base.forecast.predictivePackageGenerationIdentityDigestHex,
        selectedPackageContentDigestHex: base.forecast.predictivePackageContentDigestHex,
        selectedKConfigDec: 0,
        selectedMConfigDec: base.forecast.m,
        evidenceSemanticDigestHex: DEE660_TEST_DIGEST_C,
        sourceReceiptContentDigestHex: DEE660_TEST_DIGEST_D,
      }),
    ).toThrow(/invalid authority/);
  });

  it("binds Forecast issuance to the exact qualified anchor authority", () => {
    const base = dee660EvaluationInput();
    const otherAnchor = dee659TestAnchor("101");
    const result = verifyForecastAndScientificAdmissionV1({
      ...base,
      anchorAuthority: otherAnchor,
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(["FORECAST_ANCHOR_BINDING_MISMATCH"]),
    });
  });
});
