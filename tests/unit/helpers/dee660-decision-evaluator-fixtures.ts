import { computeForecastContentDigest } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { distributionSemanticDigestHex } from "@/lib/trader/intelligence/forecast-v2/distribution-semantic-digest-v1";
import {
  createForecastEconomicAuthorityV1,
  createScientificAdmissionAuthorityV1,
  DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION,
  type DecisionEconomicEvaluationInputV2,
  type ForecastEconomicAuthorityV1,
  type VerifiedForecastEconomicAuthorityV1,
  type VerifiedScientificAdmissionAuthorityV1,
} from "@/lib/trader/intelligence/decision-economics/dee660-decision-evaluation-contract-v1";
import { SCIENTIFIC_ADMISSION_RECEIPT_VERSION } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";

import {
  DEE659_TEST_DIGEST_A,
  DEE659_TEST_DIGEST_B,
  DEE659_TEST_DIGEST_C,
  DEE659_TEST_DIGEST_D,
  dee659Sample13d,
  dee659TestAnchor,
  dee659TestAuthorityBinding,
  dee659TestAuthorityVerification,
  dee659TestCash,
  dee659TestForecastIdentity,
  dee659TestPolicy,
  dee659TestSize,
} from "./dee659-execution-payoff-fixtures";

export {
  DEE659_TEST_DIGEST_A as DEE660_TEST_DIGEST_A,
  DEE659_TEST_DIGEST_B as DEE660_TEST_DIGEST_B,
  DEE659_TEST_DIGEST_C as DEE660_TEST_DIGEST_C,
  DEE659_TEST_DIGEST_D as DEE660_TEST_DIGEST_D,
  dee659Sample13d as dee660Sample13d,
};

function forecastVerification(
  forecast: ForecastEconomicAuthorityV1,
): VerifiedForecastEconomicAuthorityV1 {
  return {
    schemaVersion: DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION,
    verified: true,
    purpose: "FORECAST_ISSUANCE",
    organizationId: forecast.organizationId,
    accountId: forecast.accountId,
    instrumentIdentityDigestHex: forecast.instrumentIdentityDigestHex,
    subjectContentDigestHex: forecast.contentDigestHex,
    verificationReceiptDigestHex: DEE659_TEST_DIGEST_D,
  };
}

function scientificVerification(
  admission: ReturnType<typeof createScientificAdmissionAuthorityV1>,
): VerifiedScientificAdmissionAuthorityV1 {
  return {
    schemaVersion: DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION,
    verified: true,
    purpose: "SCIENTIFIC_ADMISSION",
    organizationId: admission.organizationId,
    subjectContentDigestHex: admission.contentDigestHex,
    verificationReceiptDigestHex: DEE659_TEST_DIGEST_D,
  };
}

export function dee660TestForecast(
  replicaSamples: readonly (readonly (readonly number[])[])[] = [
    [dee659Sample13d({ exitPrices: [110, 110, 110] })],
  ],
  overrides: Partial<
    Omit<ForecastEconomicAuthorityV1, "schemaVersion" | "replicaSamples" | "contentDigestHex">
  > = {},
): ForecastEconomicAuthorityV1 {
  const binding = dee659TestAuthorityBinding();
  const anchor = dee659TestAnchor();
  const identity = dee659TestForecastIdentity();
  const k = replicaSamples.length;
  const m = replicaSamples[0]?.length ?? 0;
  const forecastGenerationIdentityDigestHex = DEE659_TEST_DIGEST_A;
  const predictivePackageContentDigestHex = DEE659_TEST_DIGEST_B;
  const normalizationVersionDigestHex = DEE659_TEST_DIGEST_C;
  const distributionDigest = distributionSemanticDigestHex({
    forecastGenerationIdentityDigestHex,
    predictivePackageContentDigestHex,
    k,
    m,
    normalizationVersionDigestHex,
    targetRoleId: identity.targetRoleId,
    samples: replicaSamples,
  });
  const forecastContentDigestHex = computeForecastContentDigest(
    Buffer.from(forecastGenerationIdentityDigestHex, "hex"),
    Buffer.from(distributionDigest, "hex"),
  ).toString("hex");
  return createForecastEconomicAuthorityV1({
    ...binding,
    forecastId: "00000000-0000-4000-8000-000000000660",
    identity,
    forecastAnchorClosedBarEpochMs: anchor.forecastAnchorClosedBarEpochMs,
    anchorAuthorityContentDigestHex: anchor.contentDigestHex,
    predictivePackageContentDigestHex,
    predictivePackageGenerationIdentityDigestHex: DEE659_TEST_DIGEST_D,
    forecastGenerationIdentityDigestHex,
    forecastContentDigestHex,
    normalizationVersionDigestHex,
    k,
    m,
    distributionSemanticDigestHex: distributionDigest,
    issuanceReceiptDigestHex: DEE659_TEST_DIGEST_A,
    replicaSamples,
    ...overrides,
  });
}

export function dee660TestScientificAdmission(forecast: ForecastEconomicAuthorityV1) {
  return createScientificAdmissionAuthorityV1({
    sourceReceiptSchemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
    organizationId: forecast.organizationId,
    wfPartition: "WF_PREDICTIVE",
    terminalStatus: "QUALIFIED",
    selectedPackageGenerationIdentityDigestHex:
      forecast.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: forecast.predictivePackageContentDigestHex,
    selectedKConfigDec: forecast.k,
    selectedMConfigDec: forecast.m,
    evidenceSemanticDigestHex: DEE659_TEST_DIGEST_C,
    sourceReceiptContentDigestHex: DEE659_TEST_DIGEST_D,
  });
}

export function dee660EvaluationInput(input: {
  forecast?: ForecastEconomicAuthorityV1;
  anchor?: ReturnType<typeof dee659TestAnchor>;
  policy?: ReturnType<typeof dee659TestPolicy>;
  size?: ReturnType<typeof dee659TestSize>;
  cash?: ReturnType<typeof dee659TestCash>;
} = {}): DecisionEconomicEvaluationInputV2 {
  const forecast = input.forecast ?? dee660TestForecast();
  const anchor = input.anchor ?? dee659TestAnchor();
  const policy = input.policy ?? dee659TestPolicy();
  const economicSizeSet = input.size ?? dee659TestSize();
  const cashAuthority = input.cash ?? dee659TestCash();
  const scientificAdmission = dee660TestScientificAdmission(forecast);
  return {
    forecast,
    scientificAdmission,
    anchorAuthority: anchor,
    policy,
    economicSizeSet,
    cashAuthority,
    authorityVerification: {
      forecast: forecastVerification(forecast),
      scientificAdmission: scientificVerification(scientificAdmission),
      executionPayoff: dee659TestAuthorityVerification({
        anchor,
        policy,
        size: economicSizeSet,
        cash: cashAuthority,
      }),
    },
  };
}

export function withVerifiedForecast(
  input: DecisionEconomicEvaluationInputV2,
  forecast: ForecastEconomicAuthorityV1,
): DecisionEconomicEvaluationInputV2 {
  const scientificAdmission = dee660TestScientificAdmission(forecast);
  return {
    ...input,
    forecast,
    scientificAdmission,
    authorityVerification: {
      ...input.authorityVerification,
      forecast: forecastVerification(forecast),
      scientificAdmission: scientificVerification(scientificAdmission),
    },
  };
}
