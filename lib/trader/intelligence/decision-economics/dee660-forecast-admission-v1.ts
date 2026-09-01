import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { distributionSemanticDigestHex } from "@/lib/trader/intelligence/forecast-v2/distribution-semantic-digest-v1";
import { computeForecastContentDigest } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { SCIENTIFIC_ADMISSION_RECEIPT_VERSION } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import { SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";

import { validateForecastAnchorPriceAuthorityV1 } from "./dee659-execution-payoff-authorities-v1";
import {
  isDee659DigestHex,
  sameDee659AuthorityBindingV1,
  validateDee659AuthorityBindingV1,
} from "./dee659-execution-payoff-contract-v1";
import {
  DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION,
  DEE660_FORECAST_ECONOMIC_AUTHORITY_VERSION,
  DEE660_SCIENTIFIC_ADMISSION_AUTHORITY_VERSION,
  computeForecastEconomicAuthorityContentDigestV1,
  type DecisionEconomicEvaluationInputV2,
  type Dee660ReasonCode,
  type ForecastEconomicAuthorityV1,
  validateScientificAdmissionAuthorityContentDigestV1,
} from "./dee660-decision-evaluation-contract-v1";

export type CanonicalForecastSamplesV1 = readonly (readonly (readonly number[])[])[];

export type ForecastAdmissionEvaluationV1 =
  | { ok: true; canonicalSamples: CanonicalForecastSamplesV1 }
  | { ok: false; reasonCodes: readonly Dee660ReasonCode[] };

function uniqueReasons(reasons: readonly Dee660ReasonCode[]): Dee660ReasonCode[] {
  return [...new Set(reasons)];
}

function canonicalForecastSamples(
  forecast: ForecastEconomicAuthorityV1,
): CanonicalForecastSamplesV1 | null {
  if (
    !Number.isSafeInteger(forecast.k) ||
    forecast.k <= 0 ||
    !Number.isSafeInteger(forecast.m) ||
    forecast.m <= 0 ||
    !Array.isArray(forecast.replicaSamples) ||
    forecast.replicaSamples.length !== forecast.k
  ) {
    return null;
  }
  const canonical: number[][][] = [];
  for (const replica of forecast.replicaSamples) {
    if (!Array.isArray(replica) || replica.length !== forecast.m) return null;
    const canonicalReplica: number[][] = [];
    for (const sample of replica) {
      if (!Array.isArray(sample) || sample.length !== 13) return null;
      const canonicalSample: number[] = [];
      for (const component of sample) {
        if (!Number.isFinite(component)) return null;
        const quantized = Number(quantizeScale8HalfUp(component));
        if (!Number.isFinite(quantized)) return null;
        canonicalSample.push(quantized);
      }
      canonicalReplica.push(canonicalSample);
    }
    canonical.push(canonicalReplica);
  }
  return canonical;
}

function forecastAuthorityReasons(
  input: DecisionEconomicEvaluationInputV2,
  canonicalSamples: CanonicalForecastSamplesV1 | null,
): Dee660ReasonCode[] {
  const forecast = input.forecast;
  const reasons: Dee660ReasonCode[] = [];
  if (
    forecast.schemaVersion !== DEE660_FORECAST_ECONOMIC_AUTHORITY_VERSION ||
    forecast.forecastId.trim() === "" ||
    validateDee659AuthorityBindingV1(forecast).length > 0 ||
    !Number.isSafeInteger(forecast.forecastAnchorClosedBarEpochMs) ||
    forecast.forecastAnchorClosedBarEpochMs <= 0 ||
    ![
      forecast.anchorAuthorityContentDigestHex,
      forecast.predictivePackageContentDigestHex,
      forecast.predictivePackageGenerationIdentityDigestHex,
      forecast.forecastGenerationIdentityDigestHex,
      forecast.forecastContentDigestHex,
      forecast.normalizationVersionDigestHex,
      forecast.distributionSemanticDigestHex,
      forecast.issuanceReceiptDigestHex,
      forecast.contentDigestHex,
    ].every(isDee659DigestHex)
  ) {
    reasons.push("FORECAST_AUTHORITY_INVALID");
  }
  const { contentDigestHex, ...forecastPayload } = forecast;
  if (
    !isDee659DigestHex(contentDigestHex) ||
    computeForecastEconomicAuthorityContentDigestV1(forecastPayload) !== contentDigestHex
  ) {
    reasons.push("FORECAST_AUTHORITY_INVALID");
  }
  if (canonicalSamples === null) reasons.push("FORECAST_KM_MISMATCH");
  else {
    try {
      const distributionDigest = distributionSemanticDigestHex({
        forecastGenerationIdentityDigestHex: forecast.forecastGenerationIdentityDigestHex,
        predictivePackageContentDigestHex: forecast.predictivePackageContentDigestHex,
        k: forecast.k,
        m: forecast.m,
        normalizationVersionDigestHex: forecast.normalizationVersionDigestHex,
        targetRoleId: forecast.identity.targetRoleId,
        samples: canonicalSamples,
      });
      if (distributionDigest !== forecast.distributionSemanticDigestHex) {
        reasons.push("FORECAST_DISTRIBUTION_DIGEST_MISMATCH");
      }
      const contentDigest = computeForecastContentDigest(
        Buffer.from(forecast.forecastGenerationIdentityDigestHex, "hex"),
        Buffer.from(forecast.distributionSemanticDigestHex, "hex"),
      ).toString("hex");
      if (contentDigest !== forecast.forecastContentDigestHex) {
        reasons.push("FORECAST_CONTENT_DIGEST_MISMATCH");
      }
    } catch {
      reasons.push("FORECAST_AUTHORITY_INVALID");
    }
  }
  const verification = input.authorityVerification.forecast;
  if (
    verification.schemaVersion !== DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION ||
    !verification.verified ||
    verification.purpose !== "FORECAST_ISSUANCE" ||
    verification.organizationId !== forecast.organizationId ||
    verification.accountId !== forecast.accountId ||
    verification.instrumentIdentityDigestHex !== forecast.instrumentIdentityDigestHex ||
    verification.subjectContentDigestHex !== forecast.contentDigestHex ||
    !isDee659DigestHex(verification.subjectContentDigestHex) ||
    !isDee659DigestHex(verification.verificationReceiptDigestHex)
  ) {
    reasons.push("FORECAST_AUTHORITY_NOT_VERIFIED");
  }
  return reasons;
}

function scientificAdmissionReasons(
  input: DecisionEconomicEvaluationInputV2,
): Dee660ReasonCode[] {
  const admission = input.scientificAdmission;
  const forecast = input.forecast;
  const verification = input.authorityVerification.scientificAdmission;
  const validSubject =
    admission.schemaVersion === DEE660_SCIENTIFIC_ADMISSION_AUTHORITY_VERSION &&
    [SCIENTIFIC_ADMISSION_RECEIPT_VERSION, SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION]
      .includes(admission.sourceReceiptSchemaVersion) &&
    admission.organizationId === forecast.organizationId &&
    admission.wfPartition === "WF_PREDICTIVE" &&
    admission.terminalStatus === "QUALIFIED" &&
    admission.selectedPackageGenerationIdentityDigestHex ===
      forecast.predictivePackageGenerationIdentityDigestHex &&
    admission.selectedPackageContentDigestHex === forecast.predictivePackageContentDigestHex &&
    admission.selectedKConfigDec === forecast.k &&
    admission.selectedMConfigDec === forecast.m &&
    isDee659DigestHex(admission.evidenceSemanticDigestHex) &&
    isDee659DigestHex(admission.sourceReceiptContentDigestHex) &&
    validateScientificAdmissionAuthorityContentDigestV1(admission);
  const validVerification =
    verification.schemaVersion === DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION &&
    verification.verified &&
    verification.purpose === "SCIENTIFIC_ADMISSION" &&
    verification.organizationId === forecast.organizationId &&
    verification.subjectContentDigestHex === admission.contentDigestHex &&
    isDee659DigestHex(verification.subjectContentDigestHex) &&
    isDee659DigestHex(verification.verificationReceiptDigestHex);
  return validSubject && validVerification ? [] : ["SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED"];
}

function anchorBindingReasons(input: DecisionEconomicEvaluationInputV2): Dee660ReasonCode[] {
  const forecast = input.forecast;
  const anchor = input.anchorAuthority;
  return validateForecastAnchorPriceAuthorityV1(anchor).length === 0 &&
    sameDee659AuthorityBindingV1(forecast, anchor) &&
    forecast.forecastAnchorClosedBarEpochMs === anchor.forecastAnchorClosedBarEpochMs &&
    forecast.forecastAnchorClosedBarEpochMs === anchor.qualifiedAnchorClosedBarEpochMs &&
    forecast.anchorAuthorityContentDigestHex === anchor.contentDigestHex
    ? []
    : ["FORECAST_ANCHOR_BINDING_MISMATCH"];
}

export function verifyForecastAndScientificAdmissionV1(
  input: DecisionEconomicEvaluationInputV2,
): ForecastAdmissionEvaluationV1 {
  try {
    const canonicalSamples = canonicalForecastSamples(input.forecast);
    const reasons = uniqueReasons([
      ...forecastAuthorityReasons(input, canonicalSamples),
      ...scientificAdmissionReasons(input),
      ...anchorBindingReasons(input),
    ]);
    return reasons.length === 0 && canonicalSamples !== null
      ? { ok: true, canonicalSamples }
      : { ok: false, reasonCodes: reasons };
  } catch {
    return { ok: false, reasonCodes: ["EVALUATION_INPUT_MALFORMED"] };
  }
}
