import {
  createForecastEconomicAuthorityV1,
  createScientificAdmissionAuthorityV1,
  DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION,
  type DecisionEconomicEvaluationInputV2,
} from "@/lib/trader/intelligence/decision-economics/dee660-decision-evaluation-contract-v1";
import type {
  CashEconomicAuthorityV1,
  Dee659ExecutablePolicyInstanceV1,
  EconomicAdmissibleSizeSetV1,
  ForecastAnchorPriceAuthorityV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-authorities-v1";
import {
  DEE659_INTERIM_POSITION_POLICY_ID,
  sameDee659AuthorityBindingV1,
  type ExecutionPayoffAuthorityVerificationV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-contract-v1";
import {
  COMPONENT_LAYOUT_VERSION,
  MODEL_TRANSFORM_VERSION,
  REPRESENTATION_SAMPLE_ENSEMBLE,
  TARGET_ROLE_EXECUTION,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import type { ForecastRuntimeAuthorizedOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { ScientificAdmissionReceiptRecord } from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";

export type PersistedDecisionEconomicsAuthoritiesV2 = Readonly<{
  forecastId: string;
  forecastIssuanceReceiptDigestHex: string;
  forecastVerificationReceiptDigestHex: string;
  scientificAdmission: ScientificAdmissionReceiptRecord;
  scientificVerificationReceiptDigestHex: string;
  anchorAuthority: ForecastAnchorPriceAuthorityV1;
  executablePolicy: Dee659ExecutablePolicyInstanceV1;
  economicSizeSet: EconomicAdmissibleSizeSetV1;
  cashAuthority: CashEconomicAuthorityV1;
  executionPayoffVerification: ExecutionPayoffAuthorityVerificationV1;
}>;

export type PersistedDecisionEconomicsAuthorityPortV2 = Readonly<{
  load(input: Readonly<{
    organizationId: string;
    accountId: string;
    cycleId: string;
    forecastAuthorityContentDigestHex: string;
  }>): Promise<PersistedDecisionEconomicsAuthoritiesV2>;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`HISTORICAL_DECISION_ADAPTER_INVALID:${field}`);
}

function assertPersistedBindings(input: {
  organizationId: string;
  accountId: string;
  forecast: ForecastRuntimeAuthorizedOutcomeV2;
  persisted: PersistedDecisionEconomicsAuthoritiesV2;
}): void {
  const { persisted, forecast } = input;
  if (persisted.forecastId.trim() === "") {
    throw new Error("HISTORICAL_DECISION_ADAPTER_INVALID:forecastId");
  }
  [
    [persisted.forecastIssuanceReceiptDigestHex, "forecastIssuanceReceiptDigest"],
    [persisted.forecastVerificationReceiptDigestHex, "forecastVerificationReceiptDigest"],
    [persisted.scientificVerificationReceiptDigestHex, "scientificVerificationReceiptDigest"],
  ].forEach(([value, field]) => requireDigest(value, field));
  const authorities = [
    persisted.executablePolicy,
    persisted.economicSizeSet,
    persisted.cashAuthority,
  ];
  if (
    persisted.anchorAuthority.organizationId !== input.organizationId ||
    persisted.anchorAuthority.accountId !== input.accountId ||
    authorities.some((authority) => !sameDee659AuthorityBindingV1(persisted.anchorAuthority, authority))
  ) {
    throw new Error("HISTORICAL_DECISION_ADAPTER_INVALID:authorityBindingMismatch");
  }
  const admission = persisted.scientificAdmission;
  if (
    admission.organizationId !== input.organizationId ||
    admission.receiptKind !== "WF_PREDICTIVE" ||
    admission.selectedKConfigDec !== forecast.issuance.package.kConfigDec ||
    admission.selectedMConfigDec !== forecast.issuance.package.mConfigDec ||
    admission.selectedPackageGenerationIdentityDigest !==
      digestHex(forecast.issuance.package.predictivePackageGenerationIdentityDigest) ||
    admission.selectedPackageContentDigest !==
      digestHex(forecast.issuance.package.predictivePackageContentDigest) ||
    admission.contentDigest !== forecast.authority.scientificAdmissionReceiptContentDigestHex
  ) {
    throw new Error("HISTORICAL_DECISION_ADAPTER_INVALID:scientificAdmissionMismatch");
  }
  if (
    persisted.anchorAuthority.forecastAnchorClosedBarEpochMs !==
      forecast.authority.anchorClosedBarEpochMs ||
    persisted.anchorAuthority.symbol !== forecast.issuance.package.family.symbol
  ) {
    throw new Error("HISTORICAL_DECISION_ADAPTER_INVALID:forecastAnchorMismatch");
  }
  if (
    forecast.issuance.package.family.modelTransformVersion !== MODEL_TRANSFORM_VERSION ||
    ![30, 60].includes(forecast.issuance.package.family.primaryHorizonMinutes)
  ) {
    throw new Error("HISTORICAL_DECISION_ADAPTER_INVALID:decisionContractFamily");
  }
}

/**
 * Converts an admitted, replay-verified Forecast Runtime V2 issuance plus durable
 * DEE-659 authorities into the exact DEE-660 evaluator input. Nothing is inferred
 * from strategy diagnostics and no receipt digest is synthesized.
 */
export function createHistoricalDecisionEconomicsProductionInputBuilderV2(input: Readonly<{
  organizationId: string;
  accountId: string;
  authorities: PersistedDecisionEconomicsAuthorityPortV2;
}>): (context: Readonly<{
  cycle: { cycleId: string };
  forecast: ForecastRuntimeAuthorizedOutcomeV2;
}>) => Promise<DecisionEconomicEvaluationInputV2> {
  return async ({ cycle, forecast }) => {
    const persisted = await input.authorities.load({
      organizationId: input.organizationId,
      accountId: input.accountId,
      cycleId: cycle.cycleId,
      forecastAuthorityContentDigestHex: forecast.authority.contentDigestHex,
    });
    assertPersistedBindings({ ...input, forecast, persisted });

    const family = forecast.issuance.package.family;
    const binding = persisted.anchorAuthority;
    const forecastEconomicAuthority = createForecastEconomicAuthorityV1({
      organizationId: binding.organizationId,
      accountId: binding.accountId,
      venue: binding.venue,
      market: binding.market,
      symbol: binding.symbol,
      baseAsset: binding.baseAsset,
      quoteAsset: binding.quoteAsset,
      instrumentIdentityDigestHex: binding.instrumentIdentityDigestHex,
      forecastId: persisted.forecastId,
      identity: {
        targetRoleId: TARGET_ROLE_EXECUTION,
        representationKind: REPRESENTATION_SAMPLE_ENSEMBLE,
        componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
        outcomeVersion: OUTCOME_VERSION,
        modelTransformVersion: MODEL_TRANSFORM_VERSION,
        primaryHorizonMinutes: family.primaryHorizonMinutes as 30 | 60,
        interimPositionPolicyId: DEE659_INTERIM_POSITION_POLICY_ID,
      },
      forecastAnchorClosedBarEpochMs: forecast.authority.anchorClosedBarEpochMs,
      anchorAuthorityContentDigestHex: persisted.anchorAuthority.contentDigestHex,
      predictivePackageContentDigestHex: digestHex(
        forecast.issuance.package.predictivePackageContentDigest,
      ),
      predictivePackageGenerationIdentityDigestHex: digestHex(
        forecast.issuance.package.predictivePackageGenerationIdentityDigest,
      ),
      forecastGenerationIdentityDigestHex: digestHex(
        forecast.issuance.forecastGenerationIdentityDigest,
      ),
      forecastContentDigestHex: digestHex(forecast.issuance.forecastContentDigestExec),
      normalizationVersionDigestHex: forecast.issuance.normalizationVersionDigestHex,
      k: forecast.issuance.package.kConfigDec,
      m: forecast.issuance.package.mConfigDec,
      distributionSemanticDigestHex: digestHex(forecast.issuance.distributionSemanticDigestExec),
      issuanceReceiptDigestHex: persisted.forecastIssuanceReceiptDigestHex,
      replicaSamples: forecast.issuance.samples,
    });
    const admission = persisted.scientificAdmission;
    const scientificAdmission = createScientificAdmissionAuthorityV1({
      sourceReceiptSchemaVersion: admission.schemaVersion,
      organizationId: admission.organizationId,
      wfPartition: "WF_PREDICTIVE",
      terminalStatus: "QUALIFIED",
      selectedPackageGenerationIdentityDigestHex:
        admission.selectedPackageGenerationIdentityDigest!,
      selectedPackageContentDigestHex: admission.selectedPackageContentDigest!,
      selectedKConfigDec: admission.selectedKConfigDec!,
      selectedMConfigDec: admission.selectedMConfigDec!,
      evidenceSemanticDigestHex: admission.evidenceSemanticDigest,
      sourceReceiptContentDigestHex: admission.contentDigest,
    });

    return {
      forecast: forecastEconomicAuthority,
      scientificAdmission,
      anchorAuthority: persisted.anchorAuthority,
      policy: persisted.executablePolicy,
      economicSizeSet: persisted.economicSizeSet,
      cashAuthority: persisted.cashAuthority,
      authorityVerification: {
        forecast: {
          schemaVersion: DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION,
          verified: true,
          purpose: "FORECAST_ISSUANCE",
          organizationId: input.organizationId,
          accountId: input.accountId,
          instrumentIdentityDigestHex: binding.instrumentIdentityDigestHex,
          subjectContentDigestHex: forecastEconomicAuthority.contentDigestHex,
          verificationReceiptDigestHex: persisted.forecastVerificationReceiptDigestHex,
        },
        scientificAdmission: {
          schemaVersion: DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION,
          verified: true,
          purpose: "SCIENTIFIC_ADMISSION",
          organizationId: input.organizationId,
          subjectContentDigestHex: scientificAdmission.contentDigestHex,
          verificationReceiptDigestHex: persisted.scientificVerificationReceiptDigestHex,
        },
        executionPayoff: persisted.executionPayoffVerification,
      },
    };
  };
}
