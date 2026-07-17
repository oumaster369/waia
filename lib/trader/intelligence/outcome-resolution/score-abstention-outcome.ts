import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { TraderIntelligenceDecisionRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import {
  deriveAbstentionOutcomeId,
  deriveAbstentionOutcomeIdempotencyKey,
} from "@/lib/trader/intelligence/outcome-resolution/derive-outcome-ids";
import {
  classifyExpectedPathDirection,
  evaluateForecastPath,
  extractHorizonFromForecast,
  extractRegimeFromDecision,
} from "@/lib/trader/intelligence/outcome-resolution/evaluate-forecast-path";
import type {
  AbstentionOutcomeClass,
  AbstentionOutcomeRecord,
  ForecastOutcomeRecord,
  OutcomeResolutionSink,
  OutcomeResolutionSource,
  PitBarWindow,
} from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { ABSTENTION_OUTCOME_SCHEMA_VERSION } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { computeAbstentionOutcomeContentDigest } from "@/lib/trader/intelligence/outcome-resolution/serialize-outcome-resolution";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

const GUARDIAN_REASON_PREFIX = "GUARDIAN_";
const NEUTRAL_BAND_BPS = 5;

export function classifyAbstentionOutcome(input: {
  decision: TraderIntelligenceDecisionRecord;
  forecastOutcome: ForecastOutcomeRecord | null;
  pitWindow: PitBarWindow;
  scenarioSetJson: string | null;
  targetWindowStartAt: string;
  targetWindowEndAt: string;
}): AbstentionOutcomeClass {
  const reasonCodes = input.decision.reasonCodesJson.toLowerCase();
  const terminal = input.decision.universalTerminalReasonCode.toUpperCase();

  if (input.decision.costEvidenceState === "UNAVAILABLE") {
    return "MISSING_NET_ECONOMICS";
  }

  if (reasonCodes.includes("guardian") || terminal.includes("GUARDIAN")) {
    return "SAFETY_MANDATED";
  }

  const evaluation =
    input.scenarioSetJson && input.targetWindowEndAt
      ? evaluateForecastPath({
          scenarioSetJson: input.scenarioSetJson,
          invalidationConditionsJson: "[]",
          issuedAt: input.decision.issuedAt,
          eligibleResolutionAt: input.targetWindowEndAt,
          evidenceCutoffAt: input.pitWindow.evidenceCutoffAt,
          asOf: input.pitWindow.asOf,
          bars: input.pitWindow.bars,
        })
      : null;

  const netMove = evaluation?.netMove ?? "0";
  const threshold = (NEUTRAL_BAND_BPS / 10_000).toString();
  const negThreshold = compareDecimal("0", threshold) < 0 ? `-${threshold}` : "0";

  if (compareDecimal(netMove, negThreshold) >= 0 && compareDecimal(netMove, threshold) <= 0) {
    return "NEUTRAL_CONFIRMED";
  }

  const direction = input.scenarioSetJson
    ? classifyExpectedPathDirection(
        JSON.parse(input.scenarioSetJson)?.expected_path ?? "no_clear_path",
      )
    : "NEUTRAL";

  const moveUp = compareDecimal(netMove, "0") > 0;
  const moveDown = compareDecimal(netMove, "0") < 0;

  if (direction === "BULLISH" && moveUp) {
    const afterCosts = input.decision.expectedRewardAfterCosts;
    if (afterCosts && compareDecimal(afterCosts, "0") > 0) {
      return "OPPORTUNITY_FOREGONE";
    }
    return "COST_ADJUSTED_NEGATIVE";
  }

  if (direction === "BEARISH" && moveDown) {
    return "ADVERSE_AVOIDED";
  }

  if (direction === "BULLISH" && moveDown) {
    return "ADVERSE_AVOIDED";
  }

  if (direction === "BEARISH" && moveUp) {
    return "ADVERSE_AVOIDED";
  }

  if (input.forecastOutcome?.outcomeVerdict === "INCORRECT") {
    return "ADVERSE_AVOIDED";
  }

  return "COST_ADJUSTED_NEGATIVE";
}

function buildAbstentionRecord(input: {
  context: OrgContext;
  decision: TraderIntelligenceDecisionRecord;
  forecastOutcome: ForecastOutcomeRecord | null;
  forecastRecordId: string | null;
  scenarioSetJson: string | null;
  targetWindowStartAt: string;
  targetWindowEndAt: string;
  pitWindow: PitBarWindow;
  provenance: AbstentionOutcomeRecord["provenance"];
}): AbstentionOutcomeRecord {
  const outcomeClass = classifyAbstentionOutcome(input);
  const regime = extractRegimeFromDecision(input.decision.cdeMsvPermissionSnapshotJson);
  const horizon = extractHorizonFromForecast(input.targetWindowEndAt, input.targetWindowStartAt);

  const observedOutcomeJson = canonicalizeSemanticJsonString({
    net_move: evaluateForecastPath({
      scenarioSetJson: input.scenarioSetJson ?? '{"expected_path":"no_clear_path"}',
      invalidationConditionsJson: "[]",
      issuedAt: input.decision.issuedAt,
      eligibleResolutionAt: input.targetWindowEndAt,
      evidenceCutoffAt: input.pitWindow.evidenceCutoffAt,
      asOf: input.pitWindow.asOf,
      bars: input.pitWindow.bars,
    }).netMove,
    evaluated_at: input.pitWindow.asOf,
  });

  const base: Omit<AbstentionOutcomeRecord, "id" | "idempotencyKey" | "contentDigest"> = {
    organizationId: input.context.organizationId,
    runId: input.decision.runId,
    cycleId: input.decision.cycleId,
    symbol: input.decision.symbol,
    decisionRecordId: input.decision.id,
    forecastRecordId: input.forecastRecordId,
    forecastOutcomeId: input.forecastOutcome?.id ?? null,
    modelVersion: input.forecastOutcome?.modelVersion ?? null,
    strategyVersion: input.decision.strategyVersion,
    regime,
    horizon,
    issuedAt: input.decision.issuedAt,
    eligibleResolutionAt: input.targetWindowEndAt,
    resolvedAt: input.pitWindow.asOf,
    pitEvidenceBoundary: input.pitWindow.asOf,
    outcomeClass,
    score: null,
    observedOutcomeJson,
    counterfactualTradeSimJson: null,
    sourceRecordIdsJson: canonicalizeSemanticJsonString({
      decision_record_id: input.decision.id,
      forecast_record_id: input.forecastRecordId,
      forecast_outcome_id: input.forecastOutcome?.id ?? null,
    }),
    provenance: input.provenance,
    terminalReason: outcomeClass,
    schemaVersion: ABSTENTION_OUTCOME_SCHEMA_VERSION,
  };

  const id = deriveAbstentionOutcomeId({
    organizationId: input.context.organizationId,
    decisionRecordId: input.decision.id,
  });
  const idempotencyKey = deriveAbstentionOutcomeIdempotencyKey({
    organizationId: input.context.organizationId,
    runId: input.decision.runId,
    cycleId: input.decision.cycleId,
    symbol: input.decision.symbol,
    decisionRecordId: input.decision.id,
  });

  const draft: AbstentionOutcomeRecord = { ...base, id, idempotencyKey, contentDigest: "" };
  return {
    ...draft,
    contentDigest: computeAbstentionOutcomeContentDigest(draft),
  };
}

export async function scoreAbstentionOutcomes(input: {
  context: OrgContext;
  runId: string;
  asOf: string;
  pitWindow: PitBarWindow;
  source: OutcomeResolutionSource;
  sink: OutcomeResolutionSink;
  provenance: AbstentionOutcomeRecord["provenance"];
  forecastMetaByDecisionId?: ReadonlyMap<
    string,
    {
      forecastRecordId: string;
      scenarioSetJson: string;
      targetWindowStartAt: string;
      targetWindowEndAt: string;
    }
  >;
}): Promise<readonly AbstentionOutcomeRecord[]> {
  const decisions = await input.source.listNoTradeDecisionsEligibleForScoring(
    input.context,
    input.runId,
    input.asOf,
  );
  const scored: AbstentionOutcomeRecord[] = [];

  for (const decision of decisions) {
    if (decision.decisionClass !== "NO_TRADE") {
      continue;
    }

    const existing = await input.sink.abstentionOutcomeRepository.findByDecisionRecordId(
      input.context,
      decision.id,
    );
    if (existing) {
      scored.push(existing);
      continue;
    }

    const meta = input.forecastMetaByDecisionId?.get(decision.id);
    const targetWindowEndAt = meta?.targetWindowEndAt ?? input.asOf;
    if (new Date(input.asOf).getTime() < new Date(targetWindowEndAt).getTime()) {
      continue;
    }

    const forecastOutcome = meta?.forecastRecordId
      ? await input.source.findForecastOutcomeByForecastId(input.context, meta.forecastRecordId)
      : null;

    const record = buildAbstentionRecord({
      context: input.context,
      decision,
      forecastOutcome,
      forecastRecordId: meta?.forecastRecordId ?? null,
      scenarioSetJson: meta?.scenarioSetJson ?? null,
      targetWindowStartAt: meta?.targetWindowStartAt ?? decision.issuedAt,
      targetWindowEndAt,
      pitWindow: input.pitWindow,
      provenance: input.provenance,
    });

    await input.sink.abstentionOutcomeRepository.insert(input.context, record);
    scored.push(record);
  }

  return scored;
}

export { GUARDIAN_REASON_PREFIX };
