import {
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
} from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import type { MarketHypothesis } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST } from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix-v1";
import {
  deriveForecastRecordId,
  deriveForecastKeyDigest,
} from "@/lib/trader/intelligence/forecast-decision/derive-forecast-decision-ids";
import { computeForecastRecordContentDigest } from "@/lib/trader/intelligence/forecast-decision/serialize-forecast-decision";
import {
  FORECAST_MODEL_VERSION,
  FORECAST_RECORD_SCHEMA_VERSION,
  type TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";
import {
  assertForecastDecisionConstructionPermit,
  type ForecastDecisionConstructionPermit,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";
import {
  assertCanonicalCausalLineageV1,
  parseCanonicalCausalLineageV1,
} from "@/lib/trader/intelligence/causal-lineage/canonical-causal-lineage-v1";

const SUPPORTING_CONFIDENCE_THRESHOLD = 0.45;
const FORECAST_HORIZON_MS = 60 * 60 * 1000;

export type BuildForecastRecordsInput = Readonly<{
  intelligenceCycleBundle: IntelligenceCycleBundle;
  hypothesesByType: Readonly<Record<string, MarketHypothesis>>;
}>;

function buildMarketQuestion(hypothesisType: string, expectedPath: string): string {
  return `Will ${hypothesisType} expected path (${expectedPath}) hold through the forecast horizon?`;
}

function addHorizon(isoTimestamp: string, horizonMs: number): string {
  return new Date(new Date(isoTimestamp).getTime() + horizonMs).toISOString();
}

function buildForecastForHypothesis(
  bundle: IntelligenceCycleBundle,
  hypothesisRecordId: string,
  hypothesis: MarketHypothesis,
): TraderIntelligenceForecastRecord | null {
  const envelope = bundle.envelope;
  const conviction = bundle.conviction;
  const hypothesisRow = bundle.hypotheses.find((row) => row.id === hypothesisRecordId);
  if (!hypothesisRow) {
    return null;
  }

  const issuedAt = envelope.evaluatedAt;
  const evidenceCutoffAt = envelope.evaluatedAt;
  const lineageJson = hypothesis.canonicalCausalLineageJson ?? null;
  const lineageDigest = hypothesis.canonicalCausalLineageDigest ?? null;
  if (
    lineageJson === null ||
    lineageDigest === null ||
    hypothesisRow.canonicalCausalLineageJson !== lineageJson ||
    hypothesisRow.canonicalCausalLineageDigest !== lineageDigest
  ) {
    return null;
  }
  try {
    const lineage = parseCanonicalCausalLineageV1(lineageJson);
    assertCanonicalCausalLineageV1(lineage, evidenceCutoffAt);
    if (
      lineage.contentDigest !== lineageDigest ||
      lineage.organizationId !== envelope.organizationId ||
      lineage.symbol !== envelope.symbol ||
      lineage.hypothesisId !== hypothesis.canonicalHypothesisId
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const targetWindowStartAt = envelope.evaluatedAt;
  const targetWindowEndAt = addHorizon(envelope.evaluatedAt, FORECAST_HORIZON_MS);
  const marketQuestion = buildMarketQuestion(hypothesis.hypothesisType, hypothesis.expectedPath);

  const forecastKeyDigest = deriveForecastKeyDigest({
    organizationId: envelope.organizationId,
    runId: envelope.runId,
    cycleId: envelope.cycleId,
    symbol: envelope.symbol,
    hypothesisRecordId,
    targetWindowStartAt,
    targetWindowEndAt,
    marketQuestion,
    forecastModelVersion: FORECAST_MODEL_VERSION,
    canonicalCausalLineageDigest: lineageDigest,
  });

  const base: TraderIntelligenceForecastRecord = {
    id: deriveForecastRecordId({
      organizationId: envelope.organizationId,
      runId: envelope.runId,
      cycleId: envelope.cycleId,
      symbol: envelope.symbol,
      hypothesisRecordId,
      targetWindowStartAt,
      targetWindowEndAt,
      marketQuestion,
      forecastModelVersion: FORECAST_MODEL_VERSION,
      canonicalCausalLineageDigest: lineageDigest,
    }),
    organizationId: envelope.organizationId,
    cycleEnvelopeId: envelope.id,
    hypothesisRecordId,
    convictionRecordId: conviction.id,
    runId: envelope.runId,
    cycleId: envelope.cycleId,
    symbol: envelope.symbol,
    forecastKeyDigest,
    evaluatedAt: envelope.evaluatedAt,
    issuedAt,
    evidenceCutoffAt,
    targetWindowStartAt,
    targetWindowEndAt,
    marketQuestion,
    invalidationConditionsJson: canonicalizeSemanticJsonString(hypothesis.invalidationConditions),
    scenarioSetJson: canonicalizeSemanticJsonString({
      expected_path: hypothesis.expectedPath,
      supporting_evidence: hypothesis.supportingEvidence,
      contradicting_evidence: hypothesis.contradictingEvidence,
    }),
    forecastConfidenceJson: canonicalizeSemanticJsonString({
      confidence_value: hypothesisRow.confidenceValue,
      conviction_value: conviction.convictionValue,
      conviction_class: conviction.convictionClass,
    }),
    historicalProfileId: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1.profileId,
    historicalProfileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    matrixDigest: TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST,
    evidenceDigest: hypothesisRow.evidenceDigest,
    authoritativeLinkDigest: hypothesisRow.authoritativeLinkDigest,
    canonicalCausalLineageJson: lineageJson,
    canonicalCausalLineageDigest: lineageDigest,
    forecastModelVersion: FORECAST_MODEL_VERSION,
    contentDigest: "",
    schemaVersion: FORECAST_RECORD_SCHEMA_VERSION,
  };

  return {
    ...base,
    contentDigest: computeForecastRecordContentDigest(base),
  };
}

export function buildForecastRecords(
  input: BuildForecastRecordsInput,
  constructionPermit: ForecastDecisionConstructionPermit,
  sourceBundle: IntelligenceCycleBundle,
): TraderIntelligenceForecastRecord[] {
  assertForecastDecisionConstructionPermit(constructionPermit, sourceBundle);
  if (input.intelligenceCycleBundle !== sourceBundle) {
    throw new Error("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:BUNDLE_SCOPE_MISMATCH");
  }
  const bundle = input.intelligenceCycleBundle;
  if (bundle.conviction.convictionScope === "NONE") {
    return [];
  }

  const activeHypothesisRecordId = bundle.conviction.activeHypothesisRecordId;
  if (!activeHypothesisRecordId) {
    return [];
  }

  const activeHypothesisRow = bundle.hypotheses.find((row) => row.id === activeHypothesisRecordId);
  if (!activeHypothesisRow) {
    return [];
  }

  const activeHypothesis = input.hypothesesByType[activeHypothesisRow.hypothesisType];
  if (!activeHypothesis) {
    return [];
  }

  const activeForecast = buildForecastForHypothesis(
    bundle,
    activeHypothesisRecordId,
    activeHypothesis,
  );
  if (!activeForecast) {
    return [];
  }
  const forecasts: TraderIntelligenceForecastRecord[] = [activeForecast];

  const supportingRows = bundle.hypotheses
    .filter((row) => row.id !== activeHypothesisRecordId)
    .filter((row) => Number(row.confidenceValue) >= SUPPORTING_CONFIDENCE_THRESHOLD)
    .sort((a, b) => Number(b.confidenceValue) - Number(a.confidenceValue));

  for (const row of supportingRows) {
    const hypothesis = input.hypothesesByType[row.hypothesisType];
    if (!hypothesis) {
      continue;
    }
    const forecast = buildForecastForHypothesis(bundle, row.id, hypothesis);
    if (forecast) {
      forecasts.push(forecast);
    }
  }

  return forecasts;
}
