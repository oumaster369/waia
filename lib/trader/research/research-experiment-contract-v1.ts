import { z } from "zod";
import { createHtrHistoricalCostModelAuthorityV1 } from "@/lib/trader/execution/cost-model";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";

/** Data contract only: parsing a proposal never issues execution, scoring, holdout,
 * statistical admission, or capital authority. The durable registry owns registration. */
export const RESEARCH_EXPERIMENT_SCHEMA_V1 = "waia.research.experiment.v1" as const;
export const RESEARCH_EXECUTABLE_ID_V1 = "research.mean-reversion-lookback.v1" as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveDecimal = z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/)
  .refine(value => /[1-9]/.test(value), "positive decimal required");
const text = z.string().trim().min(1).max(2048);

/** Fixed entry/exit rules are part of a distinct research executable. They do not
 * alter the production MVP registry. Selection varies only its declared lookback. */
export const researchTrialParametersSchemaV1 = z.object({
  lookbackBars: z.number().int().min(2).max(128),
  buyZscore: z.literal("-1.5"),
  sellZscore: z.literal("0"),
}).strict();
export type ResearchTrialParametersV1 = Readonly<z.infer<typeof researchTrialParametersSchemaV1>>;

const partition = z.object({
  contentSha256: sha256,
  firstOpenMs: timestamp,
  lastCloseMs: timestamp,
  barCount: z.number().int().min(1),
}).strict().refine(value => value.firstOpenMs < value.lastCloseMs, "invalid partition interval");
const costAuthority = createHtrHistoricalCostModelAuthorityV1();
const cost = z.object({
  modelId: z.literal(costAuthority.modelId),
  schemaVersion: z.literal(costAuthority.schemaVersion),
  feeBps: z.literal(costAuthority.feeBps),
  halfSpreadBps: z.literal(costAuthority.halfSpreadBps),
  marketImpactBps: z.literal(costAuthority.marketImpactBps),
  slippageModel: z.literal(costAuthority.slippageModel),
  takerFeeBps: z.literal(costAuthority.takerFeeBps),
  makerFeeBps: z.literal(costAuthority.makerFeeBps),
  submitLatencyMs: z.literal(costAuthority.submitLatencyMs),
  cancelLatencyMs: z.literal(costAuthority.cancelLatencyMs),
  partialFillModel: z.literal(costAuthority.partialFillModel),
  costModelDigest: z.literal(costAuthority.costModelDigest),
}).strict();

const experimentSchema = z.object({
  schemaVersion: z.literal(RESEARCH_EXPERIMENT_SCHEMA_V1),
  organizationId: z.string().uuid().transform(value => value.toLowerCase()),
  hypothesis: z.object({
    observationEvidenceSha256: z.array(sha256).min(1).max(64),
    // Inclusive last observation used to form the hypothesis. This assertion is
    // checked for overlap below; it does not authenticate discovery provenance.
    observationCutoffMs: timestamp,
    mechanism: text,
    falsificationRule: text,
  }).strict(),
  executable: z.object({
    id: z.literal(RESEARCH_EXECUTABLE_ID_V1),
    // Expected code identity must later equal the trusted runner's observed identity.
    // A syntactically valid requested digest by itself is never an execution receipt.
    sourceSha256: sha256,
    featureSemantics: z.literal("closed-prefix-sma-population-zscore/v1"),
    replaySemantics: z.literal("htr-next-eligible-closed-bar-close-with-retained-evaluation-prefix/v1"),
  }).strict(),
  orderedTrials: z.array(researchTrialParametersSchemaV1).min(1).max(32),
  universe: z.object({
    venue: z.literal("HTX"),
    market: z.literal("SPOT"),
    // Closed initial research scope follows the existing HTR model and 1m doctrine.
    symbol: z.enum(["BTCUSDT", "ETHUSDT"]),
    interval: z.literal("1m"),
    pointInTimeEvidenceSha256: sha256,
    knownAtMs: timestamp,
    datasetSourceSha256: sha256,
    sidecarContentSha256: sha256.nullable(),
  }).strict(),
  partitions: z.object({
    train: partition,
    validation: partition,
    // Only the existing sealed identity is retained. This contract never reads it.
    blind: partition,
    walkForward: z.array(partition).min(1).max(1024),
  }).strict(),
  costs: cost,
  replay: z.object({
    executionMode: z.literal("mock"),
    submitResearchMockOrders: z.literal(true),
    enableReplayFusedContext: z.boolean(),
    retentionMode: z.enum(["FULL", "STREAM_ONLY"]),
    partialRunEvidence: z.literal("ineligible"),
    metricsSchemaVersion: z.literal("2.0.0"),
    defaultQuantity: positiveDecimal,
    accountKey: z.string().min(1).max(256),
    portfolio: z.object({
      startingBalanceUsdt: positiveDecimal,
      maxRiskPerTradePct: positiveDecimal,
      maxPortfolioRiskPct: positiveDecimal,
      maxConcurrentPositions: z.number().int().min(1).max(1000),
      maxNotional: positiveDecimal,
      defaultStopDistancePct: positiveDecimal.nullable(),
    }).strict(),
    guardian: z.object({
      enabled: z.boolean(),
      maxHoldBars: z.number().int().min(0),
      barIntervalMs: z.number().int().positive(),
      enableExitEngine: z.boolean(),
      htrAuthoritative: z.boolean(),
      // Requested effective Guardian/exit policy identity; the runner must compare
      // the fully resolved configuration. Registration alone does not verify it.
      resolvedPolicySha256: sha256,
    }).strict(),
    historicalExecutionModelSha256: sha256,
    intelligenceProfileSha256: sha256.nullable(),
    volumeQualificationSha256: sha256,
  }).strict(),
  selection: z.object({
    objective: z.literal("train-after-cost-realized-pnl"),
    tieBreak: z.literal("first-in-declared-family"),
    validationSelection: z.literal("forbidden"),
    blindSelection: z.literal("forbidden"),
  }).strict(),
}).strict().superRefine((value, context) => {
  const refuse = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (new Set(value.orderedTrials.map(trial => canonicalJsonString(trial))).size !== value.orderedTrials.length) {
    refuse("duplicate declared trial");
  }
  if (new Set(value.hypothesis.observationEvidenceSha256).size !== value.hypothesis.observationEvidenceSha256.length) {
    refuse("duplicate observation evidence");
  }
  const { train, validation, blind, walkForward } = value.partitions;
  if (train.lastCloseMs > validation.firstOpenMs || validation.lastCloseMs > blind.firstOpenMs) {
    refuse("train/validation/blind intervals overlap or are out of order");
  }
  if (value.hypothesis.observationCutoffMs >= train.firstOpenMs) {
    refuse("hypothesis observations must end before training starts");
  }
  if (value.universe.knownAtMs > train.firstOpenMs) refuse("universe is not known at training start");
  const digests = [train, validation, blind].map(part => part.contentSha256);
  if (new Set(digests).size !== digests.length) refuse("reused partition content identity");
  for (let index = 0; index < walkForward.length; index += 1) {
    const window = walkForward[index]!;
    if (window.firstOpenMs < validation.firstOpenMs || window.lastCloseMs > validation.lastCloseMs ||
      (index > 0 && walkForward[index - 1]!.lastCloseMs > window.firstOpenMs)) {
      refuse("walk-forward windows must be ordered non-overlapping validation slices");
    }
  }
});

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ResearchExperimentSpecV1 = DeepReadonly<z.infer<typeof experimentSchema>>;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function parseResearchExperimentSpecV1(value: unknown): ResearchExperimentSpecV1 {
  const parsed = experimentSchema.parse(value);
  if (Buffer.byteLength(canonicalJsonString(parsed), "utf8") > 262_144) {
    throw new Error("RESEARCH_EXPERIMENT_SPEC_TOO_LARGE");
  }
  return deepFreeze(parsed);
}

export function researchExperimentIdentityV1(value: unknown): Readonly<{
  spec: ResearchExperimentSpecV1;
  specSha256: string;
  declaredFamilySize: number;
}> {
  const spec = parseResearchExperimentSpecV1(value);
  return Object.freeze({ spec, specSha256: computeStableJsonDigest(spec), declaredFamilySize: spec.orderedTrials.length });
}
