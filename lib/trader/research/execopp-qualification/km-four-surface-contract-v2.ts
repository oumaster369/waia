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
import {
  buildPredictivePackageV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { canonicalizeSourceCorpusV1 } from
  "@/lib/trader/intelligence/forecast-v2/source-corpus-canonical-v1";

import {
  buildKmConvergenceReceiptV1,
  computeKmGlobalAnchorSetDigest,
  computeKmSurfaceAnchorSetDigest,
  evaluateKmConfigurationV1,
  KM_ANCHORS_PER_SURFACE,
  KM_GRID_K,
  KM_GRID_M,
  relativeErrorV1,
  selectKmAnchorsV1,
  selectKmWinnerV1,
  type KmConfigurationMetrics,
  type KmConvergenceReceipt,
  type KmEligibleAnchor,
} from "./km-convergence-gate-v1";

export const KM_FOUR_SURFACE_CONTRACT_V2 = "km-four-surface-contract/v2" as const;
export const KM_FOUR_SURFACE_DEVELOPMENT_AUTHORITY_V2 =
  "km-four-surface-development-authority/v2" as const;
export const KM_SURFACE_REPLAY_EVIDENCE_V2 = "km-surface-replay-evidence/v2" as const;

export type KmCanonicalSurfaceV2 = Readonly<{
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
}>;

export type KmReplayMetricV2 = Readonly<{
  evLower: number;
  evBase: number;
  evUpper: number;
  mcEs: number;
}>;

export type KmReplayCellEvidenceV2 = Readonly<{
  kConfig: number;
  mConfig: number;
  candidate: KmReplayMetricV2;
}>;

export type KmAnchorReplayEvidenceV2 = Readonly<{
  anchorEpochMin: number;
  reference: KmReplayMetricV2;
  cells: readonly KmReplayCellEvidenceV2[];
}>;

export type KmCanonicalSurfaceInputV2 = Readonly<{
  family: ReplicaRootFamilyInput;
  developmentCorpus: readonly SourceAnchor[];
  replayEvidence: readonly KmAnchorReplayEvidenceV2[];
  replayEvidenceContentDigestHex: string;
  convergenceReceipt: KmConvergenceReceipt;
}>;

export type KmDevelopmentCorpusSurfaceInputV2 = Readonly<{
  family: ReplicaRootFamilyInput;
  developmentCorpus: readonly SourceAnchor[];
}>;

export type KmFourSurfaceDevelopmentAuthorityV2 = Readonly<{
  schemaVersion: typeof KM_FOUR_SURFACE_DEVELOPMENT_AUTHORITY_V2;
  organizationId: string;
  datasetAuthorityIdentityDigestHex: string;
  surfaceCorpora: readonly Readonly<{
    surfaceKey: string;
    anchorCount: number;
    firstAnchorEpochMs: number;
    lastAnchorEpochMs: number;
    corpusContentDigestHex: string;
  }>[];
  contentDigestHex: string;
}>;

export type KmCanonicalSurfaceBindingV2 = Readonly<{
  surfaceKey: string;
  symbol: KmCanonicalSurfaceV2["symbol"];
  primaryHorizonMinutes: KmCanonicalSurfaceV2["primaryHorizonMinutes"];
  family: ReplicaRootFamilyInput;
  familyIdentityDigestHex: string;
  developmentCorpusContentDigestHex: string;
  selectedAnchorCount: typeof KM_ANCHORS_PER_SURFACE;
  surfaceAnchorSetDigestHex: string;
  globalAnchorSetDigestHex: string;
  replayEvidenceContentDigestHex: string;
  convergenceReceipt: KmConvergenceReceipt;
  contentDigestHex: string;
}>;

export type KmFourSurfaceContractV2 = Readonly<{
  schemaVersion: typeof KM_FOUR_SURFACE_CONTRACT_V2;
  organizationId: string;
  developmentDatasetDigestHex: string;
  developmentAuthorityContentDigestHex: string;
  surfaces: readonly KmCanonicalSurfaceBindingV2[];
  globalAnchorSetDigestHex: string;
  contentDigestHex: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;
const EXPECTED_SURFACES = Object.freeze([
  Object.freeze({ symbol: "BTCUSDT" as const, primaryHorizonMinutes: 30 as const }),
  Object.freeze({ symbol: "BTCUSDT" as const, primaryHorizonMinutes: 60 as const }),
  Object.freeze({ symbol: "ETHUSDT" as const, primaryHorizonMinutes: 30 as const }),
  Object.freeze({ symbol: "ETHUSDT" as const, primaryHorizonMinutes: 60 as const }),
]);
const GRID = Object.freeze(
  KM_GRID_K.flatMap((kConfig) =>
    KM_GRID_M.map((mConfig) => Object.freeze({ kConfig, mConfig })),
  ),
);

function surfaceKey(input: KmCanonicalSurfaceV2): string {
  return `${input.symbol}:${input.primaryHorizonMinutes}`;
}

function exactSurface(family: ReplicaRootFamilyInput): KmCanonicalSurfaceV2 {
  const expected = EXPECTED_SURFACES.find(
    (surface) =>
      surface.symbol === family.symbol &&
      surface.primaryHorizonMinutes === family.primaryHorizonMinutes,
  );
  if (
    !expected ||
    family.venue !== "htx" ||
    family.market !== "spot" ||
    family.executionHorizonMinutes !== expected.primaryHorizonMinutes + 3
  ) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:FAMILY_SURFACE");
  }
  return expected;
}

function canonicalCorpus(input: KmDevelopmentCorpusSurfaceInputV2): readonly SourceAnchor[] {
  const surface = exactSurface(input.family);
  const corpus = canonicalizeSourceCorpusV1(input.developmentCorpus);
  if (
    corpus.length < KM_ANCHORS_PER_SURFACE ||
    canonicalizeSemanticJsonString(corpus) !==
      canonicalizeSemanticJsonString(input.developmentCorpus) ||
    corpus.some(
      (anchor) =>
        anchor.venue !== "htx" ||
        anchor.market !== "spot" ||
        anchor.symbol !== surface.symbol ||
        !Number.isSafeInteger(anchor.closedBarEpochMs) ||
        anchor.closedBarEpochMs < 0 ||
        anchor.closedBarEpochMs % 60_000 !== 0,
    )
  ) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:NON_CANONICAL_DEVELOPMENT_CORPUS");
  }
  return Object.freeze(corpus.map((anchor) => Object.freeze({ ...anchor })));
}

function orderFourSurfaces<T extends { family: ReplicaRootFamilyInput }>(
  inputs: readonly T[],
): readonly T[] {
  if (inputs.length !== EXPECTED_SURFACES.length) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:MISSING_SURFACE");
  }
  const byKey = new Map<string, T>();
  for (const input of inputs) {
    const key = `${input.family.symbol}:${input.family.primaryHorizonMinutes}`;
    if (byKey.has(key)) {
      throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:DUPLICATE_SURFACE");
    }
    byKey.set(key, input);
  }
  return EXPECTED_SURFACES.map((expected) => {
    const input = byKey.get(surfaceKey(expected));
    if (!input) throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:MISSING_SURFACE");
    return input;
  });
}

function assertFamilyCohort(
  inputs: readonly { family: ReplicaRootFamilyInput }[],
  authority: Pick<KmFourSurfaceDevelopmentAuthorityV2,
    "organizationId" | "datasetAuthorityIdentityDigestHex">,
): void {
  const first = inputs[0]!.family;
  if (
    !DIGEST.test(authority.datasetAuthorityIdentityDigestHex) ||
    first.organizationId !== authority.organizationId ||
    inputs.some(
      ({ family }) =>
        family.organizationId !== authority.organizationId ||
        family.developmentDatasetDigestHex !== authority.datasetAuthorityIdentityDigestHex ||
        family.normalizationVersionDigestHex !== first.normalizationVersionDigestHex ||
        family.modelTransformVersion !== first.modelTransformVersion ||
        family.featureVersion !== first.featureVersion ||
        family.packageSubjectVersion !== first.packageSubjectVersion ||
        family.codeReleaseSha !== first.codeReleaseSha,
    )
  ) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:FAMILY_COHORT_MISMATCH");
  }
}

export function buildKmFourSurfaceDevelopmentAuthorityV2(input: Readonly<{
  organizationId: string;
  datasetAuthorityIdentityDigestHex: string;
  surfaces: readonly KmDevelopmentCorpusSurfaceInputV2[];
}>): KmFourSurfaceDevelopmentAuthorityV2 {
  const ordered = orderFourSurfaces(input.surfaces);
  assertFamilyCohort(ordered, input);
  const surfaceCorpora = ordered.map((surfaceInput) => {
    const surface = exactSurface(surfaceInput.family);
    const corpus = canonicalCorpus(surfaceInput);
    return Object.freeze({
      surfaceKey: surfaceKey(surface),
      anchorCount: corpus.length,
      firstAnchorEpochMs: corpus[0]!.closedBarEpochMs,
      lastAnchorEpochMs: corpus.at(-1)!.closedBarEpochMs,
      corpusContentDigestHex: computeSemanticSha256Hex({
        schemaVersion: "km-development-corpus/v2",
        organizationId: input.organizationId,
        datasetAuthorityIdentityDigestHex: input.datasetAuthorityIdentityDigestHex,
        surface,
        corpus,
      }),
    });
  });
  const body = {
    schemaVersion: KM_FOUR_SURFACE_DEVELOPMENT_AUTHORITY_V2,
    organizationId: input.organizationId,
    datasetAuthorityIdentityDigestHex: input.datasetAuthorityIdentityDigestHex,
    surfaceCorpora,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

type PreparedSurface = Readonly<{
  input: KmCanonicalSurfaceInputV2;
  surface: KmCanonicalSurfaceV2;
  family: ReplicaRootFamilyInput;
  familyIdentityDigestHex: string;
  corpus: readonly SourceAnchor[];
  corpusContentDigestHex: string;
  selectedAnchors: readonly KmEligibleAnchor[];
  surfaceAnchorSetDigestHex: string;
}>;

function prepareSurface(
  input: KmCanonicalSurfaceInputV2,
  authoritySurface: KmFourSurfaceDevelopmentAuthorityV2["surfaceCorpora"][number],
): PreparedSurface {
  const family = Object.freeze({ ...input.family });
  const surface = exactSurface(family);
  const corpus = canonicalCorpus({ family, developmentCorpus: input.developmentCorpus });
  const eligibleAnchors = corpus.map((anchor) => ({
    symbol: surface.symbol,
    primaryHorizonMinutes: surface.primaryHorizonMinutes,
    anchorEpochMin: anchor.closedBarEpochMs / 60_000,
  }));
  const developmentDatasetDigestRaw32 = Buffer.from(family.developmentDatasetDigestHex, "hex");
  const selectedAnchors = selectKmAnchorsV1({
    developmentDatasetDigestRaw32,
    symbol: surface.symbol,
    primaryHorizonMinutes: surface.primaryHorizonMinutes,
    eligibleAnchors,
  });
  const surfaceAnchorSetDigestHex = computeKmSurfaceAnchorSetDigest({
    developmentDatasetDigestRaw32,
    symbol: surface.symbol,
    primaryHorizonMinutes: surface.primaryHorizonMinutes,
    anchors: selectedAnchors,
  }).toString("hex");
  if (authoritySurface.surfaceKey !== surfaceKey(surface)) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:DEVELOPMENT_AUTHORITY_SURFACE");
  }
  return Object.freeze({
    input,
    surface,
    family,
    familyIdentityDigestHex: digestHex(computeReplicaRootFamilyIdentityDigest(family)),
    corpus,
    corpusContentDigestHex: authoritySurface.corpusContentDigestHex,
    selectedAnchors,
    surfaceAnchorSetDigestHex,
  });
}

function requireFiniteMetric(metric: KmReplayMetricV2): void {
  if (![metric.evLower, metric.evBase, metric.evUpper, metric.mcEs].every(Number.isFinite)) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_METRIC");
  }
}

function recomputeReplayConfigurations(input: Readonly<{
  selectedAnchors: readonly KmEligibleAnchor[];
  replayEvidence: readonly KmAnchorReplayEvidenceV2[];
}>): Readonly<{
  configurations: readonly KmConfigurationMetrics[];
  canonicalEvidence: readonly KmAnchorReplayEvidenceV2[];
}> {
  if (input.replayEvidence.length !== KM_ANCHORS_PER_SURFACE) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_ANCHOR_COUNT");
  }
  const byEpoch = new Map<number, KmAnchorReplayEvidenceV2>();
  for (const evidence of input.replayEvidence) {
    if (!Number.isSafeInteger(evidence.anchorEpochMin) || byEpoch.has(evidence.anchorEpochMin)) {
      throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_ANCHOR_DUPLICATE");
    }
    byEpoch.set(evidence.anchorEpochMin, evidence);
  }
  const canonicalEvidence = input.selectedAnchors.map((anchor) => {
    const evidence = byEpoch.get(anchor.anchorEpochMin);
    if (!evidence) throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_ANCHOR_SET");
    requireFiniteMetric(evidence.reference);
    const cells = new Map<string, KmReplayCellEvidenceV2>();
    for (const cell of evidence.cells) {
      const key = `${cell.kConfig}:${cell.mConfig}`;
      if (cells.has(key)) throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_CELL_DUPLICATE");
      requireFiniteMetric(cell.candidate);
      cells.set(key, cell);
    }
    const canonicalCells = GRID.map((grid) => {
      const cell = cells.get(`${grid.kConfig}:${grid.mConfig}`);
      if (!cell) throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_CELL_SET");
      return Object.freeze({
        kConfig: grid.kConfig,
        mConfig: grid.mConfig,
        candidate: Object.freeze({ ...cell.candidate }),
      });
    });
    if (cells.size !== GRID.length) {
      throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_CELL_SET");
    }
    return Object.freeze({
      anchorEpochMin: anchor.anchorEpochMin,
      reference: Object.freeze({ ...evidence.reference }),
      cells: Object.freeze(canonicalCells),
    });
  });
  if (byEpoch.size !== input.selectedAnchors.length) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_ANCHOR_SET");
  }
  const configurations = GRID.map((grid, cellIndex) =>
    evaluateKmConfigurationV1({
      kConfig: grid.kConfig,
      mConfig: grid.mConfig,
      perAnchorEvLowerErrors: canonicalEvidence.map((evidence) =>
        relativeErrorV1(evidence.cells[cellIndex]!.candidate.evLower, evidence.reference.evLower),
      ),
      perAnchorEvBaseErrors: canonicalEvidence.map((evidence) =>
        relativeErrorV1(evidence.cells[cellIndex]!.candidate.evBase, evidence.reference.evBase),
      ),
      perAnchorEvUpperErrors: canonicalEvidence.map((evidence) =>
        relativeErrorV1(evidence.cells[cellIndex]!.candidate.evUpper, evidence.reference.evUpper),
      ),
      perAnchorMcEsErrors: canonicalEvidence.map((evidence) =>
        relativeErrorV1(evidence.cells[cellIndex]!.candidate.mcEs, evidence.reference.mcEs),
      ),
    }),
  );
  return Object.freeze({
    configurations: Object.freeze(configurations),
    canonicalEvidence: Object.freeze(canonicalEvidence),
  });
}

export function buildKmSurfaceConvergenceReceiptFromReplayV2(input: Readonly<{
  family: ReplicaRootFamilyInput;
  developmentCorpus: readonly SourceAnchor[];
  selectedAnchors: readonly KmEligibleAnchor[];
  replayEvidence: readonly KmAnchorReplayEvidenceV2[];
  globalAnchorSetDigestHex: string;
  alphaEpiConfigScale8?: string;
}>): Readonly<{ receipt: KmConvergenceReceipt; replayEvidenceContentDigestHex: string }> {
  if (!DIGEST.test(input.globalAnchorSetDigestHex)) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:GLOBAL_ANCHOR_DIGEST");
  }
  const familyIdentityDigestHex = digestHex(computeReplicaRootFamilyIdentityDigest(input.family));
  const replay = recomputeReplayConfigurations(input);
  const winner = selectKmWinnerV1(replay.configurations);
  if (!winner) throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:NO_SURFACE_WINNER");
  const alphaEpiConfigScale8 = input.alphaEpiConfigScale8 ?? "0.10000000";
  const candidateGenerationDigestsHex = GRID.map((grid) =>
    digestHex(
      computePredictivePackageGenerationIdentityDigest({
        replicaRootFamilyIdentityDigestHex: familyIdentityDigestHex,
        kConfigDec: grid.kConfig,
        mConfigDec: grid.mConfig,
        alphaEpiConfigScale8,
      }),
    ),
  );
  const selectedPackage = buildPredictivePackageV1({
    family: input.family,
    sourceCorpus: input.developmentCorpus,
    kConfigDec: winner.kConfig,
    mConfigDec: winner.mConfig,
  });
  const selectedGenerationIdentityDigestHex = digestHex(
    selectedPackage.predictivePackageGenerationIdentityDigest,
  );
  const winnerIndex = GRID.findIndex(
    (grid) => grid.kConfig === winner.kConfig && grid.mConfig === winner.mConfig,
  );
  if (candidateGenerationDigestsHex[winnerIndex] !== selectedGenerationIdentityDigestHex) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:SELECTED_PACKAGE_GENERATION");
  }
  const receipt = buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: familyIdentityDigestHex,
    kmGlobalAnchorSetDigestHex: input.globalAnchorSetDigestHex,
    candidateGenerationDigestsHex,
    configurations: replay.configurations,
    selectedPackageGenerationIdentityDigestHex: selectedGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: digestHex(selectedPackage.predictivePackageContentDigest),
    alphaEpiConfigScale8,
  });
  const replayEvidenceContentDigestHex = computeSemanticSha256Hex({
    schemaVersion: KM_SURFACE_REPLAY_EVIDENCE_V2,
    familyIdentityDigestHex,
    globalAnchorSetDigestHex: input.globalAnchorSetDigestHex,
    selectedAnchorEpochMins: input.selectedAnchors.map((anchor) => anchor.anchorEpochMin),
    candidateGenerationDigestsHex,
    evidence: replay.canonicalEvidence,
  });
  return Object.freeze({ receipt, replayEvidenceContentDigestHex });
}

export function buildKmFourSurfaceContractV2(input: Readonly<{
  developmentAuthority: KmFourSurfaceDevelopmentAuthorityV2;
  surfaces: readonly KmCanonicalSurfaceInputV2[];
}>): KmFourSurfaceContractV2 {
  const ordered = orderFourSurfaces(input.surfaces);
  assertFamilyCohort(ordered, input.developmentAuthority);
  const rebuiltAuthority = buildKmFourSurfaceDevelopmentAuthorityV2({
    organizationId: input.developmentAuthority.organizationId,
    datasetAuthorityIdentityDigestHex:
      input.developmentAuthority.datasetAuthorityIdentityDigestHex,
    surfaces: ordered,
  });
  if (
    canonicalizeSemanticJsonString(rebuiltAuthority) !==
    canonicalizeSemanticJsonString(input.developmentAuthority)
  ) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:DEVELOPMENT_AUTHORITY");
  }
  const prepared = ordered.map((surface, index) =>
    prepareSurface(surface, rebuiltAuthority.surfaceCorpora[index]!),
  );
  if (new Set(prepared.map((surface) => surface.familyIdentityDigestHex)).size !== prepared.length) {
    throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:DUPLICATE_FAMILY");
  }
  const globalAnchorSetDigestHex = computeKmGlobalAnchorSetDigest(
    prepared.map((surface) => Buffer.from(surface.surfaceAnchorSetDigestHex, "hex")),
  ).toString("hex");
  const surfaces = prepared.map((surface) => {
    const replay = buildKmSurfaceConvergenceReceiptFromReplayV2({
      family: surface.family,
      developmentCorpus: surface.corpus,
      selectedAnchors: surface.selectedAnchors,
      replayEvidence: surface.input.replayEvidence,
      globalAnchorSetDigestHex,
      alphaEpiConfigScale8: surface.input.convergenceReceipt.alphaEpiConfigScale8,
    });
    if (
      canonicalizeSemanticJsonString(replay.receipt) !==
      canonicalizeSemanticJsonString(surface.input.convergenceReceipt)
    ) {
      throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:CONVERGENCE_RECEIPT");
    }
    if (replay.replayEvidenceContentDigestHex !== surface.input.replayEvidenceContentDigestHex) {
      throw new Error("KM_FOUR_SURFACE_CONTRACT_REFUSED:REPLAY_EVIDENCE");
    }
    const body = {
      surfaceKey: surfaceKey(surface.surface),
      symbol: surface.surface.symbol,
      primaryHorizonMinutes: surface.surface.primaryHorizonMinutes,
      family: surface.family,
      familyIdentityDigestHex: surface.familyIdentityDigestHex,
      developmentCorpusContentDigestHex: surface.corpusContentDigestHex,
      selectedAnchorCount: KM_ANCHORS_PER_SURFACE,
      surfaceAnchorSetDigestHex: surface.surfaceAnchorSetDigestHex,
      globalAnchorSetDigestHex,
      replayEvidenceContentDigestHex: replay.replayEvidenceContentDigestHex,
      convergenceReceipt: replay.receipt,
    };
    return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
  });
  const body = {
    schemaVersion: KM_FOUR_SURFACE_CONTRACT_V2,
    organizationId: rebuiltAuthority.organizationId,
    developmentDatasetDigestHex: rebuiltAuthority.datasetAuthorityIdentityDigestHex,
    developmentAuthorityContentDigestHex: rebuiltAuthority.contentDigestHex,
    surfaces,
    globalAnchorSetDigestHex,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}
