import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBaselineContextFromDevelopment,
  evaluateMandatoryBaselineV1,
  MANDATORY_BASELINE_IDS,
} from "../../lib/trader/research/benchmark/baseline-models-v1";
import {
  bucketIndexForReturn,
  multiclassLogScore,
} from "../../lib/trader/research/benchmark/target-grid-ceremony-v1";
import { computeTrialIdentityDigestV2 } from "../../lib/trader/research/benchmark/trial-identity-v2";
import { MODEL_TRANSFORM_VERSION } from "../../lib/trader/intelligence/forecast-v2/constants";
import { computeTerminalTargetGridIdentityDigestHex } from "../../lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { readScientificDiagnosticInputsV1 } from "./scientific-checkpoint-audit-v1";

export type ScoreDiagnosticBindingV1 = {
  packageKey: string;
  releaseSha: string;
  contentDigestHex: string;
  developmentDatasetDigestHex: string;
  evaluationPartitionReceiptDigestHex: string;
  comparisonFamilyId: string;
  forecastCount: number;
  originalCompletedTrialIds: string[];
};
function fail(): never {
  throw new Error("SCIENTIFIC_SCORE_DIAGNOSTIC_REFUSED");
}
const hex = (s: unknown, n: number): s is string =>
  typeof s === "string" && new RegExp(`^[a-f0-9]{${n}}$`).test(s);
export function parseScoreDiagnosticBindingV1(value: unknown): ScoreDiagnosticBindingV1 {
  const binding = value as ScoreDiagnosticBindingV1;
  assertBinding(binding);
  return binding;
}

function assertBinding(b: ScoreDiagnosticBindingV1): void {
  if (
    !b ||
    !hex(b.packageKey, 64) ||
    !hex(b.releaseSha, 40) ||
    !hex(b.contentDigestHex, 64) ||
    !hex(b.developmentDatasetDigestHex, 64) ||
    !hex(b.evaluationPartitionReceiptDigestHex, 64) ||
    typeof b.comparisonFamilyId !== "string" ||
    !/^wf-predictive:[a-zA-Z0-9:-]{1,200}$/.test(b.comparisonFamilyId) ||
    !Number.isSafeInteger(b.forecastCount) ||
    b.forecastCount < 1 ||
    b.forecastCount > 1_000_000 ||
    !Array.isArray(b.originalCompletedTrialIds) ||
    !b.originalCompletedTrialIds.length ||
    b.originalCompletedTrialIds.length > 5 ||
    b.originalCompletedTrialIds.some((s) => !hex(s, 64)) ||
    new Set(b.originalCompletedTrialIds).size !== b.originalCompletedTrialIds.length
  )
    fail();
}
const displayNumber = (n: number): number | string =>
  Number.isFinite(n) ? n : Number.isNaN(n) ? "NaN" : n > 0 ? "+Infinity" : "-Infinity";

/** Uses only original scoring/baseline/identity functions; deliberately no harness,
 * admission or bootstrap imports. A diagnostic identity match is not cache reuse.
 */
export function scoreSavedForecastsDiagnosticV1(
  input: ReturnType<typeof readScientificDiagnosticInputsV1>,
  binding: ScoreDiagnosticBindingV1,
) {
  assertBinding(binding);
  const h = input.header;
  if (
    h.codeReleaseSha !== binding.releaseSha ||
    h.contentDigestHex !== binding.contentDigestHex ||
    h.developmentDatasetDigestHex !== binding.developmentDatasetDigestHex ||
    (h.primaryHorizonMinutes !== 30 && h.primaryHorizonMinutes !== 60) ||
    input.forecasts.length !== binding.forecastCount ||
    input.developmentReturns.length !== input.historyMinuteOpenTimesMs.length
  )
    fail();
  const context = buildBaselineContextFromDevelopment({
    developmentReturns: input.developmentReturns,
    history: input.developmentReturns,
    historyMinuteOpenTimesMs: input.historyMinuteOpenTimesMs,
    primaryHorizonMinutes: h.primaryHorizonMinutes,
  });
  if (computeTerminalTargetGridIdentityDigestHex(context.grid) !== h.targetGridDigestHex) fail();
  const anchors = [...input.forecasts].sort((a, b) => a.anchorId.localeCompare(b.anchorId));
  const commonHash = createHash("sha256").update("common-anchor-set/v1");
  for (const a of anchors) commonHash.update(`\n${a.anchorId}`);
  const commonAnchorSetDigestHex = commonHash.digest("hex");
  const trials = MANDATORY_BASELINE_IDS.map((baselineId) => ({
    baselineId,
    trialIdentityDigestHex: computeTrialIdentityDigestV2({
      scoringContractVersion: "multiclass-log-score/v1",
      evaluationPartitionReceiptDigestHex: binding.evaluationPartitionReceiptDigestHex,
      venue: "htx",
      market: "spot",
      symbol: h.symbol,
      primaryHorizonMinutes: h.primaryHorizonMinutes,
      modelTransformVersion: MODEL_TRANSFORM_VERSION,
      challengerPackageContentDigestHex: h.contentDigestHex,
      baselineId,
      metricId: "terminal-multiclass-log-score/v1",
      commonAnchorSetDigestHex,
      purgeDurationMinutes: h.primaryHorizonMinutes,
      embargoDurationMinutes: h.primaryHorizonMinutes,
      comparisonFamilyId: binding.comparisonFamilyId,
    }).toString("hex"),
  }));
  for (let i = 0; i < binding.originalCompletedTrialIds.length; i++)
    if (trials[i]?.trialIdentityDigestHex !== binding.originalCompletedTrialIds[i]) fail();
  const comparisons = trials.map((trial) => {
    const baseline = evaluateMandatoryBaselineV1(trial.baselineId, context);
    if (baseline.status !== "AVAILABLE") return { ...trial, status: "UNAVAILABLE" as const };
    let nonFiniteCount = 0,
      challengerZeroCount = 0,
      baselineZeroCount = 0;
    let firstNonFinite: null | {
      anchorId: string;
      observedReturn: number;
      bucket: number;
      challengerProbability: number;
      baselineProbability: number;
      challengerScore: number | string;
      baselineScore: number | string;
      differential: number | string;
    } = null;
    for (const a of anchors) {
      const bucket = bucketIndexForReturn(a.observedReturn, context.grid);
      const challengerScore = multiclassLogScore(
        a.observedReturn,
        a.challengerProbabilities,
        context.grid,
      );
      const baselineScore = baseline.logScore(a.observedReturn),
        differential = challengerScore - baselineScore;
      if (a.challengerProbabilities[bucket] === 0) challengerZeroCount++;
      if (baseline.probabilities[bucket] === 0) baselineZeroCount++;
      if (!Number.isFinite(differential)) {
        nonFiniteCount++;
        firstNonFinite ??= {
          anchorId: a.anchorId,
          observedReturn: a.observedReturn,
          bucket,
          challengerProbability: a.challengerProbabilities[bucket]!,
          baselineProbability: baseline.probabilities[bucket]!,
          challengerScore: displayNumber(challengerScore),
          baselineScore: displayNumber(baselineScore),
          differential: displayNumber(differential),
        };
      }
    }
    return {
      ...trial,
      status: "AVAILABLE" as const,
      nonFiniteCount,
      challengerZeroCount,
      baselineZeroCount,
      baselineProbabilities: baseline.probabilities,
      firstNonFinite,
    };
  });
  return {
    format: "waia-scientific-score-diagnostic/v1",
    authorityGranted: false,
    qualification: "NOT_RUN",
    bootstrap: "NOT_RUN",
    forecastGeneration: "NOT_RUN",
    reuseApplicability: "NOT_ASSESSED",
    originalLogTrialIdentities: "MATCH",
    sourceReleaseSha: h.codeReleaseSha,
    packageContentDigestHex: h.contentDigestHex,
    commonAnchorSetDigestHex,
    evaluationPartitionReceiptDigestHex: binding.evaluationPartitionReceiptDigestHex,
    forecastCount: anchors.length,
    developmentCount: input.developmentReturns.length,
    forecastEntries: input.forecastEntries,
    otherEvidenceEntries: input.otherEvidenceEntries,
    evidenceInventoryDigestHex: input.evidenceInventoryDigestHex,
    sourceChunksRead: input.sourceChunksRead,
    gridEdges: context.grid.edges,
    comparisons,
  };
}

export function runScoreDiagnosticCliV1(args: string[]): number {
  if (
    args.length !== 5 ||
    args[0] !== "--root" ||
    args[2] !== "--binding" ||
    args[4] !== "--quiescent-tree"
  )
    return 64;
  try {
    const fd = openSync(args[3]!, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const st = fstatSync(fd);
      if (
        !st.isFile() ||
        st.size > 16384 ||
        (st.mode & 0o077) !== 0 ||
        (process.getuid && st.uid !== process.getuid())
      )
        return fail();
      bytes = readFileSync(fd);
      if (bytes.length !== st.size || bytes.length > 16384) return fail();
    } finally {
      closeSync(fd);
    }
    const binding = parseScoreDiagnosticBindingV1(JSON.parse(bytes.toString("utf8")));
    const input = readScientificDiagnosticInputsV1(args[1]!, binding.packageKey);
    process.stdout.write(`${JSON.stringify(scoreSavedForecastsDiagnosticV1(input, binding))}\n`);
    return 0;
  } catch {
    process.stderr.write("SCIENTIFIC_SCORE_DIAGNOSTIC_REFUSED\n");
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runScoreDiagnosticCliV1(process.argv.slice(2));
