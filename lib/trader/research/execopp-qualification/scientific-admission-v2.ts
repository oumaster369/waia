import { createHash } from "node:crypto";

import { MANDATORY_BASELINE_IDS } from "@/lib/trader/research/benchmark/baseline-models-v1";
import { holmFwerV1 } from "@/lib/trader/research/benchmark/holm-fwer-v1";
import {
  computeResearchHarnessAdmissionReceiptDigestV2,
  RESEARCH_HARNESS_ADMISSION_VERSION,
  runResearchHarnessAdmissionV1,
  type ResearchHarnessAdmissionInputV1,
  type ResearchHarnessAdmissionResultV1,
} from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";

import {
  buildKmConvergenceReceiptV1,
  KM_CONVERGENCE_RECEIPT_VERSION,
  type KmConvergenceReceipt,
} from "./km-convergence-gate-v1";

export const PREDICTIVE_TERMINAL_RECEIPT_VERSION = "predictive-terminal-receipt/v1" as const;
export const EPISTEMIC_PARAMETER_RATIFICATION_VERSION =
  "epistemic-parameter-ratification/v1" as const;
export const SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION =
  "scientific-admission-receipt/v2" as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requireDigest(value: string, field: string): void {
  if (!SHA256_HEX.test(value)) throw new Error(`SCIENTIFIC_ADMISSION_INVALID_DIGEST:${field}`);
}

function canonicalBaselineIds(): string[] {
  return [...MANDATORY_BASELINE_IDS].sort((a, b) => a.localeCompare(b));
}

export type PredictiveIdentityBindingsV1 = {
  developmentDatasetDigestHex: string;
  targetGridReceiptDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  predictivePackageContentDigestHex: string;
  runtimeContractDigestHex: string;
  scoringContractVersion: "multiclass-log-score/v1";
  evaluationPartitionReceiptDigestHex: string;
};

export type PredictiveTerminalReceiptV1 = PredictiveIdentityBindingsV1 & {
  schemaVersion: typeof PREDICTIVE_TERMINAL_RECEIPT_VERSION;
  harnessSchemaVersion: typeof RESEARCH_HARNESS_ADMISSION_VERSION;
  terminalStatus: "QUALIFIED" | "NO_CHALLENGER_QUALIFIES";
  comparisonFamilyId: string;
  commonAnchorSetDigestHex: string;
  mandatoryBaselineIds: readonly string[];
  baselineAvailability: Record<string, "AVAILABLE" | "UNAVAILABLE">;
  meanImprovementByBaseline: Record<string, number>;
  holmComparisons: ResearchHarnessAdmissionResultV1["holmComparisons"];
  holmResults: ResearchHarnessAdmissionResultV1["holmResults"];
  harnessAdmissionReceiptDigestHex: string;
  reasonCodes: readonly string[];
  contentDigestHex: string;
};

function predictiveReceiptBody(
  receipt: Omit<PredictiveTerminalReceiptV1, "contentDigestHex">,
): Omit<PredictiveTerminalReceiptV1, "contentDigestHex"> {
  return receipt;
}

function validatePredictiveTerminalReceipt(receipt: PredictiveTerminalReceiptV1): void {
  const { contentDigestHex, ...body } = receipt;
  if (receipt.schemaVersion !== PREDICTIVE_TERMINAL_RECEIPT_VERSION) {
    throw new Error("SCIENTIFIC_ADMISSION_PREDICTIVE_SCHEMA_MISMATCH");
  }
  if (receipt.harnessSchemaVersion !== RESEARCH_HARNESS_ADMISSION_VERSION) {
    throw new Error("SCIENTIFIC_ADMISSION_PREDICTIVE_HARNESS_SCHEMA_MISMATCH");
  }
  for (const [field, value] of Object.entries(receipt)) {
    if (field.endsWith("DigestHex")) requireDigest(String(value), field);
  }
  if (sha256Canonical(body) !== contentDigestHex) {
    throw new Error("SCIENTIFIC_ADMISSION_PREDICTIVE_DIGEST_MISMATCH");
  }
  const expectedHarnessDigest = computeResearchHarnessAdmissionReceiptDigestV2({
    comparisonFamilyId: receipt.comparisonFamilyId,
    commonAnchorSetDigestHex: receipt.commonAnchorSetDigestHex,
    holmComparisons: receipt.holmComparisons,
    terminalStatus: receipt.terminalStatus,
  });
  if (expectedHarnessDigest !== receipt.harnessAdmissionReceiptDigestHex) {
    throw new Error("SCIENTIFIC_ADMISSION_PREDICTIVE_HARNESS_MISMATCH");
  }
  if (receipt.terminalStatus !== "QUALIFIED") return;
  const expectedIds = canonicalBaselineIds();
  const actualIds = receipt.holmComparisons
    .map((value) => value.comparisonId)
    .sort((a, b) => a.localeCompare(b));
  if (
    JSON.stringify(receipt.mandatoryBaselineIds) !== JSON.stringify(expectedIds) ||
    JSON.stringify(actualIds) !== JSON.stringify(expectedIds)
  ) {
    throw new Error("SCIENTIFIC_ADMISSION_PREDICTIVE_BASELINE_FAMILY_MISMATCH");
  }
  if (
    expectedIds.some(
      (id) =>
        receipt.baselineAvailability[id] !== "AVAILABLE" ||
        !Number.isFinite(receipt.meanImprovementByBaseline[id]) ||
        receipt.meanImprovementByBaseline[id]! <= 0,
    )
  ) {
    throw new Error("SCIENTIFIC_ADMISSION_PREDICTIVE_POSITIVE_MEAN_MISMATCH");
  }
  const holmResults = holmFwerV1(receipt.holmComparisons);
  if (
    holmResults.some((value) => !value.rejected) ||
    JSON.stringify(holmResults) !== JSON.stringify(receipt.holmResults)
  ) {
    throw new Error("SCIENTIFIC_ADMISSION_PREDICTIVE_HOLM_MISMATCH");
  }
}

export function buildPredictiveTerminalReceiptV1(input: {
  harnessInput: ResearchHarnessAdmissionInputV1;
  identities: PredictiveIdentityBindingsV1;
}): PredictiveTerminalReceiptV1 {
  for (const [field, value] of Object.entries(input.identities)) {
    if (field !== "scoringContractVersion") requireDigest(value, field);
  }
  if (
    input.harnessInput.challengerPackageContentDigestHex !==
      input.identities.predictivePackageContentDigestHex ||
    input.harnessInput.evaluationPartitionReceiptDigestHex !==
      input.identities.evaluationPartitionReceiptDigestHex
  ) {
    throw new Error("PREDICTIVE_TERMINAL_HARNESS_IDENTITY_MISMATCH");
  }
  const result = runResearchHarnessAdmissionV1(input.harnessInput);
  const expectedHarnessDigest = computeResearchHarnessAdmissionReceiptDigestV2({
    comparisonFamilyId: result.comparisonFamilyId,
    commonAnchorSetDigestHex: result.commonAnchorSetDigestHex,
    holmComparisons: result.holmComparisons,
    terminalStatus: result.terminalStatus,
  });
  if (expectedHarnessDigest !== result.admissionReceiptDigestHex) {
    throw new Error("PREDICTIVE_TERMINAL_HARNESS_DIGEST_MISMATCH");
  }

  const expectedIds = canonicalBaselineIds();
  const comparisonIds = result.holmComparisons
    .map((value) => value.comparisonId)
    .sort((a, b) => a.localeCompare(b));
  const holmResults = holmFwerV1(result.holmComparisons);
  if (JSON.stringify(holmResults) !== JSON.stringify(result.holmResults)) {
    throw new Error("PREDICTIVE_TERMINAL_HOLM_RESULT_MISMATCH");
  }

  if (result.terminalStatus === "QUALIFIED") {
    if (JSON.stringify(comparisonIds) !== JSON.stringify(expectedIds)) {
      throw new Error("PREDICTIVE_TERMINAL_MANDATORY_BASELINE_FAMILY_INCOMPLETE");
    }
    if (
      expectedIds.some(
        (id) =>
          result.baselineAvailability[id] !== "AVAILABLE" ||
          !Number.isFinite(result.meanImprovementByBaseline[id]) ||
          result.meanImprovementByBaseline[id]! <= 0,
      )
    ) {
      throw new Error("PREDICTIVE_TERMINAL_BASELINE_OR_POSITIVE_MEAN_FAILED");
    }
    if (holmResults.length !== expectedIds.length || holmResults.some((value) => !value.rejected)) {
      throw new Error("PREDICTIVE_TERMINAL_HOLM_FAMILY_FAILED");
    }
  }

  const body: Omit<PredictiveTerminalReceiptV1, "contentDigestHex"> = {
    schemaVersion: PREDICTIVE_TERMINAL_RECEIPT_VERSION,
    harnessSchemaVersion: RESEARCH_HARNESS_ADMISSION_VERSION,
    terminalStatus: result.terminalStatus,
    ...input.identities,
    comparisonFamilyId: result.comparisonFamilyId,
    commonAnchorSetDigestHex: result.commonAnchorSetDigestHex,
    mandatoryBaselineIds: expectedIds,
    baselineAvailability: result.baselineAvailability,
    meanImprovementByBaseline: result.meanImprovementByBaseline,
    holmComparisons: result.holmComparisons,
    holmResults: result.holmResults,
    harnessAdmissionReceiptDigestHex: result.admissionReceiptDigestHex,
    reasonCodes: result.reasonCodes,
  };
  return { ...body, contentDigestHex: sha256Canonical(predictiveReceiptBody(body)) };
}

export type EpistemicParameterRatificationReceiptV1 = {
  schemaVersion: typeof EPISTEMIC_PARAMETER_RATIFICATION_VERSION;
  verdict: "RATIFIED";
  kmConvergenceEvidenceSemanticDigestHex: string;
  selectedK: number;
  selectedM: number;
  alphaEpiConfigScale8: string;
  selectedPackageGenerationIdentityDigestHex: string;
  selectedPackageContentDigestHex: string;
  humanReceiptIdentityDigestHex: string;
  contentDigestHex: string;
};

export function buildEpistemicParameterRatificationReceiptV1(
  input: Omit<EpistemicParameterRatificationReceiptV1, "schemaVersion" | "verdict" | "contentDigestHex">,
): EpistemicParameterRatificationReceiptV1 {
  requireDigest(input.kmConvergenceEvidenceSemanticDigestHex, "kmConvergenceEvidenceSemanticDigestHex");
  requireDigest(input.selectedPackageGenerationIdentityDigestHex, "selectedPackageGenerationIdentityDigestHex");
  requireDigest(input.selectedPackageContentDigestHex, "selectedPackageContentDigestHex");
  requireDigest(input.humanReceiptIdentityDigestHex, "humanReceiptIdentityDigestHex");
  if (!Number.isSafeInteger(input.selectedK) || input.selectedK <= 0) {
    throw new Error("EPISTEMIC_RATIFICATION_INVALID_K");
  }
  if (!Number.isSafeInteger(input.selectedM) || input.selectedM <= 0) {
    throw new Error("EPISTEMIC_RATIFICATION_INVALID_M");
  }
  if (!/^\d+\.\d{8}$/.test(input.alphaEpiConfigScale8)) {
    throw new Error("EPISTEMIC_RATIFICATION_INVALID_ALPHA");
  }
  const body = {
    schemaVersion: EPISTEMIC_PARAMETER_RATIFICATION_VERSION,
    verdict: "RATIFIED" as const,
    kmConvergenceEvidenceSemanticDigestHex: input.kmConvergenceEvidenceSemanticDigestHex,
    selectedK: input.selectedK,
    selectedM: input.selectedM,
    alphaEpiConfigScale8: input.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigestHex:
      input.selectedPackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: input.selectedPackageContentDigestHex,
    humanReceiptIdentityDigestHex: input.humanReceiptIdentityDigestHex,
  };
  return { ...body, contentDigestHex: sha256Canonical(body) };
}

export type ScientificAdmissionReceiptV2 = {
  schemaVersion: typeof SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION;
  organizationId: string;
  wfPartition: "WF_PREDICTIVE";
  terminalStatus: "ADMITTED" | "NOT_ADMITTED";
  predictiveTerminalReceipt: PredictiveTerminalReceiptV1;
  kmConvergenceReceipt: KmConvergenceReceipt;
  epistemicParameterRatificationReceipt: EpistemicParameterRatificationReceiptV1;
  evidenceSemanticDigestHex: string;
  contentDigestHex: string;
};

export function computeScientificAdmissionEvidenceSemanticDigestV2(input: {
  organizationId: string;
  predictiveTerminalReceiptDigestHex: string;
  kmConvergenceEvidenceSemanticDigestHex: string;
  epistemicParameterRatificationReceiptDigestHex: string;
}): string {
  return sha256Canonical({ schemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION, ...input });
}

function validateKmReceipt(receipt: KmConvergenceReceipt): void {
  if (receipt.schemaVersion !== KM_CONVERGENCE_RECEIPT_VERSION) {
    throw new Error("SCIENTIFIC_ADMISSION_KM_SCHEMA_MISMATCH");
  }
  const rebuilt = buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: receipt.replicaRootFamilyIdentityDigestHex,
    kmGlobalAnchorSetDigestHex: receipt.kmGlobalAnchorSetDigestHex,
    candidateGenerationDigestsHex: receipt.candidateGenerationDigestsHex,
    configurations: receipt.configurations,
    selectedPackageGenerationIdentityDigestHex: receipt.selectedPackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: receipt.selectedPackageContentDigestHex,
    alphaEpiConfigScale8: receipt.alphaEpiConfigScale8,
  });
  if (JSON.stringify(rebuilt) !== JSON.stringify(receipt)) {
    throw new Error("SCIENTIFIC_ADMISSION_KM_RECEIPT_MISMATCH");
  }
}

function scientificBody(receipt: Omit<ScientificAdmissionReceiptV2, "contentDigestHex">) {
  return receipt;
}

export function buildScientificAdmissionReceiptV2(input: {
  organizationId: string;
  predictiveTerminalReceipt: PredictiveTerminalReceiptV1;
  kmConvergenceReceipt: KmConvergenceReceipt;
  epistemicParameterRatificationReceipt: EpistemicParameterRatificationReceiptV1;
}): ScientificAdmissionReceiptV2 {
  if (!input.organizationId.trim()) throw new Error("SCIENTIFIC_ADMISSION_ORGANIZATION_REQUIRED");
  validateKmReceipt(input.kmConvergenceReceipt);

  const predictive = input.predictiveTerminalReceipt;
  validatePredictiveTerminalReceipt(predictive);
  const ratification = input.epistemicParameterRatificationReceipt;
  if (
    ratification.schemaVersion !== EPISTEMIC_PARAMETER_RATIFICATION_VERSION ||
    ratification.verdict !== "RATIFIED"
  ) {
    throw new Error("SCIENTIFIC_ADMISSION_RATIFICATION_NOT_RATIFIED");
  }
  for (const [field, value] of Object.entries(ratification)) {
    if (field.endsWith("DigestHex")) requireDigest(String(value), field);
  }
  const { contentDigestHex: ratificationDigest, ...ratificationBody } = ratification;
  if (sha256Canonical(ratificationBody) !== ratificationDigest) {
    throw new Error("SCIENTIFIC_ADMISSION_RATIFICATION_DIGEST_MISMATCH");
  }

  const km = input.kmConvergenceReceipt;
  const kmAndRatificationMatch =
    km.terminalStatus === "QUALIFIED" &&
    km.selectedK === ratification.selectedK &&
    km.selectedM === ratification.selectedM &&
    km.alphaEpiConfigScale8 === ratification.alphaEpiConfigScale8 &&
    km.evidenceSemanticDigestHex === ratification.kmConvergenceEvidenceSemanticDigestHex &&
    km.selectedPackageGenerationIdentityDigestHex ===
      ratification.selectedPackageGenerationIdentityDigestHex &&
    km.selectedPackageContentDigestHex === ratification.selectedPackageContentDigestHex &&
    predictive.predictivePackageGenerationIdentityDigestHex ===
      ratification.selectedPackageGenerationIdentityDigestHex &&
    predictive.predictivePackageContentDigestHex === ratification.selectedPackageContentDigestHex;

  const terminalStatus =
    predictive.terminalStatus === "QUALIFIED" && kmAndRatificationMatch
      ? ("ADMITTED" as const)
      : ("NOT_ADMITTED" as const);
  if (predictive.terminalStatus === "QUALIFIED" && !kmAndRatificationMatch) {
    throw new Error("SCIENTIFIC_ADMISSION_KM_RATIFICATION_MISMATCH");
  }

  const evidenceSemanticDigestHex = computeScientificAdmissionEvidenceSemanticDigestV2({
    organizationId: input.organizationId,
    predictiveTerminalReceiptDigestHex: predictive.contentDigestHex,
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex: ratification.contentDigestHex,
  });
  const body: Omit<ScientificAdmissionReceiptV2, "contentDigestHex"> = {
    schemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION,
    organizationId: input.organizationId,
    wfPartition: "WF_PREDICTIVE",
    terminalStatus,
    predictiveTerminalReceipt: predictive,
    kmConvergenceReceipt: km,
    epistemicParameterRatificationReceipt: ratification,
    evidenceSemanticDigestHex,
  };
  return { ...body, contentDigestHex: sha256Canonical(scientificBody(body)) };
}

export type ScientificAdmissionExpectedBindingsV2 = {
  organizationId: string;
  developmentDatasetDigestHex: string;
  targetGridReceiptDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  predictivePackageContentDigestHex: string;
  runtimeContractDigestHex: string;
  scoringContractVersion: "multiclass-log-score/v1";
  evaluationPartitionReceiptDigestHex: string;
  kmConvergenceEvidenceSemanticDigestHex: string;
  epistemicParameterRatificationReceiptDigestHex: string;
  predictiveTerminalReceiptContentDigestHex: string;
};

export function requireScientificAdmissionV2(
  receipt: ScientificAdmissionReceiptV2 | null | undefined,
  expected: ScientificAdmissionExpectedBindingsV2,
): ScientificAdmissionReceiptV2 {
  if (!receipt) throw new Error("SCIENTIFIC_ADMISSION_V2_MISSING");
  const rebuilt = buildScientificAdmissionReceiptV2({
    organizationId: receipt.organizationId,
    predictiveTerminalReceipt: receipt.predictiveTerminalReceipt,
    kmConvergenceReceipt: receipt.kmConvergenceReceipt,
    epistemicParameterRatificationReceipt: receipt.epistemicParameterRatificationReceipt,
  });
  if (JSON.stringify(rebuilt) !== JSON.stringify(receipt)) {
    throw new Error("SCIENTIFIC_ADMISSION_V2_CONTENT_MISMATCH");
  }
  const predictive = receipt.predictiveTerminalReceipt;
  const actual = {
    organizationId: receipt.organizationId,
    developmentDatasetDigestHex: predictive.developmentDatasetDigestHex,
    targetGridReceiptDigestHex: predictive.targetGridReceiptDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      predictive.predictivePackageGenerationIdentityDigestHex,
    predictivePackageContentDigestHex: predictive.predictivePackageContentDigestHex,
    runtimeContractDigestHex: predictive.runtimeContractDigestHex,
    scoringContractVersion: predictive.scoringContractVersion,
    evaluationPartitionReceiptDigestHex: predictive.evaluationPartitionReceiptDigestHex,
    kmConvergenceEvidenceSemanticDigestHex: receipt.kmConvergenceReceipt.evidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex:
      receipt.epistemicParameterRatificationReceipt.contentDigestHex,
    predictiveTerminalReceiptContentDigestHex: predictive.contentDigestHex,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("SCIENTIFIC_ADMISSION_V2_STALE_OR_REPLAYED_BINDING");
  }
  if (receipt.terminalStatus !== "ADMITTED") {
    throw new Error("SCIENTIFIC_ADMISSION_V2_NOT_ADMITTED");
  }
  return receipt;
}
