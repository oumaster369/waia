import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import type { Bar } from "@/lib/trader/intelligence/types";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  BlindHoldoutValidationError,
  BlindValidationAlreadyExistsError,
  StrategyCandidateBlindLockoutError,
} from "@/lib/trader/research/errors";
import { assertMultiRegimeCoverage } from "@/lib/trader/research/regime-coverage";
import type {
  BlindValidationResult,
  ResearchValidationMetrics,
  StrategyCandidate,
  StrategyCandidateStatus,
} from "@/lib/trader/research/strategy-candidate.types";
import type { InsertBlindValidationResultRow } from "@/lib/trader/research/strategy-candidate.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type BlindHoldoutBacktestRunner = (input: {
  bars: readonly Bar[];
  strategyId: string;
  strategyVersion: string;
  paramsJson: string;
}) => Promise<ResearchValidationMetrics>;

export type BlindHoldoutRepository = {
  getBlindValidationResultForCandidate: (
    context: OrgContext,
    candidateId: string,
  ) => Promise<BlindValidationResult | null>;
  insertBlindValidationResult: (
    context: OrgContext,
    row: InsertBlindValidationResultRow,
  ) => Promise<BlindValidationResult>;
  markStrategyCandidateBlindUsed: (
    context: OrgContext,
    candidateId: string,
  ) => Promise<StrategyCandidate>;
  updateStrategyCandidateStatus: (
    context: OrgContext,
    candidateId: string,
    status: StrategyCandidateStatus,
  ) => Promise<StrategyCandidate>;
};

export type RunBlindHoldoutValidationInput = {
  context: OrgContext;
  candidate: StrategyCandidate;
  datasetId: string;
  blindBars: readonly Bar[];
  expectedBlindDigest?: string;
  runBacktest: BlindHoldoutBacktestRunner;
  repository: BlindHoldoutRepository;
  validatedAt?: Date;
  newId?: () => string;
  requireMultiRegimeCoverage?: boolean;
};

export type BlindHoldoutValidationResult = {
  result: BlindValidationResult;
  metrics: ResearchValidationMetrics;
};

const ALLOWED_BLIND_STATUSES = new Set<StrategyCandidateStatus>(["walk_forward_validated"]);

function serializeMetrics(metrics: ResearchValidationMetrics): string {
  return JSON.stringify(metrics);
}

export function computeBlindValidationEvidenceDigest(
  metrics: ResearchValidationMetrics,
  datasetId: string,
  candidateId: string,
  validatedAt: string,
): string {
  return computeStableJsonDigest({
    schemaVersion: "1.0.0",
    candidateId,
    datasetId,
    validatedAt,
    metrics,
  });
}

export async function runBlindHoldoutValidation(
  input: RunBlindHoldoutValidationInput,
): Promise<BlindHoldoutValidationResult> {
  if (input.candidate.blindUsed) {
    throw new StrategyCandidateBlindLockoutError(input.candidate.id);
  }

  const existing = await input.repository.getBlindValidationResultForCandidate(
    input.context,
    input.candidate.id,
  );
  if (existing) {
    throw new BlindValidationAlreadyExistsError(input.candidate.id);
  }

  if (!ALLOWED_BLIND_STATUSES.has(input.candidate.status)) {
    throw new BlindHoldoutValidationError(
      `candidate status ${input.candidate.status} is not eligible for blind holdout (requires walk_forward_validated)`,
    );
  }

  if (input.blindBars.length < 1) {
    throw new BlindHoldoutValidationError("blind split must contain at least one bar");
  }

  const blindDigest = computeBarSetDigest(input.blindBars);
  if (input.expectedBlindDigest && input.expectedBlindDigest !== blindDigest) {
    throw new BlindHoldoutValidationError(
      `blind split digest mismatch (expected ${input.expectedBlindDigest}, got ${blindDigest})`,
    );
  }

  const metrics = await input.runBacktest({
    bars: input.blindBars,
    strategyId: input.candidate.strategyId,
    strategyVersion: input.candidate.strategyVersion,
    paramsJson: input.candidate.paramsJson,
  });

  if (input.requireMultiRegimeCoverage ?? true) {
    const regimeLabels = metrics.byRegime
      .filter((slice) => slice.tradeCount > 0)
      .map((slice) => slice.regimeLabel);
    assertMultiRegimeCoverage(regimeLabels);
  }

  const validatedAt = input.validatedAt ?? new Date();
  const evidenceDigest = computeBlindValidationEvidenceDigest(
    metrics,
    input.datasetId,
    input.candidate.id,
    validatedAt.toISOString(),
  );
  const newId = input.newId ?? crypto.randomUUID.bind(crypto);

  const result = await input.repository.insertBlindValidationResult(input.context, {
    id: newId(),
    candidateId: input.candidate.id,
    datasetId: input.datasetId,
    metricsJson: serializeMetrics(metrics),
    evidenceDigest,
    validatedAt,
  });

  await input.repository.markStrategyCandidateBlindUsed(input.context, input.candidate.id);
  await input.repository.updateStrategyCandidateStatus(
    input.context,
    input.candidate.id,
    "blind_validated",
  );

  return { result, metrics };
}
