import {
  computeBarSetDigest,
  computeBarSetDigestFromParts,
} from "@/lib/trader/market-data/research-dataset";
import type { Bar } from "@/lib/trader/intelligence/types";
import { WalkForwardValidationError } from "@/lib/trader/research/errors";
import {
  assertMultiRegimeCoverage,
  collectRegimeLabelsFromMetrics,
} from "@/lib/trader/research/regime-coverage";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type {
  InsertWalkForwardWindowRow,
  ResearchValidationMetrics,
  StrategyCandidate,
  StrategyCandidateStatus,
  WalkForwardWindowPlan,
  WalkForwardWindowResult,
} from "@/lib/trader/research/strategy-candidate.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type WalkForwardBacktestRunner = (input: {
  bars: readonly Bar[];
  strategyId: string;
  strategyVersion: string;
  paramsJson: string;
}) => Promise<ResearchValidationMetrics>;

export type WalkForwardRepository = {
  insertWalkForwardWindow: (
    context: OrgContext,
    row: InsertWalkForwardWindowRow,
  ) => Promise<unknown>;
  updateStrategyCandidateStatus: (
    context: OrgContext,
    candidateId: string,
    status: StrategyCandidateStatus,
  ) => Promise<unknown>;
};

export type RunWalkForwardValidationInput = {
  context: OrgContext;
  candidate: StrategyCandidate;
  trainBars: readonly Bar[];
  validationBars: readonly Bar[];
  oosBarCount: number;
  runBacktest: WalkForwardBacktestRunner;
  repository: WalkForwardRepository;
  newId?: () => string;
  requireMultiRegimeCoverage?: boolean;
};

export type WalkForwardValidationResult = {
  windows: WalkForwardWindowResult[];
  regimeLabels: string[];
};

export type WalkForwardWindowPlanCore = {
  windowIndex: number;
  outOfSampleBars: readonly Bar[];
  inSampleDigest: string;
  outOfSampleDigest: string;
};

const ALLOWED_WALK_FORWARD_STATUSES = new Set<StrategyCandidateStatus>([
  "registered",
  "backtested",
]);

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new WalkForwardValidationError(`${label} must be a positive integer`);
  }
}

function assertWalkForwardSplits(
  trainBars: readonly Bar[],
  validationBars: readonly Bar[],
  oosBarCount: number,
): number {
  assertPositiveInteger(oosBarCount, "oosBarCount");

  if (trainBars.length < 1) {
    throw new WalkForwardValidationError("train split must contain at least one bar");
  }
  if (validationBars.length < oosBarCount) {
    throw new WalkForwardValidationError(
      `validation split requires at least ${oosBarCount} bars (got ${validationBars.length})`,
    );
  }

  return Math.floor(validationBars.length / oosBarCount);
}

/** Single walk-forward window plan — digests without materializing full in-sample bar arrays. */
export function buildWalkForwardWindowPlanAtIndex(
  trainBars: readonly Bar[],
  validationBars: readonly Bar[],
  windowIndex: number,
  oosBarCount: number,
): WalkForwardWindowPlanCore {
  assertPositiveInteger(oosBarCount, "oosBarCount");
  if (!Number.isInteger(windowIndex) || windowIndex < 0) {
    throw new WalkForwardValidationError("windowIndex must be a non-negative integer");
  }

  const windowCount = assertWalkForwardSplits(trainBars, validationBars, oosBarCount);
  if (windowIndex >= windowCount) {
    throw new WalkForwardValidationError(
      `windowIndex ${windowIndex} out of range (windowCount=${windowCount})`,
    );
  }

  const oosStart = windowIndex * oosBarCount;
  const oosEnd = oosStart + oosBarCount;
  const outOfSampleBars = validationBars.slice(oosStart, oosEnd);

  return {
    windowIndex,
    outOfSampleBars,
    inSampleDigest: computeBarSetDigestFromParts(trainBars, validationBars.slice(0, oosStart)),
    outOfSampleDigest: computeBarSetDigest(outOfSampleBars),
  };
}

/** Rolling anchored expanding windows over sealed train/validation splits (blind excluded). */
export function buildWalkForwardWindowPlans(
  trainBars: readonly Bar[],
  validationBars: readonly Bar[],
  oosBarCount: number,
): WalkForwardWindowPlan[] {
  const windowCount = assertWalkForwardSplits(trainBars, validationBars, oosBarCount);
  const plans: WalkForwardWindowPlan[] = [];

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const core = buildWalkForwardWindowPlanAtIndex(
      trainBars,
      validationBars,
      windowIndex,
      oosBarCount,
    );
    const oosStart = windowIndex * oosBarCount;
    const inSampleBars = [...trainBars, ...validationBars.slice(0, oosStart)];

    plans.push({
      ...core,
      inSampleBars,
    });
  }

  return plans;
}

function serializeMetrics(metrics: ResearchValidationMetrics): string {
  return JSON.stringify(metrics);
}

export async function runWalkForwardValidation(
  input: RunWalkForwardValidationInput,
): Promise<WalkForwardValidationResult> {
  if (!ALLOWED_WALK_FORWARD_STATUSES.has(input.candidate.status)) {
    throw new WalkForwardValidationError(
      `candidate status ${input.candidate.status} is not eligible for walk-forward validation`,
    );
  }

  const windowCount = assertWalkForwardSplits(
    input.trainBars,
    input.validationBars,
    input.oosBarCount,
  );

  if (windowCount === 0) {
    throw new WalkForwardValidationError("walk-forward schedule produced zero windows");
  }

  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const windows: WalkForwardWindowResult[] = [];

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const plan = buildWalkForwardWindowPlanAtIndex(
      input.trainBars,
      input.validationBars,
      windowIndex,
      input.oosBarCount,
    );

    const metrics = await input.runBacktest({
      bars: plan.outOfSampleBars,
      strategyId: input.candidate.strategyId,
      strategyVersion: input.candidate.strategyVersion,
      paramsJson: input.candidate.paramsJson,
    });

    await input.repository.insertWalkForwardWindow(input.context, {
      id: newId(),
      candidateId: input.candidate.id,
      windowIndex: plan.windowIndex,
      inSampleDigest: plan.inSampleDigest,
      outOfSampleDigest: plan.outOfSampleDigest,
      metricsJson: serializeMetrics(metrics),
    });

    windows.push({
      windowIndex: plan.windowIndex,
      inSampleDigest: plan.inSampleDigest,
      outOfSampleDigest: plan.outOfSampleDigest,
      metrics,
    });
  }

  const regimeLabels = collectRegimeLabelsFromMetrics(windows.map((window) => window.metrics));
  if (input.requireMultiRegimeCoverage ?? true) {
    assertMultiRegimeCoverage(regimeLabels);
  }

  await input.repository.updateStrategyCandidateStatus(
    input.context,
    input.candidate.id,
    "walk_forward_validated",
  );

  return { windows, regimeLabels };
}

export function computeWalkForwardEvidenceDigest(
  windows: readonly WalkForwardWindowResult[],
): string {
  return computeStableJsonDigest({
    schemaVersion: "1.0.0",
    windows: windows.map((window) => ({
      windowIndex: window.windowIndex,
      inSampleDigest: window.inSampleDigest,
      outOfSampleDigest: window.outOfSampleDigest,
      metrics: window.metrics,
    })),
  });
}
