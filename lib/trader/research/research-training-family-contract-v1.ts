import { z } from "zod";
import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "./research-development-source-contract-v1";
import { canonicalJsonString, computeStableJsonDigest } from "./digest";
import type { ResearchExperimentSpecV1 } from "./research-experiment-contract-v1";
import type { resolveCurrentResearchExecutableIdentityV1 } from "./research-executable-runtime-identity-v1";

export const RESEARCH_TRAINING_FAMILY_SELECTION_V1 = "waia.research.training-family-selection.v1" as const;
const request = z.object({
  organizationId: z.string().uuid().transform(value => value.toLowerCase())
    .refine(value => value === RESEARCH_DEVELOPMENT_SOURCE_ORG_V1),
  attemptId: z.string().uuid().transform(value => value.toLowerCase()),
  limits: z.object({ maxBars: z.number().int().min(1).max(4096),
    maxBytes: z.number().int().min(1).max(32 * 1024 * 1024),
    maxTraceBytes: z.number().int().min(1).max(32 * 1024 * 1024) }).strict(),
}).strict();
export function captureResearchTrainingFamilyRequestV1(value: unknown) {
  const parsed = request.parse(value);
  return Object.freeze({ ...parsed, limits: Object.freeze(parsed.limits) });
}
export type ResearchTrainingFamilyRequestV1 = ReturnType<typeof captureResearchTrainingFamilyRequestV1>;

export function requireCanonicalResearchSelectionDecimalV1(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || formatDecimal(parseDecimal(value)) !== value) {
    throw new Error("RESEARCH_FAMILY_SELECTION_REFUSED:NONCANONICAL_METRIC");
  }
  return value;
}
export type ResearchTrainingTrialSummaryV1 = Readonly<{
  trialIndex: number; stageRunId: string; traceSha256: string; scopeDigestHex: string;
  ledgerDigestHex: string; finalAccountingDigestHex: string;
  netRealizedPnl: string; orderCount: number; fillCount: number;
}>;
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Pure serialization only, never a persisted/verified authority. The closed DB
 * owner alone supplies verified terminal trials and stores the resulting bytes. */
export function buildResearchTrainingFamilyReceiptV1(input: Readonly<{
  organizationId: string; attemptId: string; spec: ResearchExperimentSpecV1;
  experimentSpecSha256: string; sourceRunId: string; sourceIssuanceDigest: string;
  policyDigestHex: string;
  observedExecutableIdentity: ReturnType<typeof resolveCurrentResearchExecutableIdentityV1>;
  trials: readonly ResearchTrainingTrialSummaryV1[];
}>) {
  const { spec } = input;
  if (input.organizationId !== spec.organizationId || computeStableJsonDigest(spec) !== input.experimentSpecSha256 ||
      input.trials.length !== spec.orderedTrials.length || input.trials.length < 1 || input.trials.length > 32 ||
      spec.selection.objective !== "train-after-cost-realized-pnl" ||
      spec.selection.tieBreak !== "first-in-declared-family" ||
      spec.selection.validationSelection !== "forbidden" || spec.selection.blindSelection !== "forbidden") {
    throw new Error("RESEARCH_FAMILY_SELECTION_REFUSED:FAMILY_IDENTITY");
  }
  let selectedIndex = 0;
  const trials = input.trials.map((trial, index) => {
    if (trial.trialIndex !== index || !Number.isSafeInteger(trial.orderCount) || trial.orderCount < 0 ||
        !Number.isSafeInteger(trial.fillCount) || trial.fillCount < 0 ||
        !z.string().uuid().safeParse(trial.stageRunId).success ||
        [trial.traceSha256, trial.scopeDigestHex, trial.ledgerDigestHex, trial.finalAccountingDigestHex]
          .some(value => !/^[a-f0-9]{64}$/.test(value))) {
      throw new Error("RESEARCH_FAMILY_SELECTION_REFUSED:TRIAL_IDENTITY");
    }
    const netRealizedPnl = requireCanonicalResearchSelectionDecimalV1(trial.netRealizedPnl);
    if (compareDecimal(netRealizedPnl, input.trials[selectedIndex]!.netRealizedPnl) > 0) selectedIndex = index;
    return { ...trial, netRealizedPnl, parameters: spec.orderedTrials[index]! };
  });
  const payload = { schemaVersion: RESEARCH_TRAINING_FAMILY_SELECTION_V1,
    authority: "DEVELOPMENT_NONQUALIFYING_SELECTION_ONLY" as const, scientificQualified: false as const, capitalEligible: false as const,
    sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED", sourceQualification: "NOT_ESTABLISHED",
    organizationId: input.organizationId, attemptId: input.attemptId,
    experimentSpecSha256: input.experimentSpecSha256, familySha256: computeStableJsonDigest(spec.orderedTrials),
    sourceRunId: input.sourceRunId, sourceIssuanceDigest: input.sourceIssuanceDigest,
    trainPartitionSha256: spec.partitions.train.contentSha256,
    observedExecutableIdentity: input.observedExecutableIdentity, policyDigestHex: input.policyDigestHex,
    historicalExecutionModelSha256: spec.replay.historicalExecutionModelSha256,
    selection: spec.selection, trials, selectedIndex, selectedParameters: spec.orderedTrials[selectedIndex]!,
  };
  const body = JSON.parse(canonicalJsonString(payload)) as typeof payload;
  return freeze({ ...body, contentDigest: computeStableJsonDigest(body) });
}
export type ResearchTrainingFamilyReceiptV1 = ReturnType<typeof buildResearchTrainingFamilyReceiptV1>;
