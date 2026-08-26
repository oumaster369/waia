import { createHash } from "node:crypto";

import type { MarketUnderstandingArtifactV1 } from "@/lib/trader/intelligence/market-understanding.types";
import { HYPOTHESIS_SET_SCHEMA_VERSION } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import type { MarketStateSnapshot } from "@/lib/trader/intelligence/mi-core.types";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const CAUSAL_INPUT_BUNDLE_SCHEMA_VERSION =
  "waia.trader.intelligence_cycle_causal_input_bundle.v2" as const;
export const HYPOTHESIS_CONSTRUCTION_POLICY_VERSION =
  "waia.trader.hypothesis_construction_policy.v1" as const;

export type CanonicalCycleCausalInputBundleV2 = Readonly<{
  schemaVersion: typeof CAUSAL_INPUT_BUNDLE_SCHEMA_VERSION;
  scope: Readonly<{
    organizationId: string;
    instrumentId: string;
    evaluatedAt: string;
  }>;
  reconstruction: Readonly<{
    schemaVersion: string;
    contentDigest: string;
  }>;
  understanding:
    | Readonly<{ status: "NOT_CAUSALLY_APPLICABLE" }>
    | Readonly<{
        status: "EXACT";
        schemaVersion: string;
        contentDigest: string;
        derivationDefinitionContentDigest: string;
        requiredInformationProfileId: string;
        requiredInformationProfileContentDigest: string;
        informationSufficiencyReceiptId: string;
        informationSufficiencyReceiptContentDigest: string;
        claimContentDigests: readonly string[];
        claimCausalLineageDigests: readonly string[];
        computationInputs: readonly Readonly<{ path: string; contentDigest: string }>[];
        consumedEvidence: readonly Readonly<{
          evidenceId: string;
          sourceId: string;
          observationId: string;
          observationSchemaVersion: string;
          observationContentDigest: string;
          trustAsOfReceiptId: string | null;
          trustRevisionId: string | null;
          trustRevisionContentDigest: string | null;
          measurementDefinitionId: string | null;
          measurementDefinitionContentDigest: string | null;
          measurementValueId: string | null;
          measurementValueContentDigest: string | null;
        }>[];
      }>;
  hypothesisConstruction: Readonly<{
    hypothesisSetSchemaVersion: typeof HYPOTHESIS_SET_SCHEMA_VERSION;
    policyVersion: typeof HYPOTHESIS_CONSTRUCTION_POLICY_VERSION;
    authority: "LEGACY_DIAGNOSTIC" | "CANONICAL_PIT_KNOWLEDGE" | "EMPTY";
    canonicalIntelligenceStateDigests: readonly string[];
    canonicalCausalLineageDigests: readonly string[];
  }>;
  policyProfiles: Readonly<{
    historicalProfileId: string;
    historicalProfileContentDigest: string;
    timeframeEvidenceAuthorityMatrixContentDigest: string;
  }>;
}>;

const HEX_64 = /^[0-9a-f]{64}$/;

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function requireDigest(value: string, field: string): string {
  if (!HEX_64.test(value)) throw new Error(`CAUSAL_INPUT_BUNDLE_INVALID:${field}`);
  return value;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function buildUnderstandingIdentity(
  artifact: MarketUnderstandingArtifactV1 | undefined,
  snapshot: MarketStateSnapshot,
  organizationId: string,
): CanonicalCycleCausalInputBundleV2["understanding"] {
  if (!artifact) return { status: "NOT_CAUSALLY_APPLICABLE" };
  if (
    artifact.scope.organizationId !== organizationId ||
    artifact.scope.symbol !== snapshot.instrumentId ||
    artifact.scope.pitAnchor !== snapshot.evaluatedAt ||
    artifact.evaluatedAt !== snapshot.evaluatedAt
  ) {
    throw new Error("CAUSAL_INPUT_BUNDLE_INVALID:understandingScope");
  }
  const computationInputs = [...new Map(
    artifact.claims
      .flatMap((claim) => claim.computationInputs)
      .map((item) => [`${item.path}:${item.contentDigest}`, item] as const),
  ).values()].sort((left, right) => compareText(left.path, right.path));
  const consumedEvidence = artifact.evidenceUsed
    .map((evidence) => ({
      evidenceId: evidence.evidenceId,
      sourceId: evidence.sourceId,
      observationId: evidence.observationId,
      observationSchemaVersion: evidence.observationSchemaVersion,
      observationContentDigest: evidence.observationContentDigest,
      trustAsOfReceiptId: evidence.trustAsOfReceiptId,
      trustRevisionId: evidence.trustRevisionId,
      trustRevisionContentDigest: evidence.trustRevisionContentDigest,
      measurementDefinitionId: evidence.measurementDefinitionId,
      measurementDefinitionContentDigest: evidence.measurementDefinitionContentDigest,
      measurementValueId: evidence.measurementValueId,
      measurementValueContentDigest: evidence.measurementValueContentDigest,
    }))
    .sort((left, right) => compareText(left.evidenceId, right.evidenceId));
  return {
    status: "EXACT",
    schemaVersion: artifact.schemaVersion,
    contentDigest: requireDigest(artifact.contentDigest, "understandingContentDigest"),
    derivationDefinitionContentDigest: requireDigest(
      artifact.derivationDefinition.contentDigest,
      "understandingDerivationDigest",
    ),
    requiredInformationProfileId: artifact.authenticatedProfile.id,
    requiredInformationProfileContentDigest: requireDigest(
      artifact.authenticatedProfile.contentDigest,
      "requiredInformationProfileDigest",
    ),
    informationSufficiencyReceiptId: artifact.authenticatedSufficiencyReceipt.id,
    informationSufficiencyReceiptContentDigest: requireDigest(
      artifact.authenticatedSufficiencyReceipt.contentDigest,
      "informationSufficiencyReceiptDigest",
    ),
    claimContentDigests: sortedUnique(
      artifact.claims.map((claim) => requireDigest(claim.contentDigest, "claimContentDigest")),
    ),
    claimCausalLineageDigests: sortedUnique(
      artifact.claims.map((claim) =>
        requireDigest(claim.causalLineageDigest, "claimCausalLineageDigest"),
      ),
    ),
    computationInputs,
    consumedEvidence,
  };
}

export function buildCanonicalCycleCausalInputBundleV2(input: {
  organizationId: string;
  snapshot: MarketStateSnapshot;
  understandingArtifact?: MarketUnderstandingArtifactV1;
  historicalProfileId: string;
  historicalProfileContentDigest: string;
  matrixContentDigest: string;
}): CanonicalCycleCausalInputBundleV2 {
  const hypotheses = input.snapshot.hypotheses.hypotheses;
  const authorities = sortedUnique(
    hypotheses.map((hypothesis) => hypothesis.authority ?? "LEGACY_DIAGNOSTIC"),
  );
  const authority: CanonicalCycleCausalInputBundleV2["hypothesisConstruction"]["authority"] = hypotheses.length === 0
    ? "EMPTY"
    : authorities.length === 1 && authorities[0] === "CANONICAL_PIT_KNOWLEDGE"
      ? "CANONICAL_PIT_KNOWLEDGE"
      : "LEGACY_DIAGNOSTIC";
  return Object.freeze({
    schemaVersion: CAUSAL_INPUT_BUNDLE_SCHEMA_VERSION,
    scope: {
      organizationId: input.organizationId,
      instrumentId: input.snapshot.instrumentId,
      evaluatedAt: input.snapshot.evaluatedAt,
    },
    reconstruction: {
      schemaVersion: input.snapshot.reconstruction.schemaVersion,
      contentDigest: requireDigest(
        input.snapshot.reconstruction.contentDigest,
        "reconstructionContentDigest",
      ),
    },
    understanding: buildUnderstandingIdentity(
      input.understandingArtifact,
      input.snapshot,
      input.organizationId,
    ),
    hypothesisConstruction: {
      hypothesisSetSchemaVersion: HYPOTHESIS_SET_SCHEMA_VERSION,
      policyVersion: HYPOTHESIS_CONSTRUCTION_POLICY_VERSION,
      authority,
      canonicalIntelligenceStateDigests: sortedUnique(
        hypotheses.flatMap((hypothesis) =>
          hypothesis.canonicalIntelligenceStateDigest
            ? [requireDigest(hypothesis.canonicalIntelligenceStateDigest, "intelligenceStateDigest")]
            : [],
        ),
      ),
      canonicalCausalLineageDigests: sortedUnique(
        hypotheses.flatMap((hypothesis) =>
          hypothesis.canonicalCausalLineageDigest
            ? [requireDigest(hypothesis.canonicalCausalLineageDigest, "causalLineageDigest")]
            : [],
        ),
      ),
    },
    policyProfiles: {
      historicalProfileId: input.historicalProfileId,
      historicalProfileContentDigest: requireDigest(
        input.historicalProfileContentDigest,
        "historicalProfileDigest",
      ),
      timeframeEvidenceAuthorityMatrixContentDigest: requireDigest(
        input.matrixContentDigest,
        "matrixDigest",
      ),
    },
  });
}

export function serializeCanonicalCycleCausalInputBundleV2(
  bundle: CanonicalCycleCausalInputBundleV2,
): string {
  return canonicalizeSemanticJsonString(bundle);
}

export function computeCanonicalCycleCausalInputDigestV2(
  bundle: CanonicalCycleCausalInputBundleV2,
): string {
  return createHash("sha256")
    .update(serializeCanonicalCycleCausalInputBundleV2(bundle), "utf8")
    .digest("hex");
}

export function parseCanonicalCycleCausalInputBundleV2(
  canonicalJson: string,
): CanonicalCycleCausalInputBundleV2 {
  const parsed = JSON.parse(canonicalJson) as CanonicalCycleCausalInputBundleV2;
  if (
    parsed.schemaVersion !== CAUSAL_INPUT_BUNDLE_SCHEMA_VERSION ||
    serializeCanonicalCycleCausalInputBundleV2(parsed) !== canonicalJson
  ) {
    throw new Error("CAUSAL_INPUT_BUNDLE_INVALID:canonicalIdentity");
  }
  return parsed;
}
