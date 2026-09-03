import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  computePredictivePackageGenerationIdentityDigest,
  computeReplicaRootFamilyIdentityDigest,
  digestHex,
  type ReplicaRootFamilyInput,
} from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { buildHistoricalForecastFamilyV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";

import {
  buildKmConvergenceReceiptV1,
  computeKmGlobalAnchorSetDigest,
  KM_ANCHORS_PER_SURFACE,
  KM_GRID_K,
  KM_GRID_M,
  type KmConvergenceReceipt,
} from "./km-convergence-gate-v1";

export type INTERNAL_ClosedKmFourSurfaceProductionAuthorityV2 = Readonly<{
  schemaVersion: "km-four-surface-production-authority/v2";
  evaluatorVersion: "km-four-surface-executable-evaluator/v2";
  releaseSha: string;
  organizationId: string;
  sourceQualificationReceiptDigestHex: string;
  runtimeRequalificationReceiptDigestHex: string | null;
  developmentDatasetIdentityDigestHex: string;
  durableDatasetAuthority: Readonly<{
    organizationId: string;
    runId: string;
    qualificationReceiptDigestHex: string;
    authorityRowCount: number;
    cycleIds: readonly string[];
    developmentSymbols: readonly ["BTCUSDT", "ETHUSDT"];
    developmentPartitionRawSha256Hex: Readonly<Record<"BTCUSDT" | "ETHUSDT", string>>;
    authoritySetContentDigestHex: string;
  }>;
  economics: Readonly<{
    notionalUsdt: number;
    costRate: number;
    slippageBufferUsdt: number;
    nRefUsdt: number;
  }>;
  contract: Readonly<{
    schemaVersion: "km-four-surface-contract/v2";
    organizationId: string;
    developmentDatasetDigestHex: string;
    developmentAuthorityContentDigestHex: string;
    surfaces: readonly Readonly<{
      surfaceKey: string;
      symbol: "BTCUSDT" | "ETHUSDT";
      primaryHorizonMinutes: 30 | 60;
      family: ReplicaRootFamilyInput;
      familyIdentityDigestHex: string;
      developmentCorpusContentDigestHex: string;
      selectedAnchorCount: typeof KM_ANCHORS_PER_SURFACE;
      surfaceAnchorSetDigestHex: string;
      globalAnchorSetDigestHex: string;
      replayEvidenceContentDigestHex: string;
      convergenceReceipt: KmConvergenceReceipt;
      contentDigestHex: string;
    }>[];
    globalAnchorSetDigestHex: string;
    contentDigestHex: string;
  }>;
  contentDigestHex: string;
}>;

export const SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2 =
  "scientific-admission-four-surface/v2" as const;
export const SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECEIPT_KIND_V2 =
  "WF_PREDICTIVE_FOUR_SURFACE" as const;

const DIGEST = /^[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_SURFACES = [
  { surfaceKey: "BTCUSDT:30", symbol: "BTCUSDT", primaryHorizonMinutes: 30 },
  { surfaceKey: "BTCUSDT:60", symbol: "BTCUSDT", primaryHorizonMinutes: 60 },
  { surfaceKey: "ETHUSDT:30", symbol: "ETHUSDT", primaryHorizonMinutes: 30 },
  { surfaceKey: "ETHUSDT:60", symbol: "ETHUSDT", primaryHorizonMinutes: 60 },
] as const;

export type ScientificAdmissionFourSurfaceBindingV2 = Readonly<{
  surfaceKey: string;
  familyIdentityDigestHex: string;
  convergenceEvidenceSemanticDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  predictivePackageContentDigestHex: string;
}>;

export type ScientificAdmissionFourSurfaceReceiptV2 = Readonly<{
  schemaVersion: typeof SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2;
  receiptKind: typeof SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECEIPT_KIND_V2;
  terminalStatus: "SCIENTIFICALLY_ADMITTED";
  organizationId: string;
  releaseSha: string;
  runId: string;
  developmentDatasetIdentityDigestHex: string;
  sourceQualificationReceiptDigestHex: string;
  durableDatasetAuthoritySetContentDigestHex: string;
  sourceFourSurfaceAuthorityContentDigestHex: string;
  kmGlobalAnchorSetDigestHex: string;
  aggregateFamilySetDigestHex: string;
  alphaEpiConfigScale8: string;
  surfaceBindings: readonly ScientificAdmissionFourSurfaceBindingV2[];
  authorityBoundary: Readonly<{
    capitalAuthority: "NONE";
    liveTradingAuthority: "NONE";
    blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED";
    humanRatificationAuthority: "NOT_CLAIMED_BY_THIS_RECEIPT";
  }>;
  sourceAuthority: INTERNAL_ClosedKmFourSurfaceProductionAuthorityV2;
  evidenceSemanticDigestHex: string;
  contentDigestHex: string;
}>;

export type ScientificAdmissionFourSurfaceExpectedV2 = Readonly<{
  organizationId: string;
  releaseSha: string;
  runId: string;
  developmentDatasetIdentityDigestHex: string;
  sourceQualificationReceiptDigestHex: string;
  sourceFourSurfaceAuthorityContentDigestHex: string;
  evidenceSemanticDigestHex: string;
}>;

function refuse(code: string): never {
  throw new Error(`SCIENTIFIC_ADMISSION_FOUR_SURFACE_REFUSED:${code}`);
}

function requireDigest(value: string, code: string): void {
  if (!DIGEST.test(value)) refuse(code);
}

function requireExactDigest(value: unknown, code: string): void {
  if (typeof value !== "string") refuse(code);
  requireDigest(value, code);
}

function withoutContentDigest<T extends { contentDigestHex: string }>(value: T): Omit<T, "contentDigestHex"> {
  const body: Partial<T> = { ...value };
  delete body.contentDigestHex;
  return body as Omit<T, "contentDigestHex">;
}

function validateSourceAuthority(authority: INTERNAL_ClosedKmFourSurfaceProductionAuthorityV2): void {
  if (
    authority.schemaVersion !== "km-four-surface-production-authority/v2" ||
    authority.evaluatorVersion !== "km-four-surface-executable-evaluator/v2" ||
    !UUID.test(authority.organizationId) ||
    !SHA.test(authority.releaseSha) ||
    !authority.durableDatasetAuthority.runId.trim()
  ) {
    refuse("SOURCE_ENVELOPE");
  }
  const durable = authority.durableDatasetAuthority;
  const contract = authority.contract;
  if (
    contract.schemaVersion !== "km-four-surface-contract/v2" ||
    !Number.isFinite(authority.economics.notionalUsdt) ||
    authority.economics.notionalUsdt <= 0 ||
    !Number.isFinite(authority.economics.costRate) || authority.economics.costRate < 0 ||
    !Number.isFinite(authority.economics.slippageBufferUsdt) ||
    authority.economics.slippageBufferUsdt < 0 ||
    !Number.isFinite(authority.economics.nRefUsdt) || authority.economics.nRefUsdt <= 0
  ) refuse("SOURCE_SEMANTICS");
  for (const [value, code] of [
    [authority.sourceQualificationReceiptDigestHex, "SOURCE_QUALIFICATION_DIGEST"],
    [authority.developmentDatasetIdentityDigestHex, "SOURCE_DATASET_DIGEST"],
    [durable.qualificationReceiptDigestHex, "DURABLE_QUALIFICATION_DIGEST"],
    [durable.authoritySetContentDigestHex, "DURABLE_SET_DIGEST"],
    [contract.developmentDatasetDigestHex, "CONTRACT_DATASET_DIGEST"],
    [contract.developmentAuthorityContentDigestHex, "DEVELOPMENT_AUTHORITY_DIGEST"],
    [contract.globalAnchorSetDigestHex, "GLOBAL_ANCHOR_DIGEST"],
    [contract.contentDigestHex, "CONTRACT_CONTENT_DIGEST"],
    [authority.contentDigestHex, "SOURCE_CONTENT_DIGEST"],
  ] as const) requireExactDigest(value, code);
  if (
    authority.runtimeRequalificationReceiptDigestHex !== null &&
    !DIGEST.test(authority.runtimeRequalificationReceiptDigestHex)
  ) refuse("RUNTIME_REQUALIFICATION_DIGEST");
  if (
    durable.organizationId !== authority.organizationId ||
    contract.organizationId !== authority.organizationId ||
    durable.qualificationReceiptDigestHex !== authority.sourceQualificationReceiptDigestHex ||
    contract.developmentDatasetDigestHex !== authority.developmentDatasetIdentityDigestHex ||
    durable.authorityRowCount !== durable.cycleIds.length ||
    durable.cycleIds.length === 0 ||
    new Set(durable.cycleIds).size !== durable.cycleIds.length ||
    canonicalizeSemanticJsonString(durable.developmentSymbols) !==
      canonicalizeSemanticJsonString(["BTCUSDT", "ETHUSDT"]) ||
    durable.cycleIds.some((cycleId) =>
      !cycleId.startsWith(`${durable.runId}:DEVELOPMENT:BTCUSDT:`) &&
      !cycleId.startsWith(`${durable.runId}:DEVELOPMENT:ETHUSDT:`)) ||
    !durable.cycleIds.some((cycleId) =>
      cycleId.startsWith(`${durable.runId}:DEVELOPMENT:BTCUSDT:`)) ||
    !durable.cycleIds.some((cycleId) =>
      cycleId.startsWith(`${durable.runId}:DEVELOPMENT:ETHUSDT:`))
  ) refuse("DURABLE_SCOPE_BINDING");
  requireDigest(durable.developmentPartitionRawSha256Hex.BTCUSDT, "DURABLE_BTC_DIGEST");
  requireDigest(durable.developmentPartitionRawSha256Hex.ETHUSDT, "DURABLE_ETH_DIGEST");
  if (computeSemanticSha256Hex(withoutContentDigest(authority)) !== authority.contentDigestHex) {
    refuse("SOURCE_CONTENT");
  }
  if (computeSemanticSha256Hex(withoutContentDigest(contract)) !== contract.contentDigestHex) {
    refuse("CONTRACT_CONTENT");
  }
  if (contract.surfaces.length !== EXPECTED_SURFACES.length) refuse("MISSING_SURFACE");

  const familyDigests = new Set<string>();
  const evidenceDigests = new Set<string>();
  const packageDigests = new Set<string>();
  const surfaceAnchorDigests: Buffer[] = [];
  for (let index = 0; index < EXPECTED_SURFACES.length; index += 1) {
    const expected = EXPECTED_SURFACES[index]!;
    const surface = contract.surfaces[index]!;
    if (
      surface.surfaceKey !== expected.surfaceKey ||
      surface.symbol !== expected.symbol ||
      surface.primaryHorizonMinutes !== expected.primaryHorizonMinutes ||
      surface.family.symbol !== expected.symbol ||
      surface.family.primaryHorizonMinutes !== expected.primaryHorizonMinutes ||
      surface.family.executionHorizonMinutes !== expected.primaryHorizonMinutes + 3 ||
      surface.family.organizationId !== authority.organizationId ||
      surface.family.codeReleaseSha !== authority.releaseSha ||
      surface.family.developmentDatasetDigestHex !== authority.developmentDatasetIdentityDigestHex ||
      surface.selectedAnchorCount !== KM_ANCHORS_PER_SURFACE ||
      surface.globalAnchorSetDigestHex !== contract.globalAnchorSetDigestHex
    ) refuse("SURFACE_BINDING");
    for (const [value, code] of [
      [surface.familyIdentityDigestHex, "FAMILY_DIGEST"],
      [surface.developmentCorpusContentDigestHex, "CORPUS_DIGEST"],
      [surface.surfaceAnchorSetDigestHex, "SURFACE_ANCHOR_DIGEST"],
      [surface.replayEvidenceContentDigestHex, "REPLAY_EVIDENCE_DIGEST"],
      [surface.contentDigestHex, "SURFACE_CONTENT_DIGEST"],
    ] as const) requireExactDigest(value, code);
    const expectedFamilyDigest = digestHex(computeReplicaRootFamilyIdentityDigest(surface.family));
    const expectedFamily = buildHistoricalForecastFamilyV2({
      organizationId: authority.organizationId,
      symbol: expected.symbol,
      primaryHorizonMinutes: expected.primaryHorizonMinutes,
      developmentDatasetDigestHex: authority.developmentDatasetIdentityDigestHex,
      releaseSha: authority.releaseSha,
    });
    if (
      expectedFamilyDigest !== surface.familyIdentityDigestHex ||
      canonicalizeSemanticJsonString(expectedFamily) !==
        canonicalizeSemanticJsonString(surface.family)
    ) refuse("FAMILY_IDENTITY");
    if (computeSemanticSha256Hex(withoutContentDigest(surface)) !== surface.contentDigestHex) {
      refuse("SURFACE_CONTENT");
    }
    const convergence = surface.convergenceReceipt;
    const rebuiltConvergence = buildKmConvergenceReceiptV1({
      replicaRootFamilyIdentityDigestHex: convergence.replicaRootFamilyIdentityDigestHex,
      kmGlobalAnchorSetDigestHex: convergence.kmGlobalAnchorSetDigestHex,
      candidateGenerationDigestsHex: convergence.candidateGenerationDigestsHex,
      configurations: convergence.configurations,
      selectedPackageGenerationIdentityDigestHex:
        convergence.selectedPackageGenerationIdentityDigestHex,
      selectedPackageContentDigestHex: convergence.selectedPackageContentDigestHex,
      alphaEpiConfigScale8: convergence.alphaEpiConfigScale8,
    });
    if (
      canonicalizeSemanticJsonString(rebuiltConvergence) !==
        canonicalizeSemanticJsonString(convergence) ||
      convergence.terminalStatus !== "QUALIFIED" ||
      convergence.replicaRootFamilyIdentityDigestHex !== surface.familyIdentityDigestHex ||
      convergence.kmGlobalAnchorSetDigestHex !== contract.globalAnchorSetDigestHex ||
      convergence.selectedK === null || convergence.selectedM === null ||
      convergence.selectedPackageGenerationIdentityDigestHex === null ||
      convergence.selectedPackageContentDigestHex === null
    ) refuse("CONVERGENCE_RECEIPT");
    const expectedCandidates = KM_GRID_K.flatMap((kConfig) =>
      KM_GRID_M.map((mConfig) => digestHex(computePredictivePackageGenerationIdentityDigest({
        replicaRootFamilyIdentityDigestHex: surface.familyIdentityDigestHex,
        kConfigDec: kConfig,
        mConfigDec: mConfig,
        alphaEpiConfigScale8: convergence.alphaEpiConfigScale8,
      }))),
    );
    if (
      canonicalizeSemanticJsonString(expectedCandidates) !==
        canonicalizeSemanticJsonString(convergence.candidateGenerationDigestsHex) ||
      digestHex(computePredictivePackageGenerationIdentityDigest({
        replicaRootFamilyIdentityDigestHex: surface.familyIdentityDigestHex,
        kConfigDec: convergence.selectedK,
        mConfigDec: convergence.selectedM,
        alphaEpiConfigScale8: convergence.alphaEpiConfigScale8,
      })) !== convergence.selectedPackageGenerationIdentityDigestHex
    ) refuse("PACKAGE_GENERATION_BINDING");
    requireDigest(convergence.selectedPackageContentDigestHex, "PACKAGE_CONTENT_DIGEST");
    if (
      familyDigests.has(surface.familyIdentityDigestHex) ||
      evidenceDigests.has(convergence.evidenceSemanticDigestHex) ||
      packageDigests.has(convergence.selectedPackageContentDigestHex)
    ) refuse("DUPLICATE_SURFACE_IDENTITY");
    familyDigests.add(surface.familyIdentityDigestHex);
    evidenceDigests.add(convergence.evidenceSemanticDigestHex);
    packageDigests.add(convergence.selectedPackageContentDigestHex);
    surfaceAnchorDigests.push(Buffer.from(surface.surfaceAnchorSetDigestHex, "hex"));
  }
  const expectedGlobal = computeKmGlobalAnchorSetDigest(surfaceAnchorDigests).toString("hex");
  if (expectedGlobal !== contract.globalAnchorSetDigestHex) refuse("GLOBAL_ANCHOR_SET");
}

export function INTERNAL_computeScientificAdmissionFourSurfaceEvidenceDigestV2(input: Readonly<{
  organizationId: string;
  releaseSha: string;
  runId: string;
  sourceFourSurfaceAuthorityContentDigestHex: string;
}>): string {
  return computeSemanticSha256Hex({
    schemaVersion: SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2,
    organizationId: input.organizationId,
    releaseSha: input.releaseSha,
    runId: input.runId,
    sourceFourSurfaceAuthorityContentDigestHex: input.sourceFourSurfaceAuthorityContentDigestHex,
  });
}

export function INTERNAL_buildScientificAdmissionFourSurfaceV2(
  sourceAuthority: INTERNAL_ClosedKmFourSurfaceProductionAuthorityV2,
): ScientificAdmissionFourSurfaceReceiptV2 {
  validateSourceAuthority(sourceAuthority);
  const surfaceBindings = sourceAuthority.contract.surfaces.map((surface) => Object.freeze({
    surfaceKey: surface.surfaceKey,
    familyIdentityDigestHex: surface.familyIdentityDigestHex,
    convergenceEvidenceSemanticDigestHex: surface.convergenceReceipt.evidenceSemanticDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      surface.convergenceReceipt.selectedPackageGenerationIdentityDigestHex!,
    predictivePackageContentDigestHex:
      surface.convergenceReceipt.selectedPackageContentDigestHex!,
  }));
  const aggregateFamilySetDigestHex = computeSemanticSha256Hex({
    schemaVersion: "scientific-admission-family-set/v2",
    families: surfaceBindings.map((binding) => ({
      surfaceKey: binding.surfaceKey,
      familyIdentityDigestHex: binding.familyIdentityDigestHex,
    })),
  });
  const evidenceSemanticDigestHex = INTERNAL_computeScientificAdmissionFourSurfaceEvidenceDigestV2({
    organizationId: sourceAuthority.organizationId,
    releaseSha: sourceAuthority.releaseSha,
    runId: sourceAuthority.durableDatasetAuthority.runId,
    sourceFourSurfaceAuthorityContentDigestHex: sourceAuthority.contentDigestHex,
  });
  const body = {
    schemaVersion: SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2,
    receiptKind: SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECEIPT_KIND_V2,
    terminalStatus: "SCIENTIFICALLY_ADMITTED" as const,
    organizationId: sourceAuthority.organizationId,
    releaseSha: sourceAuthority.releaseSha,
    runId: sourceAuthority.durableDatasetAuthority.runId,
    developmentDatasetIdentityDigestHex: sourceAuthority.developmentDatasetIdentityDigestHex,
    sourceQualificationReceiptDigestHex: sourceAuthority.sourceQualificationReceiptDigestHex,
    durableDatasetAuthoritySetContentDigestHex:
      sourceAuthority.durableDatasetAuthority.authoritySetContentDigestHex,
    sourceFourSurfaceAuthorityContentDigestHex: sourceAuthority.contentDigestHex,
    kmGlobalAnchorSetDigestHex: sourceAuthority.contract.globalAnchorSetDigestHex,
    aggregateFamilySetDigestHex,
    alphaEpiConfigScale8:
      sourceAuthority.contract.surfaces[0]!.convergenceReceipt.alphaEpiConfigScale8,
    surfaceBindings: Object.freeze(surfaceBindings),
    authorityBoundary: Object.freeze({
      capitalAuthority: "NONE" as const,
      liveTradingAuthority: "NONE" as const,
      blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED" as const,
      humanRatificationAuthority: "NOT_CLAIMED_BY_THIS_RECEIPT" as const,
    }),
    sourceAuthority,
    evidenceSemanticDigestHex,
  };
  const alphaSet = new Set(
    sourceAuthority.contract.surfaces.map(
      (surface) => surface.convergenceReceipt.alphaEpiConfigScale8,
    ),
  );
  if (alphaSet.size !== 1) refuse("ALPHA_COHORT");
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function INTERNAL_requireScientificAdmissionFourSurfaceV2(
  receipt: ScientificAdmissionFourSurfaceReceiptV2,
  expected: ScientificAdmissionFourSurfaceExpectedV2,
): ScientificAdmissionFourSurfaceReceiptV2 {
  const rebuilt = INTERNAL_buildScientificAdmissionFourSurfaceV2(receipt.sourceAuthority);
  if (
    canonicalizeSemanticJsonString(rebuilt) !== canonicalizeSemanticJsonString(receipt) ||
    rebuilt.organizationId !== expected.organizationId ||
    rebuilt.releaseSha !== expected.releaseSha ||
    rebuilt.runId !== expected.runId ||
    rebuilt.developmentDatasetIdentityDigestHex !== expected.developmentDatasetIdentityDigestHex ||
    rebuilt.sourceQualificationReceiptDigestHex !== expected.sourceQualificationReceiptDigestHex ||
    rebuilt.sourceFourSurfaceAuthorityContentDigestHex !==
      expected.sourceFourSurfaceAuthorityContentDigestHex ||
    rebuilt.evidenceSemanticDigestHex !== expected.evidenceSemanticDigestHex
  ) refuse("EXPECTED_BINDING");
  return rebuilt;
}
