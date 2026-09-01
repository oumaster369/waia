import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import {
  buildForecastContractBindingV1,
  type ForecastContractBindingV1,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  serializeReplicaArtifactPayloadV1,
  type PredictivePackageV1,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  requireScientificAdmissionV2,
  type ScientificAdmissionExpectedBindingsV2,
  type ScientificAdmissionReceiptV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";

export const HISTORICAL_FORECAST_AUTHORITY_BOOTSTRAP_V2 =
  "waia.trader.historical_forecast_authority_bootstrap.v2" as const;

/**
 * Close the qualified scientific winner into the exact immutable Forecast V2 contract graph.
 * Every digest is derived from executable package bytes; callers cannot inject model identities.
 */
export function buildHistoricalForecastAuthorityBootstrapV2(input: Readonly<{
  organizationId: string;
  scientificAdmissionReceiptId: string;
  scientificAdmissionReceipt: ScientificAdmissionReceiptV2;
  scientificAdmissionExpectedBindings: ScientificAdmissionExpectedBindingsV2;
  predictivePackage: PredictivePackageV1;
}>): Readonly<{
  forecastContractBinding: ForecastContractBindingV1;
  artifactPayloadDigestHex: string;
}> {
  const scientific = requireScientificAdmissionV2(
    input.scientificAdmissionReceipt,
    input.scientificAdmissionExpectedBindings,
  );
  const pkg = input.predictivePackage;
  const packageContentDigestHex = digestHex(pkg.predictivePackageContentDigest);
  const runtimeContractDigestHex = digestHex(pkg.runtimeContractDigest);
  if (
    scientific.organizationId !== input.organizationId ||
    scientific.terminalStatus !== "ADMITTED" ||
    scientific.kmConvergenceReceipt.terminalStatus !== "QUALIFIED" ||
    scientific.kmConvergenceReceipt.selectedPackageContentDigestHex !==
      packageContentDigestHex ||
    input.scientificAdmissionExpectedBindings.predictivePackageContentDigestHex !==
      packageContentDigestHex ||
    input.scientificAdmissionExpectedBindings.developmentDatasetDigestHex !==
      pkg.family.developmentDatasetDigestHex ||
    input.scientificAdmissionExpectedBindings.runtimeContractDigestHex !==
      runtimeContractDigestHex
  ) {
    throw new Error("HISTORICAL_FORECAST_AUTHORITY_BOOTSTRAP_REFUSED:SCIENTIFIC_GRAPH");
  }

  const inputContract = buildForecastInputContractV2({
    measurementSemanticVersion: "realized-volatility-20m-from-1m/v2",
    hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
  });
  const modelSpec = buildForecastModelSpecV2({
    modelId: `${HISTORICAL_FORECAST_AUTHORITY_BOOTSTRAP_V2}:${pkg.family.symbol}:${pkg.family.primaryHorizonMinutes}m`,
    modelTransformVersion: pkg.family.modelTransformVersion,
    inputContractDigestHex: inputContract.contentDigestHex,
    terminalTargetDefinitionDigestHex: pkg.family.terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex:
      pkg.family.executionOpportunityTargetDefinitionDigestHex,
  });
  const artifactPayloadDigestHex = computeSemanticSha256Hex({
    schemaVersion: HISTORICAL_FORECAST_AUTHORITY_BOOTSTRAP_V2,
    predictivePackageContentDigestHex: packageContentDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      digestHex(pkg.predictivePackageGenerationIdentityDigest),
    replicaArtifactPayloads: pkg.replicaArtifacts.map((artifact) =>
      serializeReplicaArtifactPayloadV1({
        artifact,
        symbol: pkg.family.symbol,
        primaryHorizonMinutes: pkg.family.primaryHorizonMinutes,
      })),
  });
  const modelArtifact = buildForecastModelArtifactV2({
    modelSpecDigestHex: modelSpec.contentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    developmentDatasetDigestHex: pkg.family.developmentDatasetDigestHex,
    runtimeContractDigestHex,
    artifactPayloadDigestHex,
  });
  return Object.freeze({
    artifactPayloadDigestHex,
    forecastContractBinding: buildForecastContractBindingV1({
      organizationId: input.organizationId,
      scientificAdmissionReceiptId: input.scientificAdmissionReceiptId,
      scientificAdmissionReceiptContentDigestHex: scientific.contentDigestHex,
      selectedPredictivePackageContentDigestHex: packageContentDigestHex,
      inputContract,
      modelSpec,
      modelArtifact,
    }),
  });
}
