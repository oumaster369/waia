import { createHash } from "node:crypto";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  buildBaselineContextFromDevelopment,
  evaluateMandatoryBaselineV1,
  MANDATORY_BASELINE_IDS,
  type BaselineContext,
} from "./baseline-models-v1";
import { holmFamilyPassV1, holmFwerV1, type HolmComparison } from "./holm-fwer-v1";
import { multiclassLogScore } from "./target-grid-ceremony-v1";
import {
  computeTrialIdentityDigestV2,
  digestHex,
  type TrialIdentityInput,
} from "./trial-identity-v2";
import { validationBootstrapPValueV1 } from "./validation-bootstrap-v1";

export const RESEARCH_HARNESS_ADMISSION_VERSION = "research-harness-admission/v2" as const;
export const SCIENTIFIC_ADMISSION_RECEIPT_VERSION = "scientific-admission-receipt/v2" as const;

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
  schemaVersion: typeof RESEARCH_HARNESS_ADMISSION_VERSION;
  terminalStatus: "QUALIFIED" | "NO_CHALLENGER_QUALIFIES";
  comparisonFamilyId: string;
  commonAnchorSetDigestHex: string;
  holmComparisons: readonly HolmComparison[];
  holmResults: ReturnType<typeof holmFwerV1>;
  baselineAvailability: Record<string, "AVAILABLE" | "UNAVAILABLE">;
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
    scoringContractVersion: "multiclass-log-score/v1",
    evaluationPartitionReceiptDigestHex: input.evaluationPartitionReceiptDigestHex,
    venue: input.venue,
    market: input.market,
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    challengerPackageContentDigestHex: input.challengerPackageContentDigestHex,
    metricId: "terminal-multiclass-log-score/v1",
    commonAnchorSetDigestHex: computeCommonAnchorSetDigestHex(input.anchors.map((a) => a.anchorId)),
    purgeDurationMinutes: input.purgeDurationMinutes,
    embargoDurationMinutes: input.embargoDurationMinutes,
    comparisonFamilyId: input.comparisonFamilyId,
  };
}

function challengerLogScoreAtAnchor(
  anchor: ResearchHarnessAnchorV1,
  context: BaselineContext,
): number {
  return multiclassLogScore(anchor.observedReturn, anchor.challengerProbabilities, context.grid);
}

function baselineAvailableOnAllAnchors(
  baselineId: (typeof MANDATORY_BASELINE_IDS)[number],
  context: BaselineContext,
): boolean {
  const probe = evaluateMandatoryBaselineV1(baselineId, context);
  return probe.status === "AVAILABLE";
}

function computeAdmissionReceiptDigest(input: {
  comparisonFamilyId: string;
  commonAnchorSetDigestHex: string;
  holmComparisons: readonly HolmComparison[];
  terminalStatus: ResearchHarnessAdmissionResultV1["terminalStatus"];
}): string {
  const body = [
    SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
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
export function runResearchHarnessAdmissionV1(
  input: ResearchHarnessAdmissionInputV1,
): ResearchHarnessAdmissionResultV1 {
  if (input.anchors.length === 0) {
    return {
      schemaVersion: RESEARCH_HARNESS_ADMISSION_VERSION,
      terminalStatus: "NO_CHALLENGER_QUALIFIES",
      comparisonFamilyId: input.comparisonFamilyId,
      commonAnchorSetDigestHex: computeCommonAnchorSetDigestHex([]),
      holmComparisons: [],
      holmResults: [],
      baselineAvailability: Object.fromEntries(
        MANDATORY_BASELINE_IDS.map((id) => [id, "UNAVAILABLE"]),
      ),
      admissionReceiptDigestHex: computeAdmissionReceiptDigest({
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
      const challenger = challengerLogScoreAtAnchor(anchor, context);
      return challenger - baseline.logScore(anchor.observedReturn);
    });
    const trialDigest = buildTrialIdentity(trialCommon, baselineId);
    const bootstrap = validationBootstrapPValueV1({
      differentials,
      trialIdentityDigest32: trialDigest,
    });
    holmComparisons.push({ comparisonId: baselineId, pValue: bootstrap.pRaw });
  }

  if (holmComparisons.length !== MANDATORY_BASELINE_IDS.length) {
    const holmResults = holmFwerV1(holmComparisons);
    return {
      schemaVersion: RESEARCH_HARNESS_ADMISSION_VERSION,
      terminalStatus: "NO_CHALLENGER_QUALIFIES",
      comparisonFamilyId: input.comparisonFamilyId,
      commonAnchorSetDigestHex,
      holmComparisons,
      holmResults,
      baselineAvailability,
      admissionReceiptDigestHex: computeAdmissionReceiptDigest({
        comparisonFamilyId: input.comparisonFamilyId,
        commonAnchorSetDigestHex,
        holmComparisons,
        terminalStatus: "NO_CHALLENGER_QUALIFIES",
      }),
      reasonCodes: [...reasonCodes, "INCOMPLETE_MANDATORY_BASELINE_FAMILY"],
    };
  }

  const positiveMeanRequired = holmComparisons.every((comparison) => {
    const baseline = evaluateMandatoryBaselineV1(
      comparison.comparisonId as (typeof MANDATORY_BASELINE_IDS)[number],
      context,
    );
    if (baseline.status === "UNAVAILABLE") {
      return false;
    }
    const meanDiff =
      canonicalAnchors.reduce((acc, anchor) => {
        const challenger = challengerLogScoreAtAnchor(anchor, context);
        return acc + (challenger - baseline.logScore(anchor.observedReturn));
      }, 0) / canonicalAnchors.length;
    return meanDiff > 0;
  });

  if (!positiveMeanRequired) {
    const holmResults = holmFwerV1(holmComparisons);
    return {
      schemaVersion: RESEARCH_HARNESS_ADMISSION_VERSION,
      terminalStatus: "NO_CHALLENGER_QUALIFIES",
      comparisonFamilyId: input.comparisonFamilyId,
      commonAnchorSetDigestHex,
      holmComparisons,
      holmResults,
      baselineAvailability,
      admissionReceiptDigestHex: computeAdmissionReceiptDigest({
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
    terminalStatus,
    comparisonFamilyId: input.comparisonFamilyId,
    commonAnchorSetDigestHex,
    holmComparisons,
    holmResults,
    baselineAvailability,
    admissionReceiptDigestHex: computeAdmissionReceiptDigest({
      comparisonFamilyId: input.comparisonFamilyId,
      commonAnchorSetDigestHex,
      holmComparisons,
      terminalStatus,
    }),
    reasonCodes,
  };
}

export { digestHex };
