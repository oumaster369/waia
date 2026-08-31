import { describe, expect, it, vi } from "vitest";

import {
  createHistoricalDecisionEconomicsProductionInputBuilderV2,
  type PersistedDecisionEconomicsAuthoritiesV2,
} from "@/lib/trader/historical-simulation-v2/decision-economics-production-adapter-v2";
import { evaluateDecisionEconomicsV2ForSemanticMode } from "@/lib/trader/intelligence/decision-economics/decision-economic-evaluator-v2";
import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { TARGET_ROLE_EXECUTION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { distributionSemanticDigestHex } from "@/lib/trader/intelligence/forecast-v2/distribution-semantic-digest-v1";
import { computeForecastContentDigest } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import type { ForecastRuntimeAuthorizedOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { SCIENTIFIC_ADMISSION_RECEIPT_VERSION } from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";
import {
  DEE659_TEST_DIGEST_A,
  DEE659_TEST_DIGEST_B,
  DEE659_TEST_DIGEST_C,
  DEE659_TEST_DIGEST_D,
  dee659Sample13d,
  dee659TestAnchor,
  dee659TestAuthorityVerification,
  dee659TestCash,
  dee659TestPolicy,
  dee659TestSize,
} from "./helpers/dee659-execution-payoff-fixtures";

const ORG = "00000000-0000-4000-8000-000000000001";
const ACCOUNT = "00000000-0000-4000-8000-000000000003";

function forecast(admissionDigest: string): ForecastRuntimeAuthorizedOutcomeV2 {
  const samples = [[[...dee659Sample13d({ exitPrices: [110, 110, 110] })]]];
  const distributionDigest = distributionSemanticDigestHex({
    forecastGenerationIdentityDigestHex: DEE659_TEST_DIGEST_D,
    predictivePackageContentDigestHex: DEE659_TEST_DIGEST_C,
    k: 1,
    m: 1,
    normalizationVersionDigestHex: DEE659_TEST_DIGEST_C,
    targetRoleId: TARGET_ROLE_EXECUTION,
    samples,
  });
  const contentDigest = computeForecastContentDigest(
    Buffer.from(DEE659_TEST_DIGEST_D, "hex"),
    Buffer.from(distributionDigest, "hex"),
  );
  return {
    status: "FORECAST_AUTHORIZED",
    authority: {
      organizationId: ORG,
      anchorClosedBarEpochMs: 1_725_000_000_000,
      scientificAdmissionReceiptContentDigestHex: admissionDigest,
      contentDigestHex: DEE659_TEST_DIGEST_A,
    },
    issuance: {
      package: {
        family: {
          symbol: "BTCUSDT",
          primaryHorizonMinutes: 30,
          modelTransformVersion: MODEL_TRANSFORM_VERSION,
        },
        kConfigDec: 1,
        mConfigDec: 1,
        predictivePackageGenerationIdentityDigest: Buffer.from(DEE659_TEST_DIGEST_B, "hex"),
        predictivePackageContentDigest: Buffer.from(DEE659_TEST_DIGEST_C, "hex"),
      },
      forecastGenerationIdentityDigest: Buffer.from(DEE659_TEST_DIGEST_D, "hex"),
      forecastContentDigestExec: contentDigest,
      distributionSemanticDigestExec: Buffer.from(distributionDigest, "hex"),
      normalizationVersionDigestHex: DEE659_TEST_DIGEST_C,
      samples,
    },
  } as unknown as ForecastRuntimeAuthorizedOutcomeV2;
}

function persisted(): PersistedDecisionEconomicsAuthoritiesV2 {
  const anchor = dee659TestAnchor();
  const executablePolicy = dee659TestPolicy();
  const economicSizeSet = dee659TestSize();
  const cashAuthority = dee659TestCash();
  const scientificAdmission = {
    id: "00000000-0000-4000-8000-000000000659",
    organizationId: ORG,
    receiptKind: "WF_PREDICTIVE",
    kmGlobalAnchorSetDigest: DEE659_TEST_DIGEST_A,
    replicaRootFamilyIdentityDigest: DEE659_TEST_DIGEST_B,
    selectedKConfigDec: 1,
    selectedMConfigDec: 1,
    alphaEpiConfigScale8: "0.1",
    selectedPackageGenerationIdentityDigest: DEE659_TEST_DIGEST_B,
    selectedPackageContentDigest: DEE659_TEST_DIGEST_C,
    evidenceSemanticDigest: DEE659_TEST_DIGEST_D,
    receiptJson: "{}",
    contentDigest: DEE659_TEST_DIGEST_A,
    schemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
    htxVolumeQualificationReceiptDigest: DEE659_TEST_DIGEST_D,
  };
  return {
    forecastId: "00000000-0000-4000-8000-000000000660",
    forecastIssuanceReceiptDigestHex: DEE659_TEST_DIGEST_A,
    forecastVerificationReceiptDigestHex: DEE659_TEST_DIGEST_B,
    scientificAdmission,
    scientificVerificationReceiptDigestHex: DEE659_TEST_DIGEST_C,
    anchorAuthority: anchor,
    executablePolicy,
    economicSizeSet,
    cashAuthority,
    executionPayoffVerification: dee659TestAuthorityVerification({
      anchor,
      policy: executablePolicy,
      size: economicSizeSet,
      cash: cashAuthority,
    }),
  };
}

describe("Historical Decision Economics production adapter V2", () => {
  it("builds a verified DEE-660 input from admitted Forecast issuance and persisted authorities", async () => {
    const rows = persisted();
    const load = vi.fn(async () => rows);
    const build = createHistoricalDecisionEconomicsProductionInputBuilderV2({
      organizationId: ORG,
      accountId: ACCOUNT,
      authorities: { load },
    });
    const input = await build({ cycle: { cycleId: "cycle-1" }, forecast: forecast(rows.scientificAdmission.contentDigest) });
    const result = evaluateDecisionEconomicsV2ForSemanticMode(input, "HISTORICAL");

    expect(result.receipt.reasonCodes).toEqual([]);
    expect(result).toMatchObject({ action: "ENTER_LONG", decisionActionable: true });
    expect(input.forecast.replicaSamples).toEqual(forecast(rows.scientificAdmission.contentDigest).issuance.samples);
    expect(input.authorityVerification.forecast.verified).toBe(true);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG,
      accountId: ACCOUNT,
      forecastAuthorityContentDigestHex: DEE659_TEST_DIGEST_A,
    }));
  });

  it("fails closed when persisted scientific admission is not bound to the issuance", async () => {
    const rows = persisted();
    const build = createHistoricalDecisionEconomicsProductionInputBuilderV2({
      organizationId: ORG,
      accountId: ACCOUNT,
      authorities: { load: async () => ({ ...rows, scientificAdmission: { ...rows.scientificAdmission, selectedPackageContentDigest: DEE659_TEST_DIGEST_D } }) },
    });
    await expect(build({ cycle: { cycleId: "cycle-1" }, forecast: forecast(rows.scientificAdmission.contentDigest) }))
      .rejects.toThrow("HISTORICAL_DECISION_ADAPTER_INVALID:scientificAdmissionMismatch");
  });
});
