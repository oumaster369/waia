import { TERMINAL_SCORING_CONTRACT, TERMINAL_SCORING_METRIC, TERMINAL_SCORING_AMENDMENT_DIGEST, multiclassBrierRewardV1, assertTerminalProbabilityVectorV2 } from "@/lib/trader/research/benchmark/terminal-scoring-protocol-v2";
import { createHash } from "node:crypto";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  buildBaselineContextFromDevelopment,
  evaluateMandatoryBaselineV1,
  MANDATORY_BASELINE_IDS,
  type BaselineContext,
} from "./baseline-models-v1";
import { holmFamilyPassV1, holmFwerV1, type HolmComparison } from "./holm-fwer-v1";
import { bucketIndexForReturn, multiclassLogScore } from "./target-grid-ceremony-v1";

import {
  computeTrialIdentityDigestV2,
  digestHex,
  type TrialIdentityInput,
} from "./trial-identity-v2";
import { VALIDATION_BOOTSTRAP_VERSION, validationBootstrapPValueV1,
  preflightValidationBootstrapV1,
  snapshotValidationBootstrapExecutionV1,
  validationBootstrapPValueAsyncV1, type ValidationBootstrapExecutionV1,
  type ValidationBootstrapNullCenteredResultV1 } from "./validation-bootstrap-v1";

// DEE-947: keep corrected-law evidence separate even when numeric outputs coincide.
export const RESEARCH_HARNESS_ADMISSION_VERSION = "research-harness-admission/v4" as const;
export const SCIENTIFIC_ADMISSION_RECEIPT_VERSION = "scientific-admission-receipt/v4" as const;

export type ResearchHarnessAnchorV1 = {
  anchorId: string;
  observedReturn: number;
  challengerProbabilities: readonly number[];
};

export type ResearchHarnessAdmissionInputV1 = {
  venue: string;
  market: string;
  symbol: string;
  primaryHorizonMinutes: 30 | 60;
  challengerPackageContentDigestHex: string;
  comparisonFamilyId: string;
  evaluationPartitionReceiptDigestHex: string;
  purgeDurationMinutes: number;
  embargoDurationMinutes: number;
  developmentReturns: readonly number[];
  historyReturns: readonly (number | null)[];
  historyReturnMinuteOpenTimesMs: readonly number[];
  anchors: readonly ResearchHarnessAnchorV1[];
};

export type ResearchHarnessAdmissionResultV1 = {
  logScoreDiagnostics: Record<string, {
    challengerZeroCount: number; baselineZeroCount: number; nonFiniteDifferentialCount: number;
    positiveInfinityCount: number; negativeInfinityCount: number; nanCount: number;
  }>;
  schemaVersion: typeof RESEARCH_HARNESS_ADMISSION_VERSION;
  terminalStatus: "QUALIFIED" | "NO_CHALLENGER_QUALIFIES";
  comparisonFamilyId: string;
  commonAnchorSetDigestHex: string;
  holmComparisons: readonly HolmComparison[];
  holmResults: ReturnType<typeof holmFwerV1>;
  baselineAvailability: Record<string, "AVAILABLE" | "UNAVAILABLE">;
  meanImprovementByBaseline: Record<string, number>;
  admissionReceiptDigestHex: string;
  reasonCodes: string[];
};

function computeCommonAnchorSetDigestHex(anchorIds: readonly string[]): string {
  const body = ["common-anchor-set/v1", ...[...anchorIds].sort()].join("\n");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function buildTrialIdentity(
  base: Omit<TrialIdentityInput, "baselineId">,
  baselineId: string,
): Buffer {
  return computeTrialIdentityDigestV2({
    ...base,
    baselineId,
  });
}

function trialBase(input: ResearchHarnessAdmissionInputV1): Omit<TrialIdentityInput, "baselineId"> {
  return {
    scoringContractVersion: TERMINAL_SCORING_CONTRACT,
    evaluationPartitionReceiptDigestHex: input.evaluationPartitionReceiptDigestHex,
    venue: input.venue,
    market: input.market,
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    challengerPackageContentDigestHex: input.challengerPackageContentDigestHex,
    metricId: TERMINAL_SCORING_METRIC,
    commonAnchorSetDigestHex: computeCommonAnchorSetDigestHex(input.anchors.map((a) => a.anchorId)),
    purgeDurationMinutes: input.purgeDurationMinutes,
    embargoDurationMinutes: input.embargoDurationMinutes,
    comparisonFamilyId: input.comparisonFamilyId,
  };
}

function challengerPrimaryScoreAtAnchor(
  anchor: ResearchHarnessAnchorV1,
  context: BaselineContext,
): number {
  return multiclassBrierRewardV1(anchor.observedReturn, anchor.challengerProbabilities, context.grid);
}

function baselineAvailableOnAllAnchors(
  baselineId: (typeof MANDATORY_BASELINE_IDS)[number],
  context: BaselineContext,
): boolean {
  const probe = evaluateMandatoryBaselineV1(baselineId, context);
  return probe.status === "AVAILABLE";
}

export function computeResearchHarnessAdmissionReceiptDigestV2(input: {
  comparisonFamilyId: string;
  commonAnchorSetDigestHex: string;
  holmComparisons: readonly HolmComparison[];
  terminalStatus: ResearchHarnessAdmissionResultV1["terminalStatus"];
}): string {
  const body = [
    SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
    TERMINAL_SCORING_CONTRACT,
    TERMINAL_SCORING_METRIC,
    TERMINAL_SCORING_AMENDMENT_DIGEST,
    VALIDATION_BOOTSTRAP_VERSION,
    input.comparisonFamilyId,
    input.commonAnchorSetDigestHex,
    input.terminalStatus,
    ...input.holmComparisons
      .map((c) => `${c.comparisonId}:${c.pValue.toFixed(12)}`)
      .sort((a, b) => a.localeCompare(b)),
  ].join("\n");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** Authoritative WF_PREDICTIVE challenger admission path (DEE-531). */
function* researchHarnessAdmissionSteps(
  input: ResearchHarnessAdmissionInputV1,
): Generator<Parameters<typeof validationBootstrapPValueV1>[0],
  ResearchHarnessAdmissionResultV1, ValidationBootstrapNullCenteredResultV1> {
  const logScoreDiagnostics: ResearchHarnessAdmissionResultV1["logScoreDiagnostics"] = {};
  if (input.anchors.length === 0) {
    return {
      schemaVersion: RESEARCH_HARNESS_ADMISSION_VERSION,
      logScoreDiagnostics,
      terminalStatus: "NO_CHALLENGER_QUALIFIES",
      comparisonFamilyId: input.comparisonFamilyId,
      commonAnchorSetDigestHex: computeCommonAnchorSetDigestHex([]),
      holmComparisons: [],
      holmResults: [],
      baselineAvailability: Object.fromEntries(
        MANDATORY_BASELINE_IDS.map((id) => [id, "UNAVAILABLE"]),
      ),
      meanImprovementByBaseline: {},
      admissionReceiptDigestHex: computeResearchHarnessAdmissionReceiptDigestV2({
        comparisonFamilyId: input.comparisonFamilyId,
        commonAnchorSetDigestHex: computeCommonAnchorSetDigestHex([]),
        holmComparisons: [],
        terminalStatus: "NO_CHALLENGER_QUALIFIES",
      }),
      reasonCodes: ["COMMON_ANCHOR_SET_EMPTY"],
    };
  }

  const context = buildBaselineContextFromDevelopment({
    developmentReturns: input.developmentReturns,
    history: input.historyReturns,
    historyMinuteOpenTimesMs: input.historyReturnMinuteOpenTimesMs,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
  });

  const baselineAvailability = Object.fromEntries(
    MANDATORY_BASELINE_IDS.map((baselineId) => [
      baselineId,
      baselineAvailableOnAllAnchors(baselineId, context) ? "AVAILABLE" : "UNAVAILABLE",
    ]),
  ) as Record<string, "AVAILABLE" | "UNAVAILABLE">;

  const reasonCodes: string[] = [];
  for (const baselineId of MANDATORY_BASELINE_IDS) {
    if (baselineAvailability[baselineId] === "UNAVAILABLE") {
      reasonCodes.push(`BASELINE_UNAVAILABLE:${baselineId}`);
    }
  }

  const commonAnchorSetDigestHex = computeCommonAnchorSetDigestHex(
    input.anchors.map((a) => a.anchorId),
  );
  const canonicalAnchors = [...input.anchors].sort((a, b) => a.anchorId.localeCompare(b.anchorId));
  const trialCommon = trialBase(input);
  trialCommon.commonAnchorSetDigestHex = commonAnchorSetDigestHex;

  // Check every available comparison before spending B=10000 resamples on any one.
  // One transient differential array at a time; valid arithmetic and trial identities
  // below remain unchanged. A refusal here is not a statistical rejection or admission.
  for (const baselineId of MANDATORY_BASELINE_IDS) {
    if (baselineAvailability[baselineId] === "UNAVAILABLE") continue;
    const baseline = evaluateMandatoryBaselineV1(baselineId, context);
    if (baseline.status === "UNAVAILABLE") continue;
    const diagnostic = { challengerZeroCount: 0, baselineZeroCount: 0, nonFiniteDifferentialCount: 0,
      positiveInfinityCount: 0, negativeInfinityCount: 0, nanCount: 0 };
    logScoreDiagnostics[baselineId] = diagnostic;
    const differentials = canonicalAnchors.map((anchor) => {
      let differential: number;
      try {
        differential = challengerPrimaryScoreAtAnchor(anchor, context) - multiclassBrierRewardV1(anchor.observedReturn, baseline.probabilities, context.grid);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("TERMINAL_SCORE_INVALID_")) throw error;
        const anchorDigest = createHash("sha256").update(anchor.anchorId).digest("hex");
        throw new Error(`${error.message}; baseline=${baselineId}; anchorDigest=${anchorDigest}`);
      }
      const bucket = bucketIndexForReturn(anchor.observedReturn, context.grid);
      if (anchor.challengerProbabilities[bucket] === 0) diagnostic.challengerZeroCount++;
      if (baseline.probabilities[bucket] === 0) diagnostic.baselineZeroCount++;
      const logDifference = multiclassLogScore(anchor.observedReturn, anchor.challengerProbabilities, context.grid) - baseline.logScore(anchor.observedReturn);
      if (!Number.isFinite(logDifference)) diagnostic.nonFiniteDifferentialCount++;
      if (logDifference === Infinity) diagnostic.positiveInfinityCount++;
      if (logDifference === -Infinity) diagnostic.negativeInfinityCount++;
      if (Number.isNaN(logDifference)) diagnostic.nanCount++;
      if (!Number.isFinite(differential)) {
        // Anchor IDs may be caller text. Publish only a fixed-length identity, no raw data.
        const anchorDigest = createHash("sha256").update(anchor.anchorId).digest("hex");
        throw new Error(`[validation-bootstrap] non-finite differential — qualification refused; baseline=${baselineId}; anchorDigest=${anchorDigest}`);
      }
      return differential;
    });
    try {
      preflightValidationBootstrapV1({ differentials, trialIdentityDigest32: buildTrialIdentity(trialCommon, baselineId) });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("[validation-bootstrap]")) {
        throw new Error(`${error.message}; baseline=${baselineId}`, { cause: error });
      }
      throw error;
    }
  }

  const holmComparisons: HolmComparison[] = [];
  for (const baselineId of MANDATORY_BASELINE_IDS) {
    if (baselineAvailability[baselineId] === "UNAVAILABLE") {
      continue;
    }
    const baseline = evaluateMandatoryBaselineV1(baselineId, context);
    if (baseline.status === "UNAVAILABLE") {
      continue;
    }
    const differentials = canonicalAnchors.map((anchor) => {
      const challenger = challengerPrimaryScoreAtAnchor(anchor, context);
      return challenger - multiclassBrierRewardV1(anchor.observedReturn, baseline.probabilities, context.grid);
    });
    const trialDigest = buildTrialIdentity(trialCommon, baselineId);
    const bootstrap = yield {
      differentials,
      trialIdentityDigest32: trialDigest,
    };
    holmComparisons.push({ comparisonId: baselineId, pValue: bootstrap.pRaw });
  }

  if (holmComparisons.length !== MANDATORY_BASELINE_IDS.length) {
    const holmResults = holmFwerV1(holmComparisons);
    return {
      schemaVersion: RESEARCH_HARNESS_ADMISSION_VERSION,
      logScoreDiagnostics,
      terminalStatus: "NO_CHALLENGER_QUALIFIES",
      comparisonFamilyId: input.comparisonFamilyId,
      commonAnchorSetDigestHex,
      holmComparisons,
      holmResults,
      baselineAvailability,
      meanImprovementByBaseline: {},
      admissionReceiptDigestHex: computeResearchHarnessAdmissionReceiptDigestV2({
        comparisonFamilyId: input.comparisonFamilyId,
        commonAnchorSetDigestHex,
        holmComparisons,
        terminalStatus: "NO_CHALLENGER_QUALIFIES",
      }),
      reasonCodes: [...reasonCodes, "INCOMPLETE_MANDATORY_BASELINE_FAMILY"],
    };
  }

  const meanImprovementByBaseline = Object.fromEntries(
    holmComparisons.map((comparison) => {
    const baseline = evaluateMandatoryBaselineV1(
      comparison.comparisonId as (typeof MANDATORY_BASELINE_IDS)[number],
      context,
    );
    if (baseline.status === "UNAVAILABLE") {
        return [comparison.comparisonId, Number.NaN];
    }
    const meanDiff =
      canonicalAnchors.reduce((acc, anchor) => {
        const challenger = challengerPrimaryScoreAtAnchor(anchor, context);
        return acc + (challenger - multiclassBrierRewardV1(anchor.observedReturn, baseline.probabilities, context.grid));
      }, 0) / canonicalAnchors.length;
      return [comparison.comparisonId, meanDiff];
    }),
  );
  const positiveMeanRequired = holmComparisons.every(
    (comparison) => (meanImprovementByBaseline[comparison.comparisonId] ?? Number.NaN) > 0,
  );

  if (!positiveMeanRequired) {
    const holmResults = holmFwerV1(holmComparisons);
    return {
      schemaVersion: RESEARCH_HARNESS_ADMISSION_VERSION,
      logScoreDiagnostics,
      terminalStatus: "NO_CHALLENGER_QUALIFIES",
      comparisonFamilyId: input.comparisonFamilyId,
      commonAnchorSetDigestHex,
      holmComparisons,
      holmResults,
      baselineAvailability,
      meanImprovementByBaseline,
      admissionReceiptDigestHex: computeResearchHarnessAdmissionReceiptDigestV2({
        comparisonFamilyId: input.comparisonFamilyId,
        commonAnchorSetDigestHex,
        holmComparisons,
        terminalStatus: "NO_CHALLENGER_QUALIFIES",
      }),
      reasonCodes: [...reasonCodes, "CHALLENGER_NOT_POSITIVE_VS_ALL_BASELINES"],
    };
  }

  const holmResults = holmFwerV1(holmComparisons);
  const holmPass = holmFamilyPassV1(holmComparisons);
  const terminalStatus = holmPass ? "QUALIFIED" : "NO_CHALLENGER_QUALIFIES";
  if (!holmPass) {
    reasonCodes.push("HOLM_FWER_REJECTED");
  }

  return {
    schemaVersion: RESEARCH_HARNESS_ADMISSION_VERSION,
    logScoreDiagnostics,
    terminalStatus,
    comparisonFamilyId: input.comparisonFamilyId,
    commonAnchorSetDigestHex,
    holmComparisons,
    holmResults,
    baselineAvailability,
    meanImprovementByBaseline,
    admissionReceiptDigestHex: computeResearchHarnessAdmissionReceiptDigestV2({
      comparisonFamilyId: input.comparisonFamilyId,
      commonAnchorSetDigestHex,
      holmComparisons,
      terminalStatus,
    }),
    reasonCodes,
  };
}

export function runResearchHarnessAdmissionV1(
  input: ResearchHarnessAdmissionInputV1,
): ResearchHarnessAdmissionResultV1 {
  const steps = researchHarnessAdmissionSteps(input);
  let step = steps.next();
  while (!step.done) step = steps.next(validationBootstrapPValueV1(step.value));
  return step.value;
}

/** Private generator accepts results only from the unchanged local kernel. */
export async function runResearchHarnessAdmissionAsyncV1(
  input: ResearchHarnessAdmissionInputV1,
  execution: ValidationBootstrapExecutionV1 = {},
): Promise<ResearchHarnessAdmissionResultV1> {
  const ownedExecution = snapshotValidationBootstrapExecutionV1(execution);
  // structuredClone invokes accessors and would erase evidence of malformed
  // probability entries. Reject them on the original vectors before cloning.
  for (const anchor of input.anchors) assertTerminalProbabilityVectorV2(anchor.challengerProbabilities);
  // Own all metadata/history/anchors across awaits. No caller mutation may alter
  // later baselines or receipt identity after the first baseline was computed.
  const steps = researchHarnessAdmissionSteps(structuredClone(input));
  let step = steps.next();
  try {
    while (!step.done) step = steps.next(await validationBootstrapPValueAsyncV1(step.value, ownedExecution));
    return step.value;
  } finally { steps.return(undefined as never); }
}

export { digestHex };
